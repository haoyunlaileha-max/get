-- Remove inherited broad default grants from Anonymous Hosting tables.
-- Keep public read access only for active catalog data; all other access is least-privilege.

begin;

revoke all on table
  public.ah_profiles,
  public.ah_regions,
  public.ah_products,
  public.ah_plans,
  public.ah_orders,
  public.ah_order_items,
  public.ah_payment_events,
  public.ah_provisioning_jobs,
  public.ah_plan_regions,
  public.ah_token_auth_rate_limits
from public, anon, authenticated;

grant select on public.ah_regions, public.ah_products, public.ah_plans to anon;

grant select, insert, update, delete
  on public.ah_regions, public.ah_products, public.ah_plans
  to authenticated;

grant select, insert, update, delete on public.ah_profiles to authenticated;
grant select, insert, update, delete on public.ah_orders, public.ah_order_items to authenticated;
grant select on public.ah_payment_events, public.ah_provisioning_jobs to authenticated;
grant select, insert, update, delete on public.ah_plan_regions to authenticated;

grant all privileges on table
  public.ah_profiles,
  public.ah_regions,
  public.ah_products,
  public.ah_plans,
  public.ah_orders,
  public.ah_order_items,
  public.ah_payment_events,
  public.ah_provisioning_jobs,
  public.ah_plan_regions,
  public.ah_token_auth_rate_limits
to service_role;

-- Trigger helpers are not callable RPC endpoints.
revoke all on function public.ah_set_updated_at() from public, anon, authenticated;
revoke all on function public.ah_plan_regions_set_updated_at() from public, anon, authenticated;

commit;