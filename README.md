# Anonymous Hosting

A responsive, Chinese-language storefront and customer portal prototype for the **Anonymous Hosting** brand.

## Application

- Responsive storefront with Simplified Chinese and Traditional Chinese interfaces.
- Product categories for Linux VPS, Dedicated Servers, Windows RDP, GPU Compute, and Domains.
- Product pages support catalog-driven plans, region selection, and a secure checkout handoff.
- Customer access uses generated private tokens. Registration creates a Supabase Auth identity; the token is shown once and must be stored safely by the customer.
- The customer portal uses the resulting Supabase session for profile management and user-scoped order history.
- The operations console supports orders, payment events, provisioning jobs, catalog editing, regions, and per-plan inventory. Access requires a trusted `app_metadata.role = admin` claim and matching database RLS policies.
- Static frontend; no bundler is required.

## Live deployment status

**Website:** https://haoyunlaileha-max.github.io/get/

**Supabase project:** `izuxtqmjdtzxvnfwppls`

The GitHub Pages storefront, account portal, localized product pages, and admin UI are deployed. The Supabase database schema and the following Edge Functions are active:

| Function | Live version | Purpose |
| --- | ---: | --- |
| `token-auth` | 5 | Token-based customer registration and login |
| `create-order` | 5 | Authenticated, idempotent order creation |
| `cancel-order` | 4 | Safe cancellation of eligible unpaid orders |
| `create-crypto-invoice` | 8 | Authenticated crypto invoice quotes and invoice creation |
| `crypto-listener` | 2 | Authenticated chain-transfer verification and idempotent settlement |
| `crypto-scanner` | 5 | Minute-scheduled mainnet scanning for BTC, LTC, ETH, ERC-20 USDT, BNB, SOL, TRX, TRC-20 USDT and native GRAM |
| `telegram-dispatch` | 6 | Private Telegram notification outbox delivery |

Crypto wallet payments are monitored on-chain and settled automatically after exact amount and confirmation checks. Confirmed orders are sent to the configured Telegram administrator chat for manual fulfilment; no automatic VPS provisioning or fund withdrawal is performed. The generic external payment webhook and hosting-provisioning gateway are not part of this live manual-fulfilment payment flow.

### Important operational limits

- The live catalog tables `ah_products`, `ah_plans`, and `ah_regions` are empty. The storefront is deployed, but it is not ready to accept real hosting orders until genuine products, prices, specifications, and data-center availability are entered.
- Nine crypto assets are configured: BTC, ETH, USDT ERC-20, USDT TRC-20, LTC, TRX, SOL, BNB BEP-20, and GRAM on TON. XMR is excluded.
- BTC, LTC, ETH, USDT ERC-20, BNB, SOL, TRX, USDT TRC-20 and native GRAM scanners are enabled; provider failures automatically mark the affected asset degraded and prevent new invoices until recovery.
- Telegram notification delivery is deployed and its test message was verified. A Vault-authenticated Cron job runs the dispatcher every minute, but it only processes notification events already written to the outbox; it does not scan blockchains.
- The native TON coin is displayed as GRAM. The existing TON asset code and wallet address remain unchanged; the invoice quote uses the GRAM/USDT market symbol. No separate GRAM Jetton is accepted. TRON invoice creation requires the `TRONGRID_API_KEY` Supabase Edge Function secret; without it or when TronGrid is unhealthy, TRX and USDT-TRC20 are marked degraded and invoice creation is blocked. Assets without a healthy provider cannot issue invoices.
- Confirmed payments automatically mark orders paid and create a deduplicated Telegram administrator notification. Administrators manually fulfil orders; no automatic provisioning or withdrawals are performed.
- Mainnet scanning and automatic on-chain settlement are deployed for BTC, LTC, ETH, USDT ERC-20, BNB and SOL. No external payment-provider webhook integration or automatic hosting provisioning should be represented as live. A real customer deposit has not yet been used for end-to-end acceptance testing.

See [the crypto payment deployment notes](docs/crypto-payment-foundation.md) and [the backend foundation](docs/backend-foundation.md) for the implementation boundary and safeguards.

## Run locally

Open `index.html` in a modern browser, or serve this directory with any static web server.

## Automated checks and deployment

Every push to `main` runs `node scripts/check-site.mjs`. GitHub Pages deployment is handled by `.github/workflows/deploy.yml`.

## Backend architecture and security

The additive Supabase schema is namespaced under `ah_*` and does not modify unrelated application tables.

- `supabase/functions/token-auth` creates and verifies token-based customer credentials with server-side rate limiting.
- `supabase/functions/create-order` verifies customer identity and creates pending orders using database-authoritative prices and idempotency.
- `supabase/functions/cancel-order` safely cancels eligible unpaid orders.
- `supabase/functions/create-crypto-invoice` issues authenticated USDT-denominated quotes and invoices only when the selected asset's listener is ready.
- `supabase/functions/telegram-dispatch` delivers private outbox notifications with restricted worker RPC permissions and Vault-backed scheduled authentication.
- `supabase/functions/payment-webhook` is source-only: it is a provider-neutral, timestamped HMAC-signed normalized success-event receiver, not a ready-made Stripe/PayPal integration.
- `supabase/functions/provision-worker` is source-only: it claims paid-order jobs from a durable queue and requires a configured HTTPS provisioning gateway before it can activate orders.
- Provisioning failures use leased retries with exponential backoff and a bounded attempt count.
- Payment event records are idempotent and protected from browser roles.
- `admin.html` is a protected operations UI; database RLS is the actual access boundary. Plan-region capacity is reserved transactionally during order creation.
- No service-role credentials, payment secrets, wallet private keys, or seed phrases belong in browser code or Git history.

## Prototype and commercial notes

Any remaining demo plans or marketing prices shown in static storefront content are illustrative and must not be treated as an offer until reconciled with the live catalog. The local configurator does not itself contact a provider or accept payment. Never place a Supabase service-role or secret key in `assets/js/supabase-config.js`.

## Brand direction

Dark teal surfaces, mint-green accents, a custom AH-inspired geometric mark, and a privacy-first positioning. The storefront structure follows familiar hosting-provider patterns while all branding, copy, and visual assets remain original.
