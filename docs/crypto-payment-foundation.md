# Mainnet chain scanning and automatic settlement

The production scanner is a Supabase Edge Function invoked every minute by pg_cron/pg_net. It reads the receiving registry and chain cursors, fetches mainnet transaction data, and submits normalized observations to the authenticated `crypto-listener`. The listener verifies its independent Vault-backed cron secret, exact destination, exact invoice amount, confirmation threshold, duplicate key and idempotent payment event before settling an order.

## Active public-provider adapters

- Bitcoin: mempool.space address transaction API and live tip height.
- Litecoin: litecoinspace.org address transaction API and live tip height.
- Ethereum native ETH and ERC-20 USDT: public Ethereum JSON-RPC; native block transactions and receipt success, ERC-20 Transfer logs filtered by the registered token contract and recipient.
- BNB native: BNB Smart Chain public JSON-RPC.
- Solana native SOL: public Solana JSON-RPC parsed System Program transfers; finality is required before credit.
- TRON native TRX and USDT TRC-20: TronGrid confirmed account history, TRC-20 contract allowlist filtering, Base58/hex destination verification, and solidified block heights.
- TON native GRAM: TON Center API v3 indexed account transactions, raw/friendly address normalization, successful inbound native-message filtering, and masterchain inclusion.

The EVM scanner stores per-asset block cursors, overlaps recent blocks to refresh confirmation counts, and advances in bounded batches. UTXO and Solana observations are deduplicated by transaction/output or instruction index in the settlement ledger. Provider failures mark the adapter degraded so invoice creation fails closed until scanning recovers.

## Providers requiring credentials / additional adapter work

TRON native TRX and USDT TRC-20 require a production `TRONGRID_API_KEY` Edge Function secret. The scanner always sends it in the `TRON-PRO-API-KEY` header and fails closed (marks both TRON assets degraded and blocks new invoices) if it is missing or rejected. Create a dedicated production backend key in the TronGrid console; restrict it to Mainnet and the account-history, TRC-20 transfer, and solidified-block endpoints used by this scanner. Set the secret in Supabase Dashboard → Edge Functions → Secrets as `TRONGRID_API_KEY`; never put it in GitHub or frontend configuration. HTTP 429/502/503/504 and timeouts receive bounded exponential backoff with jitter; persistent failures mark the affected asset degraded. `TONCENTER_API_KEY` remains optional.

## Manual order fulfilment

After the chain listener confirms an exact payment, it calls the idempotent payment-event RPC to set the order to `paid`. The `ah_crypto_deposits` status trigger writes a deduplicated Telegram outbox notification; the scheduled `telegram-dispatch` worker sends the order and payment details to the configured administrator chat. The administrator manually fulfils the order. No automatic VPS provisioning, automatic delivery, signing, withdrawal, or fund sweeping is performed.

## Safety and operations

- The scanner uses public receiving addresses only; no signing keys or seed phrases are stored.
- The existing Vault-managed internal cron credential is reused for scanner authentication and is never committed to GitHub.
- Only the database cron job can invoke the scanner; the listener independently checks the same secret through a service-role-only RPC.
- Chain observations are not accepted from the browser.
- Repeated provider failures block new invoices for the affected asset.
- The existing `TON` asset code is retained for backwards compatibility, while the native coin is displayed and priced as GRAM after the network ticker rebrand. Native GRAM is not a Jetton; the scanner accepts only native inbound messages with masterchain inclusion and rejects Jetton notification opcodes.
- Configure `TRONGRID_API_KEY` under Supabase Project Settings → Edge Functions → Secrets (or the Edge Function secrets page) after creating a production Mainnet API key in the TronGrid console. Never put the key in GitHub, SQL migrations, frontend JavaScript, or chat. Restrict the key to Mainnet and the read-only account/transaction endpoints used by this scanner; monitor quota and request failures. The scanner is a deposit monitor, not a withdrawal service. It does not sweep or spend funds.
- Public RPC/explorer endpoints have rate limits and are best-effort infrastructure. For high-volume production, replace them with dedicated provider endpoints and monitor cursor lag.
