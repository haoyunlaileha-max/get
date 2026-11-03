-- Browser-authenticated users may inspect permitted orders, but order writes
-- must pass through service-role-only server workflows.
begin;

drop policy if exists ah_orders_admin_insert on public.ah_orders;
drop policy if exists ah_orders_admin_update on public.ah_orders;
drop policy if exists ah_orders_admin_delete on public.ah_orders;
drop policy if exists ah_order_items_admin_insert on public.ah_order_items;
drop policy if exists ah_order_items_admin_update on public.ah_order_items;
drop policy if exists ah_order_items_admin_delete on public.ah_order_items;

revoke all on table public.ah_orders, public.ah_order_items from authenticated;
grant select on table public.ah_orders, public.ah_order_items to authenticated;

commit;
