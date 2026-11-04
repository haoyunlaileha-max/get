-- USDT-denominated catalog pricing and secure direct-wallet invoice allocation.
begin;
alter table public.ah_plans alter column currency type varchar(4) using btrim(currency);
alter table public.ah_plans alter column currency set default 'USDT';
alter table public.ah_orders alter column currency type varchar(4) using btrim(currency);
alter table public.ah_orders alter column currency set default 'USDT';
update public.ah_crypto_assets set display_name='Toncoin',ticker='TON',network='TON mainnet (native Toncoin)',updated_at=now() where asset_code='TON';
alter table public.ah_crypto_deposits add column if not exists quoted_usdt_minor bigint, add column if not exists quote_price_usdt numeric(38,18), add column if not exists quote_expires_at timestamptz;

create or replace function public.ah_create_order(p_user_id uuid,p_plan_id uuid,p_region_id uuid,p_quantity integer,p_idempotency_key text,p_customer_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_fingerprint text; v_existing public.ah_orders%rowtype; v_plan_name text; v_price_minor bigint; v_currency varchar(4); v_order_id uuid; v_total bigint;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
 if p_user_id is null or p_plan_id is null then raise exception 'invalid_order' using errcode='22023'; end if;
 if p_quantity is null or p_quantity<1 or p_quantity>20 then raise exception 'invalid_quantity' using errcode='22023'; end if;
 if p_idempotency_key is null or length(p_idempotency_key)<16 or length(p_idempotency_key)>128 or p_idempotency_key !~ '^[A-Za-z0-9._:-]+$' then raise exception 'invalid_idempotency_key' using errcode='22023'; end if;
 if p_customer_note is not null and length(p_customer_note)>500 then raise exception 'invalid_customer_note' using errcode='22023'; end if;
 v_fingerprint:=md5(p_plan_id::text||'|'||coalesce(p_region_id::text,'')||'|'||p_quantity::text||'|'||coalesce(p_customer_note,''));
 select * into v_existing from public.ah_orders where user_id=p_user_id and idempotency_key=p_idempotency_key;
 if found then
  if v_existing.request_fingerprint is distinct from v_fingerprint then raise exception 'idempotency_conflict' using errcode='23505'; end if;
  return jsonb_build_object('order_id',v_existing.id,'status',v_existing.status,'currency',v_existing.currency,'total_minor',v_existing.total_minor,'replayed',true);
 end if;
 select pl.name,pl.price_minor,pl.currency into v_plan_name,v_price_minor,v_currency from public.ah_plans pl join public.ah_products pr on pr.id=pl.product_id where pl.id=p_plan_id and pl.is_active=true and pr.is_active=true;
 if not found then raise exception 'plan_unavailable' using errcode='P0002'; end if;
 if v_currency<>'USDT' then raise exception 'plan_currency_must_be_usdt' using errcode='22023'; end if;
 if p_region_id is not null and not exists(select 1 from public.ah_regions where id=p_region_id and status='active') then raise exception 'region_unavailable' using errcode='P0002'; end if;
 if v_price_minor>0 and v_price_minor>9223372036854775807::bigint/p_quantity then raise exception 'order_total_overflow' using errcode='22003'; end if;
 v_total:=v_price_minor*p_quantity;
 insert into public.ah_orders(user_id,region_id,status,currency,subtotal_minor,total_minor,idempotency_key,request_fingerprint,customer_note)
 values(p_user_id,p_region_id,'pending',v_currency,v_total,v_total,p_idempotency_key,v_fingerprint,nullif(p_customer_note,'')) on conflict(user_id,idempotency_key) do nothing returning id into v_order_id;
 if v_order_id is null then
  select * into v_existing from public.ah_orders where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if not found or v_existing.request_fingerprint is distinct from v_fingerprint then raise exception 'idempotency_conflict' using errcode='23505'; end if;
  return jsonb_build_object('order_id',v_existing.id,'status',v_existing.status,'currency',v_existing.currency,'total_minor',v_existing.total_minor,'replayed',true);
 end if;
 insert into public.ah_order_items(order_id,plan_id,description_snapshot,quantity,unit_price_minor,configuration) values(v_order_id,p_plan_id,v_plan_name,p_quantity,v_price_minor,jsonb_build_object('region_id',p_region_id));
 return jsonb_build_object('order_id',v_order_id,'status','pending','currency',v_currency,'total_minor',v_total,'replayed',false);
end; $$;

create or replace function public.ah_create_crypto_invoice(p_user_id uuid,p_order_id uuid,p_asset_code text,p_base_amount_atomic numeric,p_quoted_usdt_minor bigint,p_quote_price_usdt numeric,p_expires_at timestamptz)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_order public.ah_orders%rowtype; v_existing public.ah_crypto_deposits%rowtype; v_deposit_id uuid; v_amount numeric(78,0); v_attempt integer:=0;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
 select * into v_order from public.ah_orders where id=p_order_id and user_id=p_user_id for update;
 if not found then raise exception 'order_not_found' using errcode='P0002'; end if;
 if v_order.currency<>'USDT' or v_order.total_minor<=0 then raise exception 'order_must_be_priced_in_usdt' using errcode='22023'; end if;
 if v_order.status not in('pending','awaiting_payment') then raise exception 'order_not_payable' using errcode='22023'; end if;
 if p_expires_at<=now() or p_expires_at>now()+interval '30 minutes' then raise exception 'invalid_quote_expiry' using errcode='22023'; end if;
 if p_quoted_usdt_minor<>v_order.total_minor or p_base_amount_atomic<=0 or p_quote_price_usdt<=0 then raise exception 'invalid_quote' using errcode='22023'; end if;
 if not exists(select 1 from public.ah_crypto_assets where asset_code=p_asset_code) then raise exception 'unsupported_crypto_asset' using errcode='22023'; end if;
 select * into v_existing from public.ah_crypto_deposits where order_id=p_order_id and asset_code=p_asset_code and status in('awaiting','detected','confirming') and expires_at>now() order by created_at desc limit 1;
 if found then return v_existing.id; end if;
 loop
  v_amount:=p_base_amount_atomic+v_attempt;
  begin
   insert into public.ah_crypto_deposits(order_id,user_id,asset_code,expected_amount_atomic,quoted_usdt_minor,quote_price_usdt,quote_expires_at,expires_at,status)
   values(p_order_id,p_user_id,p_asset_code,v_amount,p_quoted_usdt_minor,p_quote_price_usdt,p_expires_at,p_expires_at,'awaiting') returning id into v_deposit_id;
   exit;
  exception when unique_violation then v_attempt:=v_attempt+1; if v_attempt>100 then raise exception 'invoice_amount_allocation_exhausted' using errcode='23505'; end if;
  end;
 end loop;
 update public.ah_orders set status='awaiting_payment',payment_provider='direct_wallet_crypto',updated_at=now() where id=p_order_id;
 return v_deposit_id;
end; $$;
revoke all on function public.ah_create_crypto_invoice(uuid,uuid,text,numeric,bigint,numeric,timestamptz) from public,anon,authenticated;
grant execute on function public.ah_create_crypto_invoice(uuid,uuid,text,numeric,bigint,numeric,timestamptz) to service_role;
commit;
