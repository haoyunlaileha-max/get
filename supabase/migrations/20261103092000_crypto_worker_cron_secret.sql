begin;

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select vault.create_secret(
  encode(gen_random_bytes(32),'hex'),
  'crypto_cron_secret',
  'Private bearer proof for scheduled internal crypto worker invocations'
)
where not exists (
  select 1 from vault.secrets where name='crypto_cron_secret'
);

create or replace function public.ah_verify_crypto_cron_secret(p_candidate text)
returns boolean
language sql
security definer
set search_path=pg_catalog,vault,public,pg_temp
as $$
  select coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name='crypto_cron_secret') = p_candidate,
    false
  );
$$;

revoke all on function public.ah_verify_crypto_cron_secret(text) from public,anon,authenticated;
grant execute on function public.ah_verify_crypto_cron_secret(text) to service_role;

do $$
declare v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname='ah-crypto-telegram-outbox-dispatch'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end $$;

select cron.schedule(
  'ah-crypto-telegram-outbox-dispatch',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='project_url')
        || '/functions/v1/telegram-dispatch',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'apikey',(select decrypted_secret from vault.decrypted_secrets where name='publishable_key'),
        'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='crypto_cron_secret')
      ),
      body := '{"action":"dispatch","limit":20}'::jsonb,
      timeout_milliseconds := 10000
    ) as request_id;
  $job$
);

commit;