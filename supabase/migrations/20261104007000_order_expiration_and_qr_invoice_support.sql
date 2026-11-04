-- 30-minute unpaid-order expiry, direct-wallet invoice lifetime, and payment guards.
alter table public.ah_orders add column if not exists expires_at timestamptz;
update public.ah_orders set expires_at=created_at+interval '30 minutes' where expires_at is null;
alter table public.ah_orders alter column expires_at set default (now()+interval '30 minutes'), alter column expires_at set not null;
create index if not exists ah_orders_unpaid_expiry_idx on public.ah_orders(expires_at) where status in ('pending','awaiting_payment');

CREATE OR REPLACE FUNCTION public.ah_create_order(p_user_id uuid, p_plan_id uuid, p_region_id uuid, p_quantity integer, p_idempotency_key text, p_customer_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_fingerprint text;
  v_existing public.ah_orders%rowtype;
  v_plan_name text;
  v_price_minor bigint;
  v_currency varchar(4);
  v_order_id uuid;
  v_total bigint;
  v_expires_at timestamptz;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_user_id is null or p_plan_id is null then raise exception 'invalid_order' using errcode = '22023'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 20 then raise exception 'invalid_quantity' using errcode = '22023'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 16 or length(p_idempotency_key) > 128 or p_idempotency_key !~ '^[A-Za-z0-9._:-]+$' then raise exception 'invalid_idempotency_key' using errcode = '22023'; end if;
  if p_customer_note is not null and length(p_customer_note) > 500 then raise exception 'invalid_customer_note' using errcode = '22023'; end if;

  v_fingerprint := md5(p_plan_id::text || '|' || coalesce(p_region_id::text, '') || '|' || p_quantity::text || '|' || coalesce(p_customer_note, ''));
  select * into v_existing from public.ah_orders where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then raise exception 'idempotency_conflict' using errcode = '23505'; end if;
    return jsonb_build_object('order_id', v_existing.id, 'status', v_existing.status, 'currency', v_existing.currency, 'total_minor', v_existing.total_minor, 'expires_at', v_existing.expires_at, 'replayed', true);
  end if;

  select pl.name, pl.price_minor, pl.currency into v_plan_name, v_price_minor, v_currency
  from public.ah_plans pl join public.ah_products pr on pr.id = pl.product_id
  where pl.id = p_plan_id and pl.is_active = true and pr.is_active = true;
  if not found then raise exception 'plan_unavailable' using errcode = 'P0002'; end if;
  if v_currency <> 'USDT' then raise exception 'plan_currency_must_be_usdt' using errcode = '22023'; end if;
  if p_region_id is not null and not exists (select 1 from public.ah_regions r where r.id = p_region_id and r.status = 'active') then
    raise exception 'region_unavailable' using errcode = 'P0002';
  end if;
  if v_price_minor > 0 and v_price_minor > 9223372036854775807::bigint / p_quantity then raise exception 'order_total_overflow' using errcode = '22003'; end if;
  v_total := v_price_minor * p_quantity;

  insert into public.ah_orders (user_id, region_id, status, currency, subtotal_minor, total_minor, idempotency_key, request_fingerprint, customer_note)
  values (p_user_id, p_region_id, 'pending', v_currency, v_total, v_total, p_idempotency_key, v_fingerprint, nullif(p_customer_note, ''))
  on conflict (user_id, idempotency_key) do nothing
  returning id, expires_at into v_order_id, v_expires_at;

  if v_order_id is null then
    select * into v_existing from public.ah_orders where user_id = p_user_id and idempotency_key = p_idempotency_key;
    if not found or v_existing.request_fingerprint is distinct from v_fingerprint then raise exception 'idempotency_conflict' using errcode = '23505'; end if;
    return jsonb_build_object('order_id', v_existing.id, 'status', v_existing.status, 'currency', v_existing.currency, 'total_minor', v_existing.total_minor, 'expires_at', v_existing.expires_at, 'replayed', true);
  end if;

  insert into public.ah_order_items (order_id, plan_id, description_snapshot, quantity, unit_price_minor, configuration)
  values (v_order_id, p_plan_id, v_plan_name, p_quantity, v_price_minor, jsonb_build_object('region_id', p_region_id));

  return jsonb_build_object('order_id', v_order_id, 'status', 'pending', 'currency', v_currency, 'total_minor', v_total, 'expires_at', v_expires_at, 'replayed', false);
end;
$function$


CREATE OR REPLACE FUNCTION public.ah_create_crypto_invoice(p_user_id uuid, p_order_id uuid, p_asset_code text, p_base_amount_atomic numeric, p_quoted_usdt_minor bigint, p_quote_price_usdt numeric, p_expires_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_order public.ah_orders%rowtype;
  v_existing public.ah_crypto_deposits%rowtype;
  v_amount numeric(78,0);
  v_deposit_id uuid;
  v_attempt integer := 0;
begin
  if p_user_id is null or p_order_id is null or p_asset_code is null
    or p_base_amount_atomic is null or p_quoted_usdt_minor is null
    or p_quote_price_usdt is null or p_expires_at is null then
    raise exception 'invalid_invoice_request' using errcode='22023';
  end if;
  select * into v_order from public.ah_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'order_not_found' using errcode='P0002'; end if;
  if v_order.currency<>'USDT' or v_order.total_minor<=0 then raise exception 'order_must_be_priced_in_usdt' using errcode='22023'; end if;
  if v_order.status not in ('pending','awaiting_payment') then raise exception 'order_not_payable' using errcode='22023'; end if;
  if v_order.expires_at<=now() then raise exception 'order_expired' using errcode='22023'; end if;
  if p_expires_at<=now() or p_expires_at>v_order.expires_at then raise exception 'invalid_quote_expiry' using errcode='22023'; end if;
  if p_quoted_usdt_minor<>v_order.total_minor or p_base_amount_atomic<=0 or p_quote_price_usdt<=0 then raise exception 'invalid_quote' using errcode='22023'; end if;
  if not exists(select 1 from public.ah_crypto_assets where asset_code=p_asset_code and listener_enabled and listener_status='ready') then raise exception 'asset_monitoring_unavailable' using errcode='22023'; end if;

  select * into v_existing from public.ah_crypto_deposits
  where order_id=p_order_id and asset_code=p_asset_code
    and status in ('awaiting','detected','confirming') and expires_at>now()
  order by created_at desc limit 1;
  if found then return v_existing.id; end if;

  loop
    v_amount:=p_base_amount_atomic+v_attempt;
    begin
      insert into public.ah_crypto_deposits(
        order_id,user_id,asset_code,expected_amount_atomic,quoted_usdt_minor,
        quote_price_usdt,quote_expires_at,expires_at,status
      ) values (
        p_order_id,p_user_id,p_asset_code,v_amount,p_quoted_usdt_minor,
        p_quote_price_usdt,p_expires_at,p_expires_at,'awaiting'
      ) returning id into v_deposit_id;
      exit;
    exception when unique_violation then
      v_attempt:=v_attempt+1;
      if v_attempt>100 then raise exception 'invoice_amount_allocation_exhausted' using errcode='23505'; end if;
    end;
  end loop;
  update public.ah_orders set status='awaiting_payment',payment_provider='direct_wallet_crypto',updated_at=now() where id=p_order_id;
  return v_deposit_id;
end;
$function$


CREATE OR REPLACE FUNCTION public.ah_apply_payment_event(p_provider text, p_event_id text, p_order_id uuid, p_event_type text, p_amount_minor bigint, p_currency text, p_payload_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_order public.ah_orders%rowtype;
  v_event public.ah_payment_events%rowtype;
  v_event_row_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_provider is null or p_provider !~ '^[a-z0-9_-]{2,40}$'
    or p_event_id is null or length(p_event_id) < 1 or length(p_event_id) > 200
    or p_order_id is null or p_event_type is distinct from 'payment.succeeded'
    or p_amount_minor is null or p_amount_minor < 0
    or p_currency is null or p_currency !~ '^[A-Z]{3}$'
    or p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_payment_event' using errcode = '22023';
  end if;

  select * into v_order from public.ah_orders where id=p_order_id for update;
  if not found then raise exception 'order_not_found' using errcode='P0002'; end if;
  if v_order.total_minor<>p_amount_minor or upper(v_order.currency::text)<>p_currency then
    raise exception 'payment_amount_or_currency_mismatch' using errcode='22023';
  end if;

  insert into public.ah_payment_events(provider,event_id,order_id,event_type,amount_minor,currency,payload_sha256)
  values(p_provider,p_event_id,p_order_id,p_event_type,p_amount_minor,p_currency,p_payload_sha256)
  on conflict(provider,event_id) do nothing returning id into v_event_row_id;

  if v_event_row_id is null then
    select * into v_event from public.ah_payment_events where provider=p_provider and event_id=p_event_id;
    if v_event.order_id is distinct from p_order_id
      or v_event.amount_minor is distinct from p_amount_minor
      or v_event.currency is distinct from p_currency
      or v_event.payload_sha256 is distinct from p_payload_sha256 then
      raise exception 'payment_event_conflict' using errcode='23505';
    end if;
    return jsonb_build_object('order_id',p_order_id,'status',v_order.status,'duplicate',true);
  end if;

  if v_order.status not in ('pending','awaiting_payment') then raise exception 'order_not_payable' using errcode='22023'; end if;
  if v_order.expires_at<=now() then raise exception 'order_expired' using errcode='22023'; end if;

  update public.ah_orders set status='paid',paid_at=now(),payment_provider=p_provider where id=p_order_id;
  return jsonb_build_object('order_id',p_order_id,'status','paid','duplicate',false);
end;
$function$


CREATE OR REPLACE FUNCTION public.ah_expire_unpaid_orders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_count integer;
begin
  with expired_candidates as (
    select o.id
    from public.ah_orders o
    where o.status in ('pending','awaiting_payment')
      and o.expires_at <= now()
      and not exists (
        select 1 from public.ah_crypto_deposits d
        where d.order_id=o.id
          and d.status in ('detected','confirming')
          and d.received_amount_atomic > 0
          and d.created_at <= o.expires_at
      )
    order by o.expires_at
    for update skip locked
    limit 500
  ), expired_deposits as (
    update public.ah_crypto_deposits d
    set status='expired',updated_at=now()
    from expired_candidates e
    where d.order_id=e.id and d.status='awaiting'
    returning d.id
  ), closed_orders as (
    update public.ah_orders o
    set status='cancelled',updated_at=now()
    from expired_candidates e
    where o.id=e.id and o.status in ('pending','awaiting_payment')
    returning o.id
  )
  select count(*)::integer into v_count from closed_orders;
  return coalesce(v_count,0);
end;
$function$


revoke all on function public.ah_expire_unpaid_orders() from public, anon, authenticated;
grant execute on function public.ah_expire_unpaid_orders() to postgres;
select cron.schedule('ah-expire-unpaid-orders','30 seconds','select public.ah_expire_unpaid_orders();');
select public.ah_expire_unpaid_orders();
