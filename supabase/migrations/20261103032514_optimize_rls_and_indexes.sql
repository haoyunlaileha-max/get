-- Reduce overlapping permissive policies and index foreign-key lookup columns.
-- This migration preserves the existing row access model while separating admin writes.

begin;

create index if not exists ah_orders_region_idx
  on public.ah_orders (region_id);
create index if not exists ah_order_items_plan_idx
  on public.ah_order_items (plan_id);

-- Profiles: self/admin SELECT and UPDATE policies already cover those actions.
drop policy if exists ah_profiles_admin_all on public.ah_profiles;
create policy ah_profiles_admin_insert on public.ah_profiles
for insert to authenticated
with check (public.ah_is_admin());
create policy ah_profiles_admin_delete on public.ah_profiles
for delete to authenticated
using (public.ah_is_admin());

-- Catalog tables: public-read policies already include administrators.
drop policy if exists ah_regions_admin_all on public.ah_regions;
create policy ah_regions_admin_insert on public.ah_regions
for insert to authenticated with check (public.ah_is_admin());
create policy ah_regions_admin_update on public.ah_regions
for update to authenticated using (public.ah_is_admin()) with check (public.ah_is_admin());
create policy ah_regions_admin_delete on public.ah_regions
for delete to authenticated using (public.ah_is_admin());

drop policy if exists ah_products_admin_all on public.ah_products;
create policy ah_products_admin_insert on public.ah_products
for insert to authenticated with check (public.ah_is_admin());
create policy ah_products_admin_update on public.ah_products
for update to authenticated using (public.ah_is_admin()) with check (public.ah_is_admin());
create policy ah_products_admin_delete on public.ah_products
for delete to authenticated using (public.ah_is_admin());

drop policy if exists ah_plans_admin_all on public.ah_plans;
create policy ah_plans_admin_insert on public.ah_plans
for insert to authenticated with check (public.ah_is_admin());
create policy ah_plans_admin_update on public.ah_plans
for update to authenticated using (public.ah_is_admin()) with check (public.ah_is_admin());
create policy ah_plans_admin_delete on public.ah_plans
for delete to authenticated using (public.ah_is_admin());

-- Order SELECT policies already include administrators; keep writes admin-only.
drop policy if exists ah_orders_admin_all on public.ah_orders;
create policy ah_orders_admin_insert on public.ah_orders
for insert to authenticated with check (public.ah_is_admin());
create policy ah_orders_admin_update on public.ah_orders
for update to authenticated using (public.ah_is_admin()) with check (public.ah_is_admin());
create policy ah_orders_admin_delete on public.ah_orders
for delete to authenticated using (public.ah_is_admin());

drop policy if exists ah_order_items_admin_all on public.ah_order_items;
create policy ah_order_items_admin_insert on public.ah_order_items
for insert to authenticated with check (public.ah_is_admin());
create policy ah_order_items_admin_update on public.ah_order_items
for update to authenticated using (public.ah_is_admin()) with check (public.ah_is_admin());
create policy ah_order_items_admin_delete on public.ah_order_items
for delete to authenticated using (public.ah_is_admin());

-- Plan/region inventory is admin-readable; split its write policy by operation.
drop policy if exists ah_plan_regions_admin_write on public.ah_plan_regions;
create policy ah_plan_regions_admin_insert on public.ah_plan_regions
for insert to authenticated with check (public.ah_is_admin());
create policy ah_plan_regions_admin_update on public.ah_plan_regions
for update to authenticated using (public.ah_is_admin()) with check (public.ah_is_admin());
create policy ah_plan_regions_admin_delete on public.ah_plan_regions
for delete to authenticated using (public.ah_is_admin());

commit;