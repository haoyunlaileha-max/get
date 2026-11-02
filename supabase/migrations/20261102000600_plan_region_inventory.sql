-- Per-plan data-center availability and transactional capacity reservations.
-- Apply after 20261102000500_admin_console_read_access.sql.
-- All objects are isolated under the ah_* namespace.

begin;

create table if not exists public.ah_plan_regions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.ah_plans(id) on delete cascade,
  region_id uuid not null references public.ah_regions(id) on delete cascade,
  is_available boolean not null default false,
  capacity_units integer,
  allocated_units integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ah_plan_regions_plan_region_unique unique (plan_id, region_id),
  constraint ah_plan_regions_capacity_nonnegative check (capacity_units is null or capacity_units >= 0),
  constraint ah_plan_regions_allocated_nonnegative check (allocated_units >= 0)
);

create index if not exists ah_plan_regions_region_idx
  on public.ah_plan_regions (region_id, is_available);
create index if not exists ah_plan_regions_plan_idx
  on public.ah_plan_regions (plan_id, is_available);

alter table public.ah_orders
  add column if not exists inventory_released_at timestamptz;

create or replace function public.ah_plan_regions_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ah_plan_regions_set_updated_at on public.ah_plan_regions;
create trigger ah_plan_regions_set_updated_at
before update on public.ah_plan_regions
for each row execute function public.ah_plan_regions_set_updated_at();

-- When an operator adds a mapping after orders already exist, account for
-- non-terminal orders before the mapping becomes available for new sales.
create or replace function public.ah_plan_regions_seed_allocations()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform 1 from public.ah_plans where id = new.plan_id for update;
  select coalesce(sum(oi.quantity), 0)::integer
    into new.allocated_units
  from public.ah_order_items oi
  join public.ah_orders o on o.id = oi.order_id
  where oi.plan_id = new.plan_id
    and o.region_id = new.region_id
    and o.status not in ('cancelled', 'failed', 'refunded')
    and o.inventory_released_at is null;
  return new;
end;
$$;

drop trigger if exists ah_plan_regions_seed_allocations on public.ah_plan_regions;
create trigger ah_plan_regions_seed_allocations
before insert on public.ah_plan_regions
for each row execute function public.ah_plan_regions_seed_allocations();

-- Capacity is reserved atomically when an order is created and released once
-- when an order reaches a terminal state before successful service delivery.
create or replace function public.ah_release_order_inventory()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_item record;
begin
  if new.status in ('cancelled', 'failed', 'refunded')
     and old.status is distinct from new.status
     and old.inventory_released_at is null
     and old.region_id is not null then
    for v_item in
      select plan_id, quantity
      from public.ah_order_items
      where order_id = new.id and plan_id is not null
    loop
      update public.ah_plan_regions
      set allocated_units = greatest(0, allocated_units - v_item.quantity)
      where plan_id = v_item.plan_id and region_id = old.region_id;
    end loop;
    update public.ah_orders
    set inventory_released_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists ah_orders_release_inventory on public.ah_orders;
create trigger ah_orders_release_inventory
after update of status on public.ah_orders
for each row execute function public.ah_release_order_inventory();

alter table public.ah_plan_regions enable row level security;

drop policy if exists ah_plan_regions_admin_read on public.ah_plan_regions;
create policy ah_plan_regions_admin_read on public.ah_plan_regions
for select to authenticated
using (public.ah_is_admin());

drop policy if exists ah_plan_regions_admin_write on public.ah_plan_regions;
create policy ah_plan_regions_admin_write on public.ah_plan_regions
for all to authenticated
using (public.ah_is_admin())
with check (public.ah_is_admin());

grant select, insert, update, delete on public.ah_plan_regions to authenticated;

-- Replace the trusted order function with the same identity, pricing,
-- idempotency and validation rules plus per-plan region and capacity checks.
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
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_fingerprint text;
  v_existing public.ah_orders%rowtype;
  v_plan_name text;
  v_price_minor bigint;
  v_currency char(3);
  v_order_id uuid;
  v_total bigint;
  v_region_map public.ah_plan_regions%rowtype;
  v_has_region_rules boolean := false;
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
  where pl.id = p_plan_id and pl.is_active = true and pr.is_active = true
  for key share of pl;

  if not found then
    raise exception 'plan_unavailable' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.ah_plan_regions
    where plan_id = p_plan_id
  ) into v_has_region_rules;

  if v_has_region_rules then
    if p_region_id is null then
      raise exception 'plan_region_required' using errcode = 'P0002';
    end if;

    select * into v_region_map
    from public.ah_plan_regions
    where plan_id = p_plan_id and region_id = p_region_id
    for update;

    if not found or not v_region_map.is_available then
      raise exception 'plan_region_unavailable' using errcode = 'P0002';
    end if;

    if not exists (
      select 1 from public.ah_regions r
      where r.id = p_region_id and r.status = 'active'
    ) then
      raise exception 'region_unavailable' using errcode = 'P0002';
    end if;

    if v_region_map.capacity_units is not null
       and v_region_map.allocated_units + p_quantity > v_region_map.capacity_units then
      raise exception 'plan_region_out_of_stock' using errcode = 'P0002';
    end if;
  elsif p_region_id is not null and not exists (
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

  if v_has_region_rules then
    update public.ah_plan_regions
    set allocated_units = allocated_units + p_quantity
    where id = v_region_map.id;
  end if;

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
