-- Anonymous Hosting core schema (additive migration).
-- Apply only to the intended Supabase project after reviewing its existing schema.
-- This migration creates ah_* objects and does not modify unrelated application tables.

begin;

create or replace function public.ah_is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

create table if not exists public.ah_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ah_regions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  city text not null,
  country_code char(2) not null,
  status text not null default 'inactive' check (status in ('active', 'inactive', 'maintenance')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ah_products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null check (category in ('linux_vps', 'dedicated_server', 'windows_rdp', 'gpu', 'domain')),
  description text,
  is_active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ah_plans (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.ah_products(id) on delete restrict,
  code text not null unique,
  name text not null,
  description text,
  price_minor bigint not null check (price_minor >= 0),
  currency char(3) not null default 'USD',
  billing_period text not null default 'monthly'
    check (billing_period in ('hourly', 'monthly', 'quarterly', 'annually', 'one_time')),
  specs jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ah_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  region_id uuid references public.ah_regions(id) on delete set null,
  status text not null default 'pending'
    check (status in ('draft', 'pending', 'awaiting_payment', 'paid', 'provisioning', 'active', 'suspended', 'cancelled', 'failed', 'refunded')),
  currency char(3) not null default 'USD',
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  idempotency_key text,
  customer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table if not exists public.ah_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.ah_orders(id) on delete cascade,
  plan_id uuid references public.ah_plans(id) on delete set null,
  description_snapshot text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ah_orders_user_created_idx
  on public.ah_orders (user_id, created_at desc);
create index if not exists ah_order_items_order_idx
  on public.ah_order_items (order_id);
create index if not exists ah_plans_product_active_idx
  on public.ah_plans (product_id, is_active, sort_order);

create or replace function public.ah_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ah_profiles_set_updated_at on public.ah_profiles;
create trigger ah_profiles_set_updated_at before update on public.ah_profiles
for each row execute function public.ah_set_updated_at();

drop trigger if exists ah_regions_set_updated_at on public.ah_regions;
create trigger ah_regions_set_updated_at before update on public.ah_regions
for each row execute function public.ah_set_updated_at();

drop trigger if exists ah_products_set_updated_at on public.ah_products;
create trigger ah_products_set_updated_at before update on public.ah_products
for each row execute function public.ah_set_updated_at();

drop trigger if exists ah_plans_set_updated_at on public.ah_plans;
create trigger ah_plans_set_updated_at before update on public.ah_plans
for each row execute function public.ah_set_updated_at();

drop trigger if exists ah_orders_set_updated_at on public.ah_orders;
create trigger ah_orders_set_updated_at before update on public.ah_orders
for each row execute function public.ah_set_updated_at();

create or replace function public.ah_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ah_profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists ah_auth_user_created on auth.users;
create trigger ah_auth_user_created
after insert on auth.users
for each row execute function public.ah_handle_new_user();

alter table public.ah_profiles enable row level security;
alter table public.ah_regions enable row level security;
alter table public.ah_products enable row level security;
alter table public.ah_plans enable row level security;
alter table public.ah_orders enable row level security;
alter table public.ah_order_items enable row level security;

drop policy if exists ah_profiles_read_self on public.ah_profiles;
create policy ah_profiles_read_self on public.ah_profiles
for select to authenticated
using (id = (select auth.uid()) or public.ah_is_admin());

drop policy if exists ah_profiles_update_self on public.ah_profiles;
create policy ah_profiles_update_self on public.ah_profiles
for update to authenticated
using (id = (select auth.uid()) or public.ah_is_admin())
with check (id = (select auth.uid()) or public.ah_is_admin());

drop policy if exists ah_profiles_admin_all on public.ah_profiles;
create policy ah_profiles_admin_all on public.ah_profiles
for all to authenticated
using (public.ah_is_admin())
with check (public.ah_is_admin());

drop policy if exists ah_regions_public_read on public.ah_regions;
create policy ah_regions_public_read on public.ah_regions
for select to anon, authenticated
using (status = 'active' or (select public.ah_is_admin()));

drop policy if exists ah_regions_admin_all on public.ah_regions;
create policy ah_regions_admin_all on public.ah_regions
for all to authenticated
using (public.ah_is_admin())
with check (public.ah_is_admin());

drop policy if exists ah_products_public_read on public.ah_products;
create policy ah_products_public_read on public.ah_products
for select to anon, authenticated
using (is_active or (select public.ah_is_admin()));

drop policy if exists ah_products_admin_all on public.ah_products;
create policy ah_products_admin_all on public.ah_products
for all to authenticated
using (public.ah_is_admin())
with check (public.ah_is_admin());

drop policy if exists ah_plans_public_read on public.ah_plans;
create policy ah_plans_public_read on public.ah_plans
for select to anon, authenticated
using (
  is_active
  and exists (
    select 1 from public.ah_products p
    where p.id = product_id and p.is_active
  )
  or (select public.ah_is_admin())
);

drop policy if exists ah_plans_admin_all on public.ah_plans;
create policy ah_plans_admin_all on public.ah_plans
for all to authenticated
using (public.ah_is_admin())
with check (public.ah_is_admin());

drop policy if exists ah_orders_read_own on public.ah_orders;
create policy ah_orders_read_own on public.ah_orders
for select to authenticated
using (user_id = (select auth.uid()) or public.ah_is_admin());

drop policy if exists ah_orders_admin_all on public.ah_orders;
create policy ah_orders_admin_all on public.ah_orders
for all to authenticated
using (public.ah_is_admin())
with check (public.ah_is_admin());

drop policy if exists ah_order_items_read_own on public.ah_order_items;
create policy ah_order_items_read_own on public.ah_order_items
for select to authenticated
using (
  exists (
    select 1 from public.ah_orders o
    where o.id = order_id
      and (o.user_id = (select auth.uid()) or public.ah_is_admin())
  )
);

drop policy if exists ah_order_items_admin_all on public.ah_order_items;
create policy ah_order_items_admin_all on public.ah_order_items
for all to authenticated
using (public.ah_is_admin())
with check (public.ah_is_admin());

grant select on public.ah_regions, public.ah_products, public.ah_plans to anon, authenticated;
grant select, update on public.ah_profiles to authenticated;
grant select on public.ah_orders, public.ah_order_items to authenticated;
grant execute on function public.ah_is_admin() to anon, authenticated;

commit;
