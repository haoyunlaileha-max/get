-- Public storefronts may read only genuinely sellable plan/region mappings.
-- Admin-only writes remain unchanged; authenticated admins can still read all rows.
grant select on table public.ah_plan_regions to anon, authenticated;
drop policy if exists ah_plan_regions_public_available_read on public.ah_plan_regions;
drop policy if exists ah_plan_regions_anon_available_read on public.ah_plan_regions;
drop policy if exists ah_plan_regions_authenticated_read on public.ah_plan_regions;
create policy ah_plan_regions_anon_available_read
on public.ah_plan_regions
for select
to anon
using (
  is_available
  and (capacity_units is null or allocated_units < capacity_units)
  and exists (
    select 1 from public.ah_plans p
    join public.ah_products pr on pr.id = p.product_id
    where p.id = ah_plan_regions.plan_id and p.is_active and pr.is_active
  )
  and exists (
    select 1 from public.ah_regions r
    where r.id = ah_plan_regions.region_id and r.status = 'active'
  )
);
create policy ah_plan_regions_authenticated_read
on public.ah_plan_regions
for select
to authenticated
using (
  public.ah_is_admin()
  or (
    is_available
    and (capacity_units is null or allocated_units < capacity_units)
    and exists (
      select 1 from public.ah_plans p
      join public.ah_products pr on pr.id = p.product_id
      where p.id = ah_plan_regions.plan_id and p.is_active and pr.is_active
    )
    and exists (
      select 1 from public.ah_regions r
      where r.id = ah_plan_regions.region_id and r.status = 'active'
    )
  )
);
