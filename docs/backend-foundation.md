# Anonymous Hosting — backend foundation

## Scope and safety

The `ah_*` schema and functions are isolated from unrelated application tables. These migrations are source-controlled only; they are **not** automatically applied to any Supabase project. Do not put Supabase service-role credentials in browser code, GitHub source, or client-visible logs.

## Data model

- `ah_profiles`: one profile row per Supabase Auth user.
- `ah_regions`: data-center regions and availability state.
- `ah_products` and `ah_plans`: active catalog and authoritative prices.
- `ah_orders` and `ah_order_items`: customer orders and immutable checkout snapshots.

Prices use minor currency units (for example, 1299 = USD 12.99). Browser-submitted prices, totals, user IDs, and order status are never trusted.

## Secure order creation

The `create-order` Supabase Edge Function accepts only a plan ID, optional region ID, quantity, optional customer note, the caller's bearer token, and an `Idempotency-Key` header.

1. The Edge Function validates the request shape and checks the origin against `ALLOWED_ORIGINS`.
2. It validates the bearer token with Supabase Auth and obtains the user ID from the verified session. The client cannot choose another user ID.
3. It calls `ah_create_order` using the service-role client, which exists only inside the function environment.
4. The database function independently checks the service-role JWT role, validates quantity and idempotency, reads the active plan/product and optional active region, calculates the total from the database price, and atomically inserts the order and its price snapshot.
5. Repeating the same idempotency key with the same request returns the original order. Reusing the key for different request data returns a conflict.

The SQL RPC is revoked from `public`, `anon`, and `authenticated`; only `service_role` can execute it. The Edge Function returns sanitized errors rather than raw database messages.

### Deploy prerequisites

Apply migrations in order to the intended Anonymous Hosting Supabase project only:

- `supabase/migrations/20261102000100_anonymous_hosting_core.sql`
- `supabase/migrations/20261102000200_secure_order_creation.sql`

Then configure Edge Function secrets in that Supabase project (never in GitHub source):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGINS` — comma-separated exact origins, e.g. `https://haoyunlaileha-max.github.io` and any separately approved custom domain. Do not include URL paths.

Deploy with Supabase CLI after linking the correct project:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy create-order
```

Do not run these commands until the project identity and migrations have been reviewed. This repository change does not link to, migrate, or deploy to a Supabase project.

### Request contract

```http
POST /functions/v1/create-order
Authorization: Bearer <customer access token>
apikey: <public anon key>
Content-Type: application/json
Idempotency-Key: <unique 16–128 character key>

{
  "plan_id": "UUID",
  "region_id": "UUID (optional)",
  "quantity": 1,
  "customer_note": "optional, max 500 characters"
}
```

No price, currency, user ID, or order status is accepted from the browser.

## Row-level security

- Anonymous and signed-in visitors can read active regions, products, and plans.
- A signed-in customer can read and update their own profile.
- A signed-in customer can read only their own orders and order items.
- Catalog writes and order mutations are reserved for administrators or trusted server-side code.
- Admin access is determined only by the verified JWT app_metadata claim `role=admin`. Do not use user-editable user_metadata for authorization.
- Supabase service-role credentials must remain server-side.

## Current limitations

- The Edge Function creates a pending order only. It does not accept payments, mark orders paid, or provision servers.
- Payment webhook signature verification, provider API integration, provisioning queues, retry policy, audit logging, and per-user/IP rate limiting must be implemented before production fulfillment. CORS origin checks are an additional browser control, not a substitute for authentication or rate limiting.
- The Edge Function is committed but not deployed to Supabase. No secrets or project credentials are stored in this repository.
