-- Ensure TON is represented consistently as native Toncoin, never GRAM.
update public.ah_crypto_assets
set display_name = 'Toncoin',
    ticker = 'TON',
    network = 'TON mainnet (native Toncoin)',
    token_contract = null,
    updated_at = now()
where asset_code = 'TON';
