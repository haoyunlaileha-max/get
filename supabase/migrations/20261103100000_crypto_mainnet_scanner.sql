-- Automated chain scanner: isolated Vault secret, authenticated internal RPC and one-minute worker.
begin;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'crypto_scan_cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'crypto_scan_cron_secret', 'Internal authentication for the crypto chain scanner cron');
  end if;
end
$$;

create or replace function public.ah_crypto_scan_authorized(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, vault
as $$
  select coalesce(
    p_secret is not null
    and length(p_secret) >= 32
    and exists (
      select 1 from vault.decrypted_secrets
      where name = 'crypto_scan_cron_secret' and decrypted_secret = p_secret
    ),
    false
  );
$$;
revoke all on function public.ah_crypto_scan_authorized(text) from public, anon, authenticated;
grant execute on function public.ah_crypto_scan_authorized(text) to service_role;

-- Enable only adapters implemented with public mainnet endpoints. Key-dependent
-- providers remain fail-closed and are not offered for new invoices.
update public.ah_crypto_assets
set listener_enabled = true, listener_status = 'ready', updated_at = now()
where asset_code in ('BTC','LTC','ETH','USDT_ERC20','BNB_BEP20','SOL');

update public.ah_crypto_assets
set listener_enabled = false, listener_status = 'awaiting_provider', updated_at = now()
where asset_code in ('TRX','USDT_TRC20','TON');

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
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'crypto_scan_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $job$
);

commit;
