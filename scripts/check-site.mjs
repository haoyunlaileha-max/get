import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const html = read("index.html");
const css = read("assets/css/site.css");
const js = read("assets/js/site.js");
const account = read("account.html");
const accountJs = read("assets/js/account.js");
const config = read("assets/js/supabase-config.js");
const sql = read("supabase/migrations/20261102000100_anonymous_hosting_core.sql");

for (const marker of ['<html lang="en">', 'id="language"', 'id="services"', 'id="plans"', 'id="locations"', 'id="why"', 'id="plan-list"', 'assets/css/site.css', 'assets/js/site.js', 'id="mobile-menu"', 'id="configure-dialog"', 'id="configure-form"', 'data-order=', 'data-filter="domains"', 'data-type="rdp"', 'data-type="gpu"', 'data-type="domains"', 'href="account.html"']) {
  assert.ok(html.includes(marker), `Missing storefront feature: ${marker}`);
}
assert.ok(!/<style[\s>]/i.test(html), "Styles must live in the external stylesheet");
assert.ok(!/<script>/.test(html), "Application JavaScript must live in the external script");
for (const marker of ["--bg:", ".config-dialog", ".mobile-menu", ".account-card", ".account-password-field", ".order-items", ".account-profile", ".account-language", "@media(max-width:640px)"]) assert.ok(css.includes(marker), `Missing stylesheet feature: ${marker}`);
for (const marker of ["const translations=", "localStorage.setItem", "document.documentElement.dir=code==='ar'?'rtl':'ltr'", "configureDialog.showModal()", "no order was submitted"]) assert.ok(js.includes(marker), `Missing application behavior: ${marker}`);
for (const category of ["vps", "dedicated", "rdp", "gpu", "domains"]) assert.ok(html.includes(`data-type="${category}"`), `Missing plan category: ${category}`);
assert.equal((html.match(/data-type="[^"]+"/g) || []).length, 6, "Expected six demo plan cards");
assert.ok(!html.includes("anonymoushosting.example"), "Placeholder contact email must not be exposed");
assert.equal((html.match(/<section\b/g) || []).length, (html.match(/<\/section>/g) || []).length, "Every section must have a closing tag");

for (const marker of ['<title>Customer account', 'id="auth-form"', 'id="auth-setup"', 'id="account-dashboard"', 'id="orders-list"', 'id="toggle-password"', 'id="account-language"', 'id="profile-form"', 'id="profile-name"', 'assets/js/supabase-config.js', 'assets/js/account.js']) assert.ok(account.includes(marker), `Missing account page feature: ${marker}`);
for (const marker of ['signInWithPassword', 'signUp', 'resetPasswordForEmail', 'signOut', '.from("ah_orders")', '.eq("user_id", userId)', 'ah_order_items(description_snapshot,quantity,unit_price_minor)', 'toggle-password', 'aria-busy', 'ah_profiles').update', 'applyLanguage', 'ah-language', 'messages =', 'never']) {
  if (marker !== "never") assert.ok(accountJs.includes(marker), `Missing account behavior: ${marker}`);
}
assert.ok(config.includes('url: ""') && config.includes('anonKey: ""'), "Supabase browser config must start empty");
assert.ok(/service_role|secret key/i.test(config), "Public config must warn against exposing privileged keys");
assert.ok(!/service_role\s*[:=]\s*["'][^"']+["']/i.test(accountJs + config), "No service role credential may be embedded");
for (const asset of ["favicon.svg", ".nojekyll", "robots.txt"]) assert.ok(existsSync(new URL(asset, root)), `Missing static asset: ${asset}`);
const requiredSql = ["create table if not exists public.ah_profiles", "create table if not exists public.ah_regions", "create table if not exists public.ah_products", "create table if not exists public.ah_plans", "create table if not exists public.ah_orders", "create table if not exists public.ah_order_items", "enable row level security", "auth.jwt()", "app_metadata", "auth.uid()"];
for (const marker of requiredSql) assert.ok(sql.toLowerCase().includes(marker.toLowerCase()), `Missing database security feature: ${marker}`);
assert.ok(!/drop table|truncate table/i.test(sql), "Migration must not drop or truncate application data");
console.log("Checks passed: storefront, six locales, RTL, account/auth portal, order isolation, public-key safety, and additive RLS schema.");
