-- Give the scheduled mainnet scanner enough time to resolve and query public RPC endpoints.
begin;
select cron.unschedule(jobid) from cron.job where jobname = 'ah-crypto-chain-scanner';
select cron.schedule(
  'ah-crypto-chain-scanner',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select rtrim(decrypted_secret, '/') from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/crypto-scanner',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'crypto_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $job$
);
commit;
