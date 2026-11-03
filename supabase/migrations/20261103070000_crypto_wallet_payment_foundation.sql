-- Direct-wallet cryptocurrency payment foundation.
-- Public receiving addresses only; no private keys or signing material are stored.
-- Monitoring remains disabled until chain-specific RPC/indexer credentials and cron are configured.

begin;

create table if not exists public.ah_crypto_assets (
  asset_code text primary key,
  display_name text not null,
  ticker text not null,
  network text not null,
  chain_family text not null check (chain_family in ('bitcoin','litecoin','evm','tron','solana','ton')),
  token_contract text,
  decimals smallint not null check (decimals between 0 and 30),
  wallet_address text not null,
  confirmations_required integer not null check (confirmations_required >= 1),
  listener_enabled boolean not null default false,
  listener_status text not null default 'awaiting_provider'
    check (listener_status in ('awaiting_provider','disabled','ready','degraded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ah_crypto_assets enable row level security;
revoke all on public.ah_crypto_assets from public, anon, authenticated;
grant select on public.ah_crypto_assets to authenticated;
grant select, insert, update, delete on public.ah_crypto_assets to service_role;
drop policy if exists ah_crypto_assets_admin_read on public.ah_crypto_assets;
create policy ah_crypto_assets_admin_read on public.ah_crypto_assets
  for select to authenticated using (public.ah_is_admin());

insert into public.ah_crypto_assets
  (asset_code, display_name, ticker, network, chain_family, token_contract, decimals, wallet_address, confirmations_required, listener_enabled, listener_status)
values
  ('BTC', 'Bitcoin', 'BTC', 'Bitcoin', 'bitcoin', null, 8, 'bc1pulkdswkehc7ck9ajjynlxet0ptftlgcp58fyznvdp53da7ps5trsyf7ehu', 3, false, 'awaiting_provider'),
  ('ETH', 'Ethereum', 'ETH', 'Ethereum', 'evm', null, 18, '0xfc20a17b56cd97ffe2551fc8518257e4aacf36cf', 12, false, 'awaiting_provider'),
  ('USDT_ERC20', 'Tether USD', 'USDT', 'Ethereum ERC-20', 'evm', '0xdac17f958d2ee523a2206206994597c13d831ec7', 6, '0xfc20a17b56cd97ffe2551fc8518257e4aacf36cf', 12, false, 'awaiting_provider'),
  ('USDT_TRC20', 'Tether USD', 'USDT', 'TRON TRC-20', 'tron', 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj', 6, 'TNjmN9KYUmEDCz5PoAttDcxeCuFvrxBBce', 20, false, 'awaiting_provider'),
  ('LTC', 'Litecoin', 'LTC', 'Litecoin', 'litecoin', null, 8, 'MQ3z4NC8YWA4i4d2QM1fLz8zRv8x2T3SKe', 6, false, 'awaiting_provider'),
  ('TRX', 'TRON', 'TRX', 'TRON', 'tron', null, 6, 'TNjmN9KYUmEDCz5PoAttDcxeCuFvrxBBce', 20, false, 'awaiting_provider'),
  ('SOL', 'Solana', 'SOL', 'Solana', 'solana', null, 9, '5A1rpSKKZtCgZpVwS1PLqc5M77oVkAWD4NfKKMuzd5Jz', 32, false, 'awaiting_provider'),
  ('BNB_BEP20', 'BNB', 'BNB', 'BNB Smart Chain BEP-20', 'evm', null, 18, '0xfc20a17b56cd97ffe2551fc8518257e4aacf36cf', 15, false, 'awaiting_provider'),
  ('TON', 'Toncoin (requested label: GRAM)', 'TON', 'TON', 'ton', null, 9, 'UQC5nJds9rVxaDKAT-lQeJOzBlVXRj79xqUJ2k1eN4cLdWph', 1, false, 'awaiting_provider')
on conflict (asset_code) do update set
  display_name = excluded.display_name,
  ticker = excluded.ticker,
  network = excluded.network,
  chain_family = excluded.chain_family,
  token_contract = excluded.token_contract,
  decimals = excluded.decimals,
  wallet_address = excluded.wallet_address,
  confirmations_required = excluded.confirmations_required,
  listener_enabled = false,
  listener_status = 'awaiting_provider',
  updated_at = now();

create table if not exists public.ah_crypto_deposits (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.ah_orders(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  asset_code text not null references public.ah_crypto_assets(asset_code) on delete restrict,
  expected_amount_atomic numeric(78,0) not null check (expected_amount_atomic > 0),
  received_amount_atomic numeric(78,0) not null default 0 check (received_amount_atomic >= 0),
  status text not null default 'awaiting'
    check (status in ('awaiting','detected','confirming','confirmed','expired','underpaid','overpaid','manual_review','cancelled')),
  expires_at timestamptz not null,
  transaction_hash text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ah_crypto_deposits_order_idx
  on public.ah_crypto_deposits(order_id, created_at desc);
create index if not exists ah_crypto_deposits_scan_idx
  on public.ah_crypto_deposits(asset_code, status, expires_at);
create unique index if not exists ah_crypto_deposits_active_amount_uidx
  on public.ah_crypto_deposits(asset_code, expected_amount_atomic)
  where status in ('awaiting','detected','confirming');

alter table public.ah_crypto_deposits enable row level security;
revoke all on public.ah_crypto_deposits from public, anon, authenticated;
grant select on public.ah_crypto_deposits to authenticated;
grant select, insert, update, delete on public.ah_crypto_deposits to service_role;
drop policy if exists ah_crypto_deposits_owner_read on public.ah_crypto_deposits;
create policy ah_crypto_deposits_owner_read on public.ah_crypto_deposits
  for select to authenticated using (auth.uid() = user_id or public.ah_is_admin());

create table if not exists public.ah_crypto_transfers (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null references public.ah_crypto_assets(asset_code) on delete restrict,
  transaction_hash text not null,
  event_index bigint not null default 0 check (event_index >= 0),
  destination_address text not null,
  amount_atomic numeric(78,0) not null check (amount_atomic > 0),
  block_height bigint,
  confirmations integer not null default 0 check (confirmations >= 0),
  status text not null default 'detected'
    check (status in ('detected','confirming','confirmed','reorged','ignored','manual_review')),
  deposit_id uuid references public.ah_crypto_deposits(id) on delete restrict,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique(asset_code, transaction_hash, event_index)
);

create index if not exists ah_crypto_transfers_deposit_idx
  on public.ah_crypto_transfers(deposit_id, first_seen_at desc);
create index if not exists ah_crypto_transfers_pending_idx
  on public.ah_crypto_transfers(asset_code, status, last_seen_at);

alter table public.ah_crypto_transfers enable row level security;
revoke all on public.ah_crypto_transfers from public, anon, authenticated;
grant select, insert, update, delete on public.ah_crypto_transfers to service_role;

create table if not exists public.ah_crypto_listener_cursors (
  asset_code text primary key references public.ah_crypto_assets(asset_code) on delete restrict,
  cursor_value text,
  last_scanned_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  updated_at timestamptz not null default now()
);

alter table public.ah_crypto_listener_cursors enable row level security;
revoke all on public.ah_crypto_listener_cursors from public, anon, authenticated;
grant select, insert, update, delete on public.ah_crypto_listener_cursors to service_role;

insert into public.ah_crypto_listener_cursors(asset_code)
select asset_code from public.ah_crypto_assets
on conflict (asset_code) do nothing;

commit;
