# Anonymous Hosting

A responsive, multilingual hosting storefront prototype for the **Anonymous Hosting** brand.

## Current prototype

- Responsive landing page for desktop and mobile
- Six-language interface: English (default), Simplified Chinese, Arabic (RTL), French, Russian, and Spanish
- Language preference saved in browser local storage
- Product categories: Linux VPS, Dedicated Server, Windows RDP, GPU Compute, and Domains
- Demo plan cards for Linux VPS, dedicated servers, Windows RDP, GPU compute, and domains
- Category filtering across all five product groups
- Local-only plan configurator with region and operating-system selections; it does not submit orders or transmit customer data
- Accessible mobile navigation dropdown
- Customer account portal with six-language UI (including Arabic RTL), Supabase email/password sign-in, registration, password reset, profile display-name editing, and user-scoped order history with line items
- Supabase browser configuration template starts empty and accepts only the public anon/publishable key
- Sample global data-center locations
- Modular static frontend: semantic HTML, external CSS, and external JavaScript
- No build step or framework required

## Run locally

Open `index.html` in a modern browser, or serve this directory with any static web server.

## Automated checks and deployment

Every push to `main` runs the dependency-free modular storefront and migration checks in `scripts/check-site.mjs`. The deploy workflow checks whether GitHub Pages is enabled: if it is not, validation still succeeds and deployment is safely skipped; once Pages is enabled with **Settings → Pages → Build and deployment → Source: GitHub Actions**, subsequent pushes deploy automatically. You can also start the workflow manually from the Actions tab. The published URL is shown in the workflow run's deployment environment.

## Important prototype notes

- Prices, server specifications, and locations are illustrative demo content, not live inventory or binding offers.
- The plan configurator is a local demonstration only. It does not create orders, collect personal data, contact a provider, or accept payments.
- The account portal is implemented but remains disconnected until a Supabase project URL and public anon/publishable key are configured in `assets/js/supabase-config.js`.
- Apply the additive database migration before expecting order history to load. The service-role key must never be placed in browser code.
- Provider provisioning APIs, billing, and support workflows are not implemented yet.
- Replace placeholder contact links and demo content before public launch.

## Suggested next milestones

1. Add browser-level interaction and accessibility tests to the modular frontend.
2. Connect Supabase Auth and the reviewed database tables with tested Row Level Security policies.
3. Replace demo catalog data with live product, region, pricing, and availability records.
4. Build a secure order and payment workflow with server-side validation.
5. Integrate provider APIs for server provisioning and lifecycle management.
6. Add customer dashboard, order history, invoices, and support.
7. Expand automated browser, accessibility, and security tests.

## Brand direction

Dark teal surfaces, mint-green accents, restrained typography, clear product hierarchy, and a privacy-first positioning. The design is an original implementation and does not reuse another provider's branding or source code.


## Database foundation

An additive Supabase migration is maintained at `supabase/migrations/20261102000100_anonymous_hosting_core.sql`. It defines namespaced profiles, regions, products, plans, orders, and order items with row-level security. Read `docs/backend-foundation.md` before applying it. The migration is committed to source control only; it is not automatically run against a Supabase project.

## Continuous integration

The independent workflow at `.github/workflows/ci.yml` validates the storefront and migration on pushes and pull requests. This keeps code checks independent from the separate GitHub Pages deployment setup.
