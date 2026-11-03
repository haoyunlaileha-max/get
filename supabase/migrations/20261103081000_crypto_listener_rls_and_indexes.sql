-- Tighten crypto deposit read policy and make worker-only tables explicit.
begin;
create index if not exists ah_crypto_deposits_user_idx on public.ah_crypto_deposits(user_id,created_at desc);
drop policy if exists ah_crypto_deposits_owner_read on public.ah_crypto_deposits;
create policy ah_crypto_deposits_owner_read on public.ah_crypto_deposits
  for select to authenticated using ((select auth.uid())=user_id or public.ah_is_admin());
drop policy if exists ah_crypto_transfers_service_role_all on public.ah_crypto_transfers;
create policy ah_crypto_transfers_service_role_all on public.ah_crypto_transfers
  for all to service_role using (true) with check (true);
drop policy if exists ah_crypto_listener_cursors_service_role_all on public.ah_crypto_listener_cursors;
create policy ah_crypto_listener_cursors_service_role_all on public.ah_crypto_listener_cursors
  for all to service_role using (true) with check (true);
commit;
