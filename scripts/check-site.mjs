import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../assets/css/site.css", import.meta.url), "utf8");
const js = readFileSync(new URL("../assets/js/site.js", import.meta.url), "utf8");
const sql = readFileSync(new URL("../supabase/migrations/20261102000100_anonymous_hosting_core.sql", import.meta.url), "utf8");
const requiredHtml = [
  '<html lang="en">', 'id="language"', 'id="services"', 'id="plans"',
  'id="locations"', 'id="why"', 'id="plan-list"', 'assets/css/site.css',
  'assets/js/site.js', 'id="mobile-menu"', 'id="configure-dialog"',
  'id="configure-form"', 'data-order=', 'data-filter="domains"',
  'data-type="rdp"', 'data-type="gpu"', 'data-type="domains"'
];
for (const marker of requiredHtml) assert.ok(html.includes(marker), `Missing storefront feature: ${marker}`);
assert.ok(!/<style[\s>]/i.test(html), "Styles must live in the external stylesheet");
assert.ok(!/<script>/.test(html), "Application JavaScript must live in the external script");
for (const marker of ["--bg:", ".config-dialog", ".mobile-menu", "@media(max-width:640px)"]) {
  assert.ok(css.includes(marker), `Missing stylesheet feature: ${marker}`);
}
for (const marker of ["const translations=", "localStorage.setItem", "document.documentElement.dir=code==='ar'?'rtl':'ltr'", "configureDialog.showModal()", "no order was submitted"]) {
  assert.ok(js.includes(marker), `Missing application behavior: ${marker}`);
}
for (const category of ["vps", "dedicated", "rdp", "gpu", "domains"]) {
  assert.ok(html.includes(`data-type="${category}"`), `Missing plan category: ${category}`);
}
assert.equal((html.match(/data-type="[^"]+"/g) || []).length, 6, "Expected six demo plan cards");
assert.ok(!html.includes("anonymoushosting.example"), "Placeholder contact email must not be exposed");
assert.equal((html.match(/<section\b/g) || []).length, (html.match(/<\/section>/g) || []).length, "Every section must have a closing tag");
for (const asset of ["favicon.svg", ".nojekyll", "robots.txt"]) assert.ok(existsSync(new URL("../" + asset, import.meta.url)), `Missing static asset: ${asset}`);
const requiredSql = [
  "create table if not exists public.ah_profiles", "create table if not exists public.ah_regions",
  "create table if not exists public.ah_products", "create table if not exists public.ah_plans",
  "create table if not exists public.ah_orders", "create table if not exists public.ah_order_items",
  "enable row level security", "auth.jwt()", "app_metadata", "auth.uid()"
];
for (const marker of requiredSql) assert.ok(sql.toLowerCase().includes(marker.toLowerCase()), `Missing database security feature: ${marker}`);
assert.ok(!/drop table|truncate table/i.test(sql), "Migration must not drop or truncate application data");
console.log("Checks passed: modular storefront assets, six locales, RTL, catalog, demo configurator, and additive RLS schema.");
