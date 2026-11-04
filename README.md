# AnonPort

A responsive, Chinese-language storefront and customer portal for the **AnonPort** brand.

## Application

- Responsive storefront with Simplified Chinese and Traditional Chinese interfaces.
- Product categories for Linux VPS, Dedicated Servers, Windows RDP, GPU Compute, and Domains.
- Product pages support catalog-driven plans, region selection, and a secure checkout handoff.
- Customer access uses generated private tokens. Registration creates a Supabase Auth identity; the token is shown once and must be stored safely by the customer.
- The customer portal uses the resulting Supabase session for profile management and user-scoped order history.
- The operations console supports orders, payment events, provisioning jobs, category management, product image uploads, catalog editing, regions, and per-plan inventory. Product media is stored in the public `product-images` bucket; only verified admins can upload, replace, or delete objects. Image files are limited to JPEG, PNG, WebP, and AVIF at 5 MB. Access requires a trusted `app_metadata.role = admin` claim and matching database RLS policies.
- Static frontend; no bundler is required.
- Complete Chinese navigation and 33 localized page routes covering products, locations, jurisdiction selection, alternatives, guides, use cases, FAQ, solution pages, AI agent API, and company/legal pages.
- All new localized routes use shared responsive page styling and are included in `sitemap.xml`; live product prices and inventory remain catalog-driven.

## Live deployment status

**Website:** https://haoyunlaileha-max.github.io/get/

**Supabase project:** `izuxtqmjdtzxvnfwppls`

The GitHub Pages storefront, account portal, localized product pages, and admin UI are deployed. The Supabase database schema and the following Edge Functions are active:

| Function | Live version | Purpose |
| --- | ---: | --- |
| `token-auth` | 6 | Token-based customer registration and login |
| `create-order` | 6 | Authenticated, idempotent order creation |
| `cancel-order` | 5 | Safe cancellation of eligible unpaid orders |
| `create-crypto-invoice` | 12 | Authenticated crypto invoice quotes and invoice creation |
| `create-account-topup` | 1 | Authenticated account top-up order creation and ready network discovery |
| `crypto-listener` | 3 | Authenticated chain-transfer verification and idempotent settlement |
| `crypto-scanner` | 8 | Minute-scheduled mainnet scanning for BTC, LTC, ETH, ERC-20 USDT, BNB, SOL, TRX, TRC-20 USDT and native TON |
| `telegram-dispatch` | 8 | Private Telegram notification outbox delivery |

Crypto wallet payments are monitored on-chain and settled automatically after exact amount and confirmation checks. Confirmed orders are sent to the configured Telegram administrator chat for manual fulfilment; no automatic VPS provisioning or fund withdrawal is performed. The generic external payment webhook and hosting-provisioning gateway are not part of this live manual-fulfilment payment flow.

### Important operational limits

- The live catalog tables currently contain one inactive Linux VPS product, one active plan attached to an unavailable region mapping, and no sellable inventory. The storefront correctly hides these records from customers. It is not ready to accept real hosting orders until genuine products, prices, specifications, and data-center availability are verified and published.
- Nine crypto assets are configured and currently report `listener_status = ready`: BTC, ETH, USDT ERC-20, USDT TRC-20, LTC, TRX, SOL, BNB BEP-20, and native Toncoin (TON). XMR and GRAM Jetton are not accepted.
- Mainnet scanner adapters are implemented for BTC, LTC, ETH, ERC-20 USDT, BNB, SOL, TRX, TRC-20 USDT, and native TON. Solana history uses bounded cursor pagination (up to 1,000 signatures per scan) and fails closed if the saved cursor falls outside the bounded catch-up window. The production `TRONGRID_API_KEY` is configured. Listener readiness is checked before every new invoice; provider failures mark affected assets degraded and block new invoices.
- Telegram notification delivery is deployed and its test message was verified. A Vault-authenticated Cron job runs the dispatcher every minute, but it only processes notification events already written to the outbox; it does not scan blockchains.
- The native TON coin is displayed as Toncoin (TON), and its invoice quote uses TON/USDT. No separate GRAM Jetton is accepted. TRON invoices use the configured production TronGrid API key; if TronGrid becomes unhealthy, TRX and USDT-TRC20 are marked degraded and invoice creation is blocked.
- Account recharge is live: customers can create 10–500 USDT top-ups, receive a unique on-chain invoice on a ready network, and see their balance/history. A confirmed payment adds one immutable ledger credit through a database trigger; pending or unconfirmed payments never change the balance. Confirmed service orders automatically mark paid and create a deduplicated Telegram administrator notification. Administrators manually fulfil orders; no automatic provisioning or withdrawals are performed. If a chain provider is unavailable, the asset is held in `awaiting_provider` or `degraded` and invoice creation remains blocked.
- Mainnet scanning and automatic on-chain settlement are deployed for all nine configured assets listed above. No external payment-provider webhook integration or automatic hosting provisioning should be represented as live. A real customer deposit has not yet been used for end-to-end payment-credit acceptance testing.

The account balance is credited from the immutable `ah_account_ledger`; top-up creation is idempotent and the ledger tables are protected by owner-scoped RLS.

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
