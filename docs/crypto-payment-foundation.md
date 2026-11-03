# Direct-wallet cryptocurrency payment

## Assets and receiving addresses

The database has nine configured assets: BTC, ETH, USDT ERC-20, USDT TRC-20, LTC, TRX, SOL, BNB BEP-20 and GRAM on TON. XMR is excluded.

The GRAM row uses the previously configured TON receiving wallet, ticker/display name GRAM, and the TON/GRAM network label. The actual GRAM Jetton master contract has not yet been populated in the asset registry; the current wallet address is a receiving address, not a token contract address. The invoice endpoint explicitly rejects GRAM invoices until both the master contract and a matching market-rate source are verified. It must not use the native TON price for a distinct Jetton.

## USDT pricing and invoice generation

- Catalog plan prices are denominated in USDT (minor units are cents, 2 decimal places).
- Order creation is server-side and rejects plans not priced in USDT.
- The authenticated `create-crypto-invoice` Edge Function obtains live USDT market quotes from Binance public ticker endpoints for BTC, ETH, LTC, TRX, SOL and BNB; USDT network payments use a 1:1 quote. GRAM is deliberately blocked until its own market-rate source is verified.
- Amount conversion uses integer arithmetic and each asset's atomic precision.
- The database allocates a unique active invoice amount per asset and stores the quote, expiry and expected atomic amount.
- Customers can select the asset/network after creating an order.

## Safety state and deployment boundary

The schema, USDT pricing path, authenticated invoice endpoint and checkout UI are deployed. However, all nine chain listeners remain disabled with `listener_status = awaiting_provider`. The invoice endpoint intentionally refuses to issue a payment address while the selected chain listener is offline, so customers cannot send funds into a flow that cannot reliably detect and credit them.

No private keys or seed phrases are stored. No chain transaction scanner is active. The Telegram notification dispatcher is scheduled every minute; that is separate from chain scanning. The remaining production boundary is chain-specific RPC/indexer providers, transaction indexing, confirmation/reorg handling, and verification of the GRAM Jetton master contract. A successful website/Edge Function deployment does not mean automatic on-chain settlement is active.

## Telegram payment notifications

A database trigger writes deposit lifecycle changes (detected, confirming, confirmed, underpaid, overpaid, manual review and expiry) into a private transactional outbox. The `telegram-dispatch` Edge Function claims outbox records with row-level locking, sends Telegram Bot API messages, records delivery, and retries transient failures with backoff. The internal endpoint requires `x-listener-secret`; it is not a public unauthenticated bot endpoint.

Required Edge Function secrets (set in Supabase Dashboard > Edge Functions > Secrets):

- `TELEGRAM_BOT_TOKEN`: token created with Telegram BotFather.
- `TELEGRAM_CHAT_ID`: the private Telegram chat ID that should receive alerts.
- `CRYPTO_LISTENER_INTERNAL_SECRET`: a long random value shared only with trusted chain listener workers.

The chain listener calls `POST /functions/v1/telegram-dispatch` with header `x-listener-secret: <CRYPTO_LISTENER_INTERNAL_SECRET>` and JSON body `{"action":"dispatch"}` after writing deposit events. Send `{"action":"test"}` to the same endpoint to test the Telegram connection. The bot token and internal secret must never be committed to GitHub or placed in browser code.

The notification outbox and dispatcher are deployed. Telegram delivery was verified with a real test message after the three Edge Function secrets were configured. A Supabase Cron job invokes the dispatcher every minute using a publishable key plus a separate random cron proof stored in Vault; the Edge Function validates the proof through a service-role-only database function. The test action still requires the internal listener secret. The outbox RPCs are restricted by explicit EXECUTE grants to `service_role`, avoiding legacy JWT-role-claim checks that are not populated by the newer Supabase Secret API key format. No real deposit event is generated for testing. The on-chain scanners remain a separate deployment dependency because chain-specific providers and the GRAM Jetton master contract still need to be configured and verified.

Notification code is versioned alongside its applied database migrations; never commit bot credentials.
