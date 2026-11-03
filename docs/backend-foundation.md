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
- `ah_plan_regions`: explicit plan-to-data-center availability and capacity, with transactionally reserved allocated units.

Prices use minor currency units (for example, 1299 = USD 12.99). Browser-submitted prices, totals, user IDs, and order status are never trusted.

## Secure order creation

The `create-order` Supabase Edge Function accepts only a plan ID, optional region ID, quantity, optional customer note, the caller's bearer token, and an `Idempotency-Key` header.

1. The Edge Function checks the origin against `ALLOWED_ORIGINS`, then enforces a 16 KiB limit while reading the actual request stream (not trusting the optional `Content-Length` header). The bearer token is also capped at 8 KiB.
2. It validates the bearer token with Supabase Auth and obtains the user ID from the verified session.
3. It calls `ah_create_order` using the service-role client, which exists only in the function environment.
4. The database function independently validates the service role, quantity and idempotency, reads the active plan/product and optional active region, calculates the total from the database price, and atomically inserts the order and price snapshot.
5. Repeating the same idempotency key with the same request returns the original order. Reusing it for different request data returns a conflict.

## Verified payment notification foundation

The `payment-webhook` function is a provider-neutral **normalized event receiver**, not a ready-made Stripe/PayPal integration. It rejects a declared body larger than 32 KiB and enforces the same limit while streaming the actual request bytes before buffering; `Content-Length` is only an early-rejection hint. Its normalized HMAC header accepts exactly one `t` timestamp and one `v1` signature; duplicate fields are rejected, and `Content-Length` must use decimal digits only. It expects an upstream provider-specific adapter to verify the provider's native signature and map a genuine success notification into this envelope:

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

## Safe unpaid-order cancellation

Migration `20261103061000_cancel_unpaid_orders_safely.sql` adds the service-role-only `ah_cancel_unpaid_order(uuid)` RPC. It locks the order, allows only `pending` and `awaiting_payment` orders to transition to `cancelled`, returns an idempotent result for an already-cancelled order, and relies on the existing once-only inventory-release trigger. It deliberately refuses paid, provisioning, active, suspended, failed, and refunded orders: those states must use dedicated payment-refund and provider-lifecycle workflows. It does not forcibly terminate a processing provisioning job; if an already-running provider request later succeeds, the existing completion fence retains the provider reference and flags reconciliation.

## Server provisioning queue

The `20261103032419_provisioning_queue.sql` migration adds a durable queue. A transition of an order to `paid` automatically inserts one job for that order; the unique order constraint prevents duplicate queue entries. The internal `provision-worker` Edge Function claims one ready job using `FOR UPDATE SKIP LOCKED`, a two-minute lease, a fresh lease token, and an incrementing attempt counter. Migration `20261103052950_fence_provisioning_job_leases.sql` makes completion conditional on the same unexpired token, so a delayed worker cannot overwrite a later attempt. Failed provider calls are retried with exponential backoff, capped at one hour, up to eight attempts. Exhausted jobs and their orders are marked failed. A confirmed provider response with a non-empty external ID marks the job succeeded and the order active only if the order is still in `provisioning`. Migration `20261103054559_fence_order_state_during_provisioning.sql` locks and rechecks the order at completion: if a cancellation/refund/other terminal transition won the race, the provider reference is retained and the job is flagged `requires_reconciliation` for manual provider-side cleanup; failed calls are not retried after the order leaves provisioning.

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

- `supabase/migrations/20261103032042_anonymous_hosting_core.sql`
- `supabase/migrations/20261103032407_secure_order_creation.sql`
- `supabase/migrations/20261103032413_payment_event_processing.sql`
- `supabase/migrations/20261103032419_provisioning_queue.sql`
- `supabase/migrations/20261103032425_admin_console_read_access.sql`
- `supabase/migrations/20261103032449_plan_region_inventory.sql`
- `supabase/migrations/20261103052950_fence_provisioning_job_leases.sql`
- `supabase/migrations/20261103052132_lock_down_order_mutations.sql`

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

## Plan-to-region inventory

Migration `20261103032449_plan_region_inventory.sql` adds `ah_plan_regions`, an admin-managed mapping between plans and data-center regions. Each mapping has an availability switch, optional unit capacity (blank means unlimited), and a database-maintained allocated-unit count. New mappings seed allocated units from existing non-terminal orders. Order creation locks the mapping row, requires a region once a plan has any explicit region mappings, checks region and mapping availability, verifies capacity, then reserves quantity in the same transaction. Idempotent replays do not reserve twice. Moving an order to cancelled, failed, or refunded releases its reservation once; active and suspended services remain allocated. Plans with no mappings retain the legacy region behavior until an administrator configures their first mapping.

