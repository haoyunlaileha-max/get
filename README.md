# Anonymous Hosting

A responsive, Chinese-language hosting storefront prototype for the **Anonymous Hosting** brand.

## Current prototype

- Responsive landing page for desktop and mobile
- Simplified Chinese and Traditional Chinese interface, with language preference saved in browser local storage
- Reference-inspired hosting storefront information architecture with an original Anonymous Hosting logo
- Linux VPS, Dedicated Server, Windows RDP, GPU Compute, and Domains product categories with demo plans and filtering
- Local-only plan configurator; it does not submit orders or transmit customer data
- Customer account portal with Supabase email/password sign-in, registration, password reset, profile editing, and user-scoped order history
- Admin operations console for orders, payment events, provisioning queue, product/plan creation and editing (including pricing/specifications), activation, region availability, and per-plan data-center capacity assignments (verified admin role + RLS required)
- Modular static frontend with no bundler requirement

## Run locally

Open `index.html` in a modern browser, or serve this directory with any static web server.

## Automated checks and deployment

Every push to `main` runs `node scripts/check-site.mjs`. GitHub Pages deployment is handled separately by `.github/workflows/deploy.yml`.

## Backend foundation and deployment boundary

The additive Supabase schema is namespaced under `ah_*` and does not modify unrelated application tables. Read `docs/backend-foundation.md` before applying migrations.

- `supabase/functions/create-order` verifies customer identity and creates pending orders using database-authoritative prices and idempotency.
- `supabase/functions/payment-webhook` verifies a timestamped HMAC-signed normalized success event and advances a payable order to `paid` only after database checks.
- `supabase/functions/provision-worker` claims paid-order jobs from a durable queue, calls a configured HTTPS provisioning gateway with an order-stable idempotency key, and marks orders active only after a valid provider confirmation.
- Provisioning failures use leased retries with exponential backoff and a bounded attempt count; no provider means no job is claimed.
- Payment event records are idempotent and protected from browser roles.
- The webhook is a normalized receiver, **not** a ready-made Stripe/PayPal integration. A provider-specific adapter with native signature verification is required before connecting a real provider.
- `admin.html` is a protected operations UI; database RLS remains the actual access boundary. Migration 0006 adds plan-region availability and transactional capacity reservations during order creation.
- No Supabase migration or Edge Function is deployed automatically. No payment, worker, provider, or service-role secrets are stored in this repository.
- Payments, refunds, disputes, and server provisioning are not live features.

## Prototype notes

Prices, server specifications, and data-center locations are illustrative. The local plan configurator does not create orders, collect personal data, contact a provider, or accept payments. The account portal remains disconnected until the public Supabase URL/key are configured in `assets/js/supabase-config.js`; never put a service-role key in browser code.

## Brand direction

Dark teal surfaces, mint-green accents, a custom AH-inspired geometric mark, and a privacy-first positioning. The storefront structure is informed by common hosting-provider patterns and the AnonPort reference, while all branding, copy, and visual assets remain original.
