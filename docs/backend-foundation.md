# Anonymous Hosting — backend foundation

## Scope

The `supabase/migrations/20261102000100_anonymous_hosting_core.sql` migration adds a namespaced `ah_*` data model. It is intentionally additive: it does not rename, drop, or alter unrelated tables in an existing Supabase project.

## Data model

- `ah_profiles`: one profile row per Supabase Auth user.
- `ah_regions`: data-center regions and availability state.
- `ah_products`: product catalog categories.
- `ah_plans`: priced plans, currency, billing period, and JSON specifications.
- `ah_orders`: customer orders and lifecycle status.
- `ah_order_items`: immutable-at-checkout description and price snapshots.

Prices are stored in minor currency units (for example, 1299 = USD 12.99). Never trust a browser-submitted price. A future server-side order function must load current plan prices from the database, calculate totals, and write order snapshots using a trusted server context.

## Row-level security

- Anonymous and signed-in visitors can read active regions, products, and plans.
- A signed-in customer can read and update their own profile.
- A signed-in customer can read only their own orders and order items.
- Catalog writes and order mutations are reserved for administrators or trusted server-side code.
- Admin access is determined only by the verified JWT app_metadata claim `role=admin`. Do not use user-editable user_metadata for authorization.
- Supabase service-role credentials must remain server-side and must never be placed in browser code.

## Apply safely

1. Confirm the target Supabase project is the Anonymous Hosting project, not another application.
2. Review the migration against that project's current schema and naming conventions.
3. Apply it through Supabase CLI migrations or the SQL editor.
4. Assign admin claims through a trusted server-side administrative process.
5. Test each policy with anonymous, customer, and administrator sessions before connecting the storefront.

This repository change does not execute the migration against any Supabase project. No credentials are stored here.

## Next backend milestones

1. Supabase Auth sign-up, sign-in, sign-out, and session restoration.
2. Read-only catalog integration using the anon/publishable key.
3. Server-side order creation with authoritative price calculation and idempotency.
4. Payment provider webhook verification.
5. Provisioning worker with retries, audit events, and provider-secret isolation.
