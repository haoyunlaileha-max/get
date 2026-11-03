-- Harden the first deployed core migration's helper functions.
-- Trigger execution remains available; direct API execution of the trigger
-- function is intentionally revoked from browser roles.

begin;
alter function public.ah_is_admin() set search_path = pg_catalog, public, auth;
alter function public.ah_set_updated_at() set search_path = pg_catalog;
alter function public.ah_handle_new_user() set search_path = pg_catalog, public;
revoke all on function public.ah_handle_new_user() from public, anon, authenticated;
commit;
