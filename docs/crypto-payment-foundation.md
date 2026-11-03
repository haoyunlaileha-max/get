# Direct-wallet cryptocurrency payment

## Supported payment channels

The receiving registry contains BTC, ETH, USDT ERC-20, USDT TRC-20, LTC, TRX, SOL, BNB BEP-20 and a TON-labelled GRAM entry. Catalog plan prices are denominated in USDT. The authenticated `create-crypto-invoice` function obtains live USDT market quotes from Binance public ticker endpoints for BTC, ETH, LTC, TRX, SOL and BNB; USDT network payments use a 1:1 quote. Invoice amounts are calculated with integer arithmetic and each asset's atomic precision.

## Invoice and settlement safeguards

- Orders and invoices are created server-side and are scoped to the authenticated customer.
- The database allocates a unique active invoice amount per asset and stores the quote and expiry.
- The invoice endpoint refuses to issue a payment address unless the selected chain listener is explicitly enabled and marked `ready`.
- A transfer is credited only when the trusted listener reports the exact invoice amount to the registered receiving address. Unmatched transfers are retained for manual review.
- A deposit becomes paid only after the configured confirmation threshold is met. The payment-event RPC is idempotent; the existing order/provisioning workflow receives the same paid transition as other payment methods.
- Overpayments and settlement conflicts are not automatically credited.
- No private keys or seed phrases are stored.

## Chain listener ingress

The `crypto-listener` Supabase Edge Function is the authenticated ingestion boundary for chain-specific scanners/indexers. It accepts batches of up to 50 normalized transfers:

```json
{
  "action": "ingest",
  "transfers": [{
    "asset_code": "USDT_TRC20",
    "transaction_hash": "provider transaction hash",
    "event_index": 0,
    "destination_address": "exact registered receiving address",
    "amount_atomic": "25000000",
    "block_height": 123456,
    "confirmations": 20
  }]
}
```

Call `POST https://izuxtqmjdtzxvnfwppls.supabase.co/functions/v1/crypto-listener` with `Content-Type: application/json` and `x-listener-secret: <CRYPTO_LISTENER_INTERNAL_SECRET>`. The shared secret must be stored only in the scanner's secret manager and Supabase Edge Function secrets; never commit it or send it from the browser. The endpoint checks the registered destination, enabled/ready state, exact invoice amount, confirmation threshold and duplicate transfer key before settlement.

The ingress function is not itself a blockchain scanner. A chain-specific provider/worker must independently verify chain data, canonical block status, transaction finality and reorgs, then submit normalized observations. It must resubmit updated confirmation counts and must never fabricate transfer data. The function intentionally does not enable any listener or issue addresses on its own.

## Current production boundary

All nine chain listeners remain disabled with `listener_status = awaiting_provider` until each chain's provider, scanner, confirmation/reorg handling and receiving-address verification are configured. The schema, USDT pricing path, authenticated invoice endpoint, checkout UI, Telegram notification dispatcher and crypto listener ingress are deployed. The Telegram dispatcher is separate from chain scanning; its successful delivery does not mean blockchain monitoring is active. The ingress deployment does not imply automatic on-chain scanning or live payment acceptance.

GRAM remains blocked: GRAM invoice generation the current address is a TON receiving address, not a verified GRAM Jetton master contract; the actual GRAM Jetton master contract has not yet been populated, and a separate GRAM market-rate source is required.

## Telegram payment notifications

A database trigger writes deposit lifecycle changes to a private transactional outbox. The `telegram-dispatch` Edge Function claims records with row-level locking, sends Telegram Bot API messages, records delivery and retries transient failures with backoff. A Supabase Cron job invokes the dispatcher every minute using a publishable key plus a separate random cron proof stored in Vault. Telegram credentials and internal secrets must never be committed to GitHub.
