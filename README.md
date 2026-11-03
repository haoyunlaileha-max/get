# Anonymous Hosting

A responsive, Chinese-language storefront and customer portal prototype for the **Anonymous Hosting** brand.

## Current application

- Responsive storefront with Simplified Chinese and Traditional Chinese interfaces.
- Product categories for Linux VPS, Dedicated Servers, Windows RDP, GPU Compute, and Domains.
- Product pages support catalog-driven plans, region selection, and a secure checkout handoff.
- Customer access uses generated private tokens. Registration creates a Supabase Auth identity; the token is shown once and must be stored safely by the customer.
- The customer portal uses the resulting Supabase session for profile management and user-scoped order history.
- The operations console supports orders, payment events, provisioning jobs, catalog editing, regions, and per-plan inventory. Access requires a trusted `app_metadata.role = admin` claim and matching database RLS policies.
- Static frontend; no bundler is required.

## Live deployment status

The GitHub Pages storefront and account portal are deployed. The connected Supabase project has the `ah_*` schema and currently has the `token-auth` and `create-order` Edge Functions active.

The live catalog tables `ah_products`, `ah_plans`, and `ah_regions` are currently empty. Therefore, the site is not yet ready to accept real customer orders. Only publish genuine products, prices, specifications, and data-center availability after confirming the actual hosting supply and commercial terms.

The payment webhook and provisioning worker exist in source but are not deployed. Real payments and automatic server provisioning are not enabled.

## Run locally

Open `index.html` in a modern browser, or serve this directory with any static web server.

## Automated checks and deployment

Every push to `main` runs `node scripts/check-site.mjs`. GitHub Pages deployment is handled by `.github/workflows/deploy.yml`.

## Backend architecture and deployment boundary

The additive Supabase schema is namespaced under `ah_*` and does not modify unrelated application tables. Review `docs/backend-foundation.md` before changing the database or deploying backend functions.

- `supabase/functions/token-auth` creates and verifies token-based customer credentials with server-side rate limiting.
- `supabase/functions/create-order` verifies customer identity and creates pending orders using database-authoritative prices and idempotency.
- `supabase/functions/payment-webhook` is a provider-neutral, timestamped HMAC-signed normalized success-event receiver. It is not a ready-made Stripe/PayPal integration; a provider-specific adapter with native signature verification is required.
- `supabase/functions/provision-worker` claims paid-order jobs from a durable queue, calls a configured HTTPS provisioning gateway with an order-stable idempotency key, and marks orders active only after a valid provider confirmation.
- Provisioning failures use leased retries with exponential backoff and a bounded attempt count.
- Payment event records are idempotent and protected from browser roles.
- `admin.html` is a protected operations UI; database RLS is the actual access boundary. Plan-region capacity is reserved transactionally during order creation.
- No service-role credentials, payment secrets, or provider API tokens belong in browser code or Git history.
- Before enabling payment or provisioning, configure real provider credentials, deploy the relevant functions, and test the complete lifecycle in the provider's sandbox.

## Prototype and operational notes

Any remaining demo plans or marketing prices shown in static storefront content are illustrative and must not be treated as an offer until reconciled with the live catalog. The local configurator does not itself contact a provider or accept payment. Never place a Supabase service-role or secret key in `assets/js/supabase-config.js`.

## Brand direction

Dark teal surfaces, mint-green accents, a custom AH-inspired geometric mark, and a privacy-first positioning. The storefront structure follows familiar hosting-provider patterns while all branding, copy, and visual assets remain original.