## Admin operations console

The static `admin.html` page is a browser-only operations interface. It verifies the current user with Supabase Auth and requires the verified JWT `app_metadata.role = admin`. The UI check is only a convenience gate: the database remains authoritative through admin RLS policies. Migration `20261103032425_admin_console_read_access.sql` grants authenticated users SELECT privileges on payment and provisioning records but adds RLS policies that return rows only when `ah_is_admin()` is true. Existing RLS policies already restrict product, plan, and region mutations to the same verified admin role.

The console provides exact count metrics, recent order history, recent payment-event records, provisioning job state, product/plan activation toggles, region availability controls, admin-only product/plan create/edit forms, and plan-to-region inventory assignments. Product fields include slug, category, description and sort order. Plan fields include product association, unique code, price in major currency units (converted to integer minor units), currency, billing period, JSON specifications (CPU, RAM, storage, bandwidth, OS options), sort order and publication state. New records default to inactive; existing prices change only when an administrator explicitly edits and saves that plan. The browser validates inputs and database RLS remains authoritative. The console still does not expose direct order status changes, manual payment marking, provider credentials, or destructive operations. Migration `20261103052132_lock_down_order_mutations.sql` removes all browser-authenticated INSERT/UPDATE/DELETE grants and admin write policies on `ah_orders` and `ah_order_items`; authenticated users (including admins) can only read rows allowed by RLS. Order creation, payment transitions, and provisioning updates remain restricted to service-role-only server workflows. Configure only the public Supabase URL and anon/publishable key in `assets/js/supabase-config.js`; never place a service-role key in the browser. Admin users must be assigned `app_metadata.role = admin` by a trusted project administrator through the Supabase Auth Admin API or Dashboard; ordinary users must not be able to set this field themselves.

### Admin rollout

Apply migration `20261103032425_admin_console_read_access.sql` after migrations 0001–0004, then apply `20261103032449_plan_region_inventory.sql` to enable plan-region capacity management, and finally apply `20261103052132_lock_down_order_mutations.sql` to make browser access to orders read-only. Once the intended Supabase project is configured and the trusted administrator role is assigned, open `/admin.html`. The console will remain unavailable until the migrations, public browser configuration, and admin role are correctly set up.

## Token authentication rate limiting

The `token-auth` Edge Function applies database-backed per-IP limits: at most five registrations per hour and fifteen login attempts per fifteen minutes. It also enforces a 4 KiB request-body limit while reading the actual stream, rather than relying only on the optional `Content-Length` header. IP values are HMAC-SHA256 digests keyed with the server-side service-role secret; raw IP addresses are not stored. Migration `20261103043218_cleanup_token_auth_rate_limits.sql` adds an index and removes buckets that have been inactive for more than 24 hours during subsequent auth attempts, keeping this operational table bounded. These limits protect token registration and login only; order-creation abuse throttling remains future work.

## Row-level security

- Visitors can read active catalog entries and regions.
- Customers can read/update their own profile and read only their own orders/items.
- Browser-authenticated users, including admins, have SELECT-only privileges on orders and order items; all order mutations use trusted service-role-only server workflows.
- Catalog writes remain reserved for verified administrators.
- Admin access uses only verified JWT `app_metadata.role=admin`, never user-editable `user_metadata`.
- Payment event records have RLS enabled; only verified admins can read them through the admin console.
- Provisioning job records have RLS enabled; only verified admins can read them through the admin console.
- Service-role credentials must remain server-side.

## Current limitations

- The storefront can load active products, plans, and regions from the Supabase catalog. Signed-in customers submit plan and region IDs to the `create-order` Edge Function; the function verifies the session and delegates to the service-role-only `ah_create_order` RPC, which derives prices from the database and reserves configured regional capacity. Successful submission creates a pending order only. The order function does not collect payment details or charge a customer. The webhook advances an order to paid only after a correctly signed normalized success event and database checks.
- The normalized HMAC receiver is not a substitute for a provider-specific native signature adapter.
- Refunds, disputes, chargebacks, provider API integration, audit monitoring, and order-creation abuse throttling remain future work. Token registration and login have separate database-backed per-IP limits.
- Migrations and Edge Functions are not deployed to Supabase by this repository workflow. No secrets or project credentials are stored in this repository.
- The admin console is committed and Pages-deployable, but it requires migrations 0001–0005, a configured public Supabase client, and a trusted admin role before operational data is visible.
