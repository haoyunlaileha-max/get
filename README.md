# Anonymous Hosting

A responsive, multilingual hosting storefront prototype for the **Anonymous Hosting** brand.

## Current prototype

- Responsive landing page for desktop and mobile
- Six-language interface: English (default), Simplified Chinese, Arabic (RTL), French, Russian, and Spanish
- Language preference saved in browser local storage
- Linux VPS, Dedicated Server, Windows RDP, GPU Compute, and Domains product categories with demo plans and filtering
- Local-only plan configurator; it does not submit orders or transmit customer data
- Customer account portal with Supabase email/password sign-in, registration, password reset, profile editing, and user-scoped order history
- Modular static frontend with no bundler requirement

## Run locally

Open `index.html` in a modern browser, or serve this directory with any static web server.

## Automated checks and deployment

Every push to `main` runs `node scripts/check-site.mjs`. GitHub Pages deployment is handled separately by `.github/workflows/deploy.yml`.

## Backend foundation and deployment boundary

The additive Supabase schema is namespaced under `ah_*` and does not modify unrelated application tables. Read `docs/backend-foundation.md` before applying migrations.

- `supabase/functions/create-order` verifies customer identity and creates pending orders using database-authoritative prices and idempotency.
- `supabase/functions/payment-webhook` verifies a timestamped HMAC-signed normalized success event and advances a payable order to `paid` only after database checks.
- Payment event records are idempotent and protected from browser roles.
- The webhook is a normalized receiver, **not** a ready-made Stripe/PayPal integration. A provider-specific adapter with native signature verification is required before connecting a real provider.
- No Supabase migration or Edge Function is deployed automatically. No payment secrets or service-role credentials are stored in this repository.
- Payments, refunds, disputes, and server provisioning are not live features.

## Prototype notes

Prices, server specifications, and data-center locations are illustrative. The local plan configurator does not create orders, collect personal data, contact a provider, or accept payments. The account portal remains disconnected until the public Supabase URL/key are configured in `assets/js/supabase-config.js`; never put a service-role key in browser code.

## Brand direction

Dark teal surfaces, mint-green accents, restrained typography, and a privacy-first positioning. This is an original implementation.
