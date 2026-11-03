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

TRON native TRX and USDT TRC-20 use TronGrid confirmed account history and solidified block height. `TRONGRID_API_KEY` is optional for low-volume connectivity but strongly recommended for production quotas and reliability; provider errors and rate limits mark the assets degraded and stop new invoices. `TONCENTER_API_KEY` is optional; unauthenticated TON Center API v3 access is rate-limited.

## Safety and operations

- The scanner uses public receiving addresses only; no signing keys or seed phrases are stored.
- The existing Vault-managed internal cron credential is reused for scanner authentication and is never committed to GitHub.
- Only the database cron job can invoke the scanner; the listener independently checks the same secret through a service-role-only RPC.
- Chain observations are not accepted from the browser.
- Repeated provider failures block new invoices for the affected asset.
- The existing `TON` asset code is retained for backwards compatibility, while the native coin is displayed and priced as GRAM after the network ticker rebrand. Native GRAM is not a Jetton; the scanner accepts only native inbound messages with masterchain inclusion and rejects Jetton notification opcodes.
- The scanner is a deposit monitor, not a withdrawal service. It does not sweep or spend funds.
- Public RPC/explorer endpoints have rate limits and are best-effort infrastructure. For high-volume production, replace them with dedicated provider endpoints and monitor cursor lag.
