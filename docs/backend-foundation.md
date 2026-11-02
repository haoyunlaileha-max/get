# Anonymous Hosting — backend foundation

## Scope and safety

The `ah_*` schema and functions are isolated from unrelated application tables. These migrations are source-controlled only; they are **not** automatically applied to any Supabase project. Do not put Supabase service-role credentials in browser code, GitHub source, or client-visible logs.

## Data model

- `ah_profiles`: one profile row per Supabase Auth user.
- `ah_regions`: data-center regions and availability state.
- `ah_products` and `ah_plans`: active catalog and authoritative prices.
- `ah_orders` and `ah_order_items`: customer orders and immutable checkout snapshots.
- `ah_payment_events`: minimal audit records for accepted payment-success notifications; unique provider/event IDs prevent duplicate processing.

Prices use minor currency units (for example, 1299 = USD 12.99). Browser-submitted prices, totals, user IDs, and order status are never trusted.

## Secure order creation

The `create-order` Supabase Edge Function accepts only a plan ID, optional region ID, quantity, optional customer note, the caller's bearer token, and an `Idempotency-Key` header.

1. The Edge Function validates the request shape and checks the origin against `ALLOWED_ORIGINS`.
2. It validates the bearer token with Supabase Auth and obtains the user ID from the verified session.
3. It calls `ah_create_order` using the service-role client, which exists only in the function environment.
4. The database function independently validates the service role, quantity and idempotency, reads the active plan/product and optional active region, calculates the total from the database price, and atomically inserts the order and price snapshot.
5. Repeating the same idempotency key with the same request returns the original order. Reusing it for different request data returns a conflict.

## Verified payment notification foundation

The `payment-webhook` function is a provider-neutral **normalized event receiver**, not a ready-made Stripe/PayPal integration. It expects an upstream provider-specific adapter to verify the provider's native signature and map a genuine success notification into this envelope:

```json
{
  "provider": "provider_slug",
  "id": "provider-event-id",
  "type": "payment.succeeded",
  "data": {
    "order_id": "order-uuid",
    "amount_minor": 1299,
    "currency": "USD"
  }
}
```

The receiver verifies a timestamped HMAC-SHA256 signature in `x-ah-signature` over `<unix_timestamp>.<exact_raw_body>`, with a five-minute replay window. It then calls the service-role-only `ah_apply_payment_event` database function. The database locks the order row, checks the exact expected amount and currency, records the provider event under a unique key, and changes only payable orders (`pending` or `awaiting_payment`) to `paid`. Duplicate event delivery is idempotent; event-ID reuse with different content, amount mismatches, and non-payable orders are rejected.

**Important:** real payment providers use different native signature formats and event schemas. Do not point a provider directly at this normalized receiver until a dedicated adapter implements that provider's official signature verification, timestamp/replay rules, event mapping, and test vectors. Never treat a browser redirect or client-side payment-success page as proof of payment. Refunds, disputes, chargebacks, recurring renewals, and provisioning are not handled by this success-only workflow.

### Deployment prerequisites

Apply migrations in order to the intended Anonymous Hosting Supabase project only:

- `supabase/migrations/20261102000100_anonymous_hosting_core.sql`
- `supabase/migrations/20261102000200_secure_order_creation.sql`
- `supabase/migrations/20261102000300_payment_event_processing.sql`

Configure secrets in the Supabase project, never in GitHub source:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` — for `create-order`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGINS` — exact comma-separated browser origins for `create-order`
- `PAYMENT_WEBHOOK_SECRET` — high-entropy secret shared only with the trusted normalized-event adapter

After confirming the correct project:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy create-order
supabase functions deploy payment-webhook
```

This repository change does not link to, migrate, or deploy to a Supabase project.

## Row-level security

- Visitors can read active catalog entries and regions.
- Customers can read/update their own profile and read only their own orders/items.
- Catalog writes and order mutations are reserved for administrators or trusted server-side code.
- Admin access uses only verified JWT `app_metadata.role=admin`, never user-editable `user_metadata`.
- Payment event records have RLS enabled and no grants for browser roles.
- Service-role credentials must remain server-side.

## Current limitations

- The order function creates pending orders. The webhook advances an order to paid only after a correctly signed normalized success event and database checks.
- The normalized HMAC receiver is not a substitute for a provider-specific native signature adapter.
- Refunds, disputes, chargebacks, provider API integration, provisioning queues, retry policy, audit monitoring, and per-user/IP rate limiting remain future work.
- Neither migrations nor Edge Functions are deployed to Supabase. No secrets or project credentials are stored in this repository.
