-- Schedule the transactional Telegram outbox dispatcher.
-- Only a publishable key is stored in Vault; no service-role credential is exposed to SQL or cron.
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select vault.create_secret(
  'https://izuxtqmjdtzxvnfwppls.supabase.co',
  'project_url',
  'Supabase project URL used by the Telegram outbox cron job'
)
where not exists (select 1 from vault.secrets where name = 'project_url');

select vault.create_secret(
  'sb_publishable_2BLyLQEvfTlKWSiOMkQMdQ_KBWG0FTx',
  'publishable_key',
  'Public publishable key used only to authenticate the scheduled Edge Function invocation'
)
where not exists (select 1 from vault.secrets where name = 'publishable_key');

select cron.schedule(
  'ah-crypto-telegram-outbox-dispatch',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
        || '/functions/v1/telegram-dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
      ),
      body := '{"action":"dispatch","limit":20}'::jsonb,
      timeout_milliseconds := 10000
    ) as request_id;
  $job$
);

commit;
