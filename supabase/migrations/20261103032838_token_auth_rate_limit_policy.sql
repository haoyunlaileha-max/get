-- Explicitly document the service-role-only access path for the private limiter.
begin;
drop policy if exists ah_token_auth_rate_limits_service_role_all on public.ah_token_auth_rate_limits;
create policy ah_token_auth_rate_limits_service_role_all
on public.ah_token_auth_rate_limits
for all to service_role
using (true)
with check (true);
commit;
