import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const required = [
  '<html lang="en">',
  'id="language"',
  'id="services"',
  'id="plans"',
  'id="locations"',
  'id="why"',
  'id="plan-list"',
  'localStorage.setItem',
  "document.documentElement.dir=code==='ar'?'rtl':'ltr'",
  "const translations=",
  "en:{",
  "zh:{",
  "ar:{",
  "fr:{",
  "ru:{",
  "es:{"
];

for (const marker of required) {
  assert.ok(html.includes(marker), `Missing required storefront feature: ${marker}`);
}

assert.ok(existsSync(new URL("../favicon.svg", import.meta.url)), "favicon.svg must exist");
assert.ok(existsSync(new URL("../.nojekyll", import.meta.url)), ".nojekyll must exist");
assert.equal((html.match(/<section\b/g) || []).length, (html.match(/<\/section>/g) || []).length,
  "Every section must have a closing tag");

console.log("Storefront checks passed: core sections, six languages, RTL, persistence, and static assets.");
