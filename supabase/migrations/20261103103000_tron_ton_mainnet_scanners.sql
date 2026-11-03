-- Activate TRON TRX, TRC-20 USDT and native TON coin (display ticker GRAM).
-- Their scanners are implemented in crypto-scanner v4; unhealthy providers fail closed.
begin;
update public.ah_crypto_assets
set listener_enabled = true, listener_status = 'ready', updated_at = now()
where asset_code in ('TRX', 'USDT_TRC20', 'TON');
commit;
