import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const html = read("index.html");
const css = read("assets/css/site.css");
const js = read("assets/js/site.js");
const account = read("account.html");
const accountJs = read("assets/js/account.js");
const publicConfig = read("assets/js/supabase-config.js");
const coreSql = read("supabase/migrations/20261102000100_anonymous_hosting_core.sql");
const orderSql = read("supabase/migrations/20261102000200_secure_order_creation.sql");
const paymentSql = read("supabase/migrations/20261102000300_payment_event_processing.sql");
const orderFn = read("supabase/functions/create-order/index.ts");
const paymentFn = read("supabase/functions/payment-webhook/index.ts");
const supabaseConfig = read("supabase/config.toml");
const backendDocs = read("docs/backend-foundation.md");

for (const marker of ['<html lang="en">', 'id="language"', 'id="services"', 'id="plans"', 'id="locations"', 'id="why"', 'id="plan-list"', 'assets/css/site.css', 'assets/js/site.js', 'id="mobile-menu"', 'id="configure-dialog"', 'id="configure-form"', 'data-order=', 'data-filter="domains"', 'data-type="rdp"', 'data-type="gpu"', 'data-type="domains"', 'href="account.html"']) assert.ok(html.includes(marker), `Missing storefront feature: ${marker}`);
assert.ok(!/<style[\\s>]/i.test(html), "Styles must live in the external stylesheet");
assert.ok(!/<script>/.test(html), "Application JavaScript must live in the external script");
for (const marker of ["--bg:", ".config-dialog", ".mobile-menu", ".account-card", ".account-password-field", ".order-items", ".account-profile", ".account-language", "@media(max-width:640px)"]) assert.ok(css.includes(marker), `Missing stylesheet feature: ${marker}`);
for (const marker of ["const translations=", "localStorage.setItem", "document.documentElement.dir=code==='ar'?'rtl':'ltr'", "configureDialog.showModal()", "no order was submitted"]) assert.ok(js.includes(marker), `Missing application behavior: ${marker}`);
for (const category of ["vps", "dedicated", "rdp", "gpu", "domains"]) assert.ok(html.includes(`data-type="${category}"`), `Missing plan category: ${category}`);
assert.equal((html.match(/data-type="[^"]+"/g) || []).length, 6, "Expected six demo plan cards");
assert.ok(!html.includes("anonymoushosting.example"), "Placeholder contact email must not be exposed");
assert.equal(html.split("<section").length - 1, html.split("</section>").length - 1, "Every section must have a closing tag");

for (const marker of ['<title>Customer account', 'id="auth-form"', 'id="auth-setup"', 'id="account-dashboard"', 'id="orders-list"', 'id="toggle-password"', 'id="account-language"', 'id="profile-form"', 'id="profile-name"', 'assets/js/supabase-config.js', 'assets/js/account.js']) assert.ok(account.includes(marker), `Missing account page feature: ${marker}`);
for (const marker of ['signInWithPassword', 'signUp', 'resetPasswordForEmail', 'signOut', '.from("ah_orders")', '.eq("user_id",userId)', 'ah_order_items(description_snapshot,quantity,unit_price_minor)', 'toggle-password', 'aria-busy', '.from("ah_profiles").update', 'applyLanguage', 'ah-language', 'messages =']) assert.ok(accountJs.includes(marker), `Missing account behavior: ${marker}`);
assert.ok(publicConfig.includes('url: ""') && publicConfig.includes('anonKey: ""'), "Supabase browser config must start empty");
assert.ok(/service_role|secret key/i.test(publicConfig), "Public config must warn against exposing privileged keys");
assert.ok(!accountJs.includes("service_role:") && !publicConfig.includes("service_role:"), "No service role credential may be embedded");
for (const asset of ["favicon.svg", ".nojekyll", "robots.txt"]) assert.ok(existsSync(new URL(asset, root)), `Missing static asset: ${asset}`);

for (const marker of ["create table if not exists public.ah_profiles", "create table if not exists public.ah_regions", "create table if not exists public.ah_products", "create table if not exists public.ah_plans", "create table if not exists public.ah_orders", "create table if not exists public.ah_order_items", "enable row level security", "auth.jwt()", "app_metadata", "auth.uid()"]) assert.ok(coreSql.toLowerCase().includes(marker.toLowerCase()), `Missing core database safeguard: ${marker}`);
assert.ok(!/drop table|truncate table/i.test(coreSql), "Core migration must not drop or truncate application data");
for (const marker of ["request_fingerprint", "security definer", "auth.role()", "service_role", "on conflict (user_id, idempotency_key)", "plan_unavailable", "region_unavailable", "v_price_minor * p_quantity", "replayed"]) assert.ok(orderSql.toLowerCase().includes(marker.toLowerCase()), `Missing secure order SQL behavior: ${marker}`);
assert.ok(!/drop table|truncate table/i.test(orderSql), "Order migration must not drop or truncate data");
for (const marker of ["auth.getUser", "SUPABASE_SERVICE_ROLE_KEY", "ALLOWED_ORIGINS", "idempotency-key", "ah_create_order", "userData.user.id", "unexpected_request_field", "request_too_large"]) assert.ok(orderFn.includes(marker), `Missing order Edge Function behavior: ${marker}`);
assert.ok(!["payload.user_id", "payload.price", "payload.total_minor", "payload.currency", "payload.status"].some((field) => orderFn.includes(field)), "Client must not choose user, price, currency, total, or status");

for (const marker of ["ah_payment_events", "unique (provider, event_id)", "enable row level security", "auth.role()", "service_role", "for update", "payment_amount_or_currency_mismatch", "order_not_payable", "status = 'paid'"]) assert.ok(paymentSql.toLowerCase().includes(marker.toLowerCase()), `Missing payment SQL safeguard: ${marker}`);
assert.ok(!/drop table|truncate table/i.test(paymentSql), "Payment migration must not drop or truncate data");
for (const marker of ["PAYMENT_WEBHOOK_SECRET", "crypto.subtle", "HMAC", "x-ah-signature", "Math.abs(now - timestamp) > 300", "ah_apply_payment_event", "payment.succeeded", "amount_minor", "order_id", 'typeof amountMinor !== "number"']) assert.ok(paymentFn.includes(marker), `Missing webhook verification behavior: ${marker}`);
assert.ok(!/Access-Control-Allow-Origin|Access-Control-Allow-Headers/.test(paymentFn), "Server-to-server webhook must not enable browser CORS");
assert.ok(supabaseConfig.includes("[functions.payment-webhook]") && supabaseConfig.includes("verify_jwt = false"), "Webhook must use signature authentication instead of user JWT");
for (const marker of ["payment-webhook", "PAYMENT_WEBHOOK_SECRET", "provider-specific", "ah_payment_events", "not deployed"]) assert.ok(backendDocs.toLowerCase().includes(marker.toLowerCase()), `Missing payment deployment documentation: ${marker}`);
console.log("Checks passed: storefront, six locales, RTL, account portal, additive RLS schema, trusted idempotent order API, and signed idempotent payment-event processing.");
