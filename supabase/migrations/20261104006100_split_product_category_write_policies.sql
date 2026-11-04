-- Keep category SELECT policies separate from admin write policies to avoid
-- overlapping permissive SELECT rules for authenticated users.
begin;
drop policy if exists ah_product_categories_admin_write on public.ah_product_categories;
drop policy if exists ah_product_categories_admin_insert on public.ah_product_categories;
create policy ah_product_categories_admin_insert
on public.ah_product_categories for insert to authenticated
with check (public.ah_is_admin());
drop policy if exists ah_product_categories_admin_update on public.ah_product_categories;
create policy ah_product_categories_admin_update
on public.ah_product_categories for update to authenticated
using (public.ah_is_admin())
with check (public.ah_is_admin());
drop policy if exists ah_product_categories_admin_delete on public.ah_product_categories;
create policy ah_product_categories_admin_delete
on public.ah_product_categories for delete to authenticated
using (public.ah_is_admin());
commit;