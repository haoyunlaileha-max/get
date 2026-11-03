-- Read-only operational visibility for admins.
-- Catalog writes remain governed by the existing ah_is_admin() policies.
-- This migration touches only ah_* tables and grants no browser access to secrets.

begin;

grant select on public.ah_payment_events to authenticated;
drop policy if exists ah_payment_events_admin_read on public.ah_payment_events;
create policy ah_payment_events_admin_read on public.ah_payment_events
for select to authenticated
using (public.ah_is_admin());

grant select on public.ah_provisioning_jobs to authenticated;
drop policy if exists ah_provisioning_jobs_admin_read on public.ah_provisioning_jobs;
create policy ah_provisioning_jobs_admin_read on public.ah_provisioning_jobs
for select to authenticated
using (public.ah_is_admin());

commit;
