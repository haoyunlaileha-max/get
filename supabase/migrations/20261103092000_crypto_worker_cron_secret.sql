create extension if not exists pgcrypto;
select vault.create_secret(encode(gen_random_bytes(32),'hex'),'crypto_cron_secret','Private worker cron token') where not exists(select 1 from vault.secrets where name='crypto_cron_secret');
