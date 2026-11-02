# Anonymous Hosting — backend foundation

## Scope and safety

The `ah_*` schema and functions are isolated from unrelated application tables. These migrations are source-controlled only; they are **not** automatically applied to any Supabase project. Do not put Supabase service-role credentials in browser code, GitHub source, or client-visible logs.

## Data model

- `ah_profiles`: one profile row per Supabase Auth user.
- `ah_regions`: data-center regions and availability state.
- `ah_products` and `ah_plans`: active catalog and authoritative prices.
- `ah_orders` and `ah_order_items`: customer orders and immutable checkout snapshots.
- `ah_payment_events`: minimal audit records for accepted payment-success notifications; unique provider/event IDs prevent duplicate processing.
- `ah_provisioning_jobs`: durable, one-per-order provisioning work queue with leases, retry scheduling, attempt limits, and provider references.

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

**Important:** real payment providers use different native signature formats and event schemas. Do not point a provider directly at this normalized receiver until a dedicated adapter implements that provider's official signature verification, timestamp/replay rules, event mapping, and test vectors. Never treat a browser redirect or client-side payment-success page as proof of payment. Refunds, disputes, chargebacks, and recurring renewals are not handled by this success-only workflow. A verified paid-order transition automatically enqueues a provisioning job through a database trigger.

## Server provisioning queue

The `20261102000400_provisioning_queue.sql` migration adds a durable queue. A transition of an order to `paid` automatically inserts one job for that order; the unique order constraint prevents duplicate queue entries. The internal `provision-worker` Edge Function claims one ready job using `FOR UPDATE SKIP LOCKED`, a two-minute lease, and an incrementing attempt counter. Failed provider calls are retried with exponential backoff, capped at one hour, up to eight attempts. Exhausted jobs and their orders are marked failed. A confirmed provider response with a non-empty external ID marks the job succeeded and the order active.

The worker requires a configured HTTPS provider endpoint and sends a single order payload with an order-stable `Idempotency-Key`. The provider adapter must honor that key to prevent duplicate server creation if a network timeout occurs after the provider has already accepted a request. The worker does not claim jobs when the provider is unconfigured. It does not invent success: only a provider response with `status: "provisioned"` or `"active"` and a valid `external_id` completes an order.

### Provider adapter contract

Configure a trusted provisioning gateway that accepts:

```http
POST <PROVISIONER_API_URL>
Authorization: Bearer <PROVISIONER_API_TOKEN>
Idempotency-Key: anonymous-hosting-order-<order UUID>
Content-Type: application/json
```

The JSON body contains `event: "provision.order"`, order ID, currency, total in minor units, selected region, and line items with plan code/name/specifications and saved configuration. The gateway must return JSON such as:

```json
{ "status": "provisioned", "external_id": "provider-instance-reference" }
```

The gateway is a separate trusted service; do not set the endpoint to a user-controlled URL. Validate provider signatures/webhooks separately before accepting asynchronous state changes. The current worker handles synchronous acceptance only; asynchronous provider callbacks, suspend/unsuspend, cancellation, renewal, and deprovisioning remain future work.

### Deployment prerequisites

Apply migrations in order to the intended Anonymous Hosting Supabase project only:

- `supabase/migrations/20261102000100_anonymous_hosting_core.sql`
- `supabase/migrations/20261102000200_secure_order_creation.sql`
- `supabase/migrations/20261102000300_payment_event_processing.sql`
- `supabase/migrations/20261102000400_provisioning_queue.sql`

Configure secrets in the Supabase project, never in GitHub source:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` — for `create-order`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGINS` — exact comma-separated browser origins for `create-order`
- `PAYMENT_WEBHOOK_SECRET` — high-entropy secret shared only with the trusted normalized-event adapter
- `PROVISIONING_WORKER_SECRET` — high-entropy secret used to invoke the internal worker
- `PROVISIONER_API_URL` — HTTPS endpoint for your trusted provisioning gateway
- `PROVISIONER_API_TOKEN` — gateway authentication token

After confirming the correct project:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy create-order
supabase functions deploy payment-webhook
supabase functions deploy provision-worker
```

Invoke `provision-worker` from a trusted scheduler/queue runner using `Authorization: Bearer <PROVISIONING_WORKER_SECRET>`. Schedule it frequently (for example, once per minute); each invocation claims at most one job. Do not expose this worker endpoint in the browser.

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
- Migrations and Edge Functions are not deployed to Supabase by this repository workflow. No secrets or project credentials are stored in this repository.
