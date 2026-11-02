# Anonymous Hosting

A responsive, multilingual hosting storefront prototype for the **Anonymous Hosting** brand.

## Current prototype

- Responsive landing page for desktop and mobile
- Six-language interface: English (default), Simplified Chinese, Arabic (RTL), French, Russian, and Spanish
- Language preference saved in browser local storage
- Product categories: Linux VPS, Dedicated Server, Windows RDP, GPU Compute, and Domains
- Demo plan cards with category filtering
- Sample global data-center locations
- No build step or framework required

## Run locally

Open `index.html` in a modern browser, or serve this directory with any static web server.

## Automated checks and deployment

Every push to `main` runs the dependency-free storefront smoke checks in `scripts/check-site.mjs`, prepares the static site, and deploys it with GitHub Actions to GitHub Pages. You can also start the workflow manually from the Actions tab. The first deployment may require GitHub Pages to be enabled for the repository with **Build and deployment → Source: GitHub Actions**. The published URL is shown in the workflow run's deployment environment.

## Important prototype notes

- Prices, server specifications, and locations are illustrative demo content, not live inventory or binding offers.
- Order links are placeholders and do not create orders or accept payments.
- Authentication, customer dashboard, database integration, provisioning APIs, billing, and support workflows are not implemented yet.
- Replace placeholder contact links and demo content before public launch.

## Suggested next milestones

1. Establish the production frontend structure and reusable components.
2. Connect Supabase Auth and database tables with reviewed Row Level Security policies.
3. Implement product, region, pricing, and availability management.
4. Build a secure order and payment workflow with server-side validation.
5. Integrate provider APIs for server provisioning and lifecycle management.
6. Add customer dashboard, order history, invoices, and support.
7. Add automated tests, accessibility checks, and deployment configuration.

## Brand direction

Dark teal surfaces, mint-green accents, restrained typography, clear product hierarchy, and a privacy-first positioning. The design is an original implementation and does not reuse another provider's branding or source code.
