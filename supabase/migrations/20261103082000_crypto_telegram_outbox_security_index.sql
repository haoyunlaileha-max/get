-- Index the outbox foreign key and make worker-only RLS explicit.
begin;
create index if not exists ah_crypto_telegram_outbox_deposit_idx
  on public.ah_crypto_telegram_outbox(deposit_id,created_at desc);
drop policy if exists ah_crypto_telegram_outbox_service_role_all on public.ah_crypto_telegram_outbox;
create policy ah_crypto_telegram_outbox_service_role_all
  on public.ah_crypto_telegram_outbox
  for all to service_role using (true) with check (true);
commit;
