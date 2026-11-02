-- Trusted, atomic order creation for the Anonymous Hosting Edge Function.
-- Apply after 20261102000100_anonymous_hosting_core.sql.
-- This migration touches only ah_* objects.

begin;

alter table public.ah_orders
  add column if not exists request_fingerprint text;

create or replace function public.ah_create_order(
  p_user_id uuid,
  p_plan_id uuid,
  p_region_id uuid,
  p_quantity integer,
  p_idempotency_key text,
  p_customer_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fingerprint text;
  v_existing public.ah_orders%rowtype;
  v_plan_name text;
  v_price_minor bigint;
  v_currency char(3);
  v_order_id uuid;
  v_total bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_user_id is null or p_plan_id is null then
    raise exception 'invalid_order' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 20 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  if p_idempotency_key is null
     or length(p_idempotency_key) < 16
     or length(p_idempotency_key) > 128
     or p_idempotency_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;
  if p_customer_note is not null and length(p_customer_note) > 500 then
    raise exception 'invalid_customer_note' using errcode = '22023';
  end if;

  v_fingerprint := md5(
    p_plan_id::text || '|' ||
    coalesce(p_region_id::text, '') || '|' ||
    p_quantity::text || '|' ||
    coalesce(p_customer_note, '')
  );

  select * into v_existing
  from public.ah_orders
  where user_id = p_user_id and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'idempotency_conflict' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'order_id', v_existing.id,
      'status', v_existing.status,
      'currency', v_existing.currency,
      'total_minor', v_existing.total_minor,
      'replayed', true
    );
  end if;

  select pl.name, pl.price_minor, pl.currency
    into v_plan_name, v_price_minor, v_currency
  from public.ah_plans pl
  join public.ah_products pr on pr.id = pl.product_id
  where pl.id = p_plan_id and pl.is_active = true and pr.is_active = true;

  if not found then
    raise exception 'plan_unavailable' using errcode = 'P0002';
  end if;

  if p_region_id is not null and not exists (
    select 1 from public.ah_regions r
    where r.id = p_region_id and r.status = 'active'
  ) then
    raise exception 'region_unavailable' using errcode = 'P0002';
  end if;

  if v_price_minor > 0 and v_price_minor > 9223372036854775807::bigint / p_quantity then
    raise exception 'order_total_overflow' using errcode = '22003';
  end if;
  v_total := v_price_minor * p_quantity;

  insert into public.ah_orders (
    user_id, region_id, status, currency, subtotal_minor, total_minor,
    idempotency_key, request_fingerprint, customer_note
  ) values (
    p_user_id, p_region_id, 'pending', v_currency, v_total, v_total,
    p_idempotency_key, v_fingerprint, nullif(p_customer_note, '')
  )
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_order_id;

  if v_order_id is null then
    select * into v_existing
    from public.ah_orders
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
    if not found or v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'idempotency_conflict' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'order_id', v_existing.id,
      'status', v_existing.status,
      'currency', v_existing.currency,
      'total_minor', v_existing.total_minor,
      'replayed', true
    );
  end if;

  insert into public.ah_order_items (
    order_id, plan_id, description_snapshot, quantity, unit_price_minor, configuration
  ) values (
    v_order_id, p_plan_id, v_plan_name, p_quantity, v_price_minor,
    jsonb_build_object('region_id', p_region_id)
  );

  return jsonb_build_object(
    'order_id', v_order_id,
    'status', 'pending',
    'currency', v_currency,
    'total_minor', v_total,
    'replayed', false
  );
end;
$$;

revoke all on function public.ah_create_order(uuid, uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.ah_create_order(uuid, uuid, uuid, integer, text, text) to service_role;

commit;
