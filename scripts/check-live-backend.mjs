import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../assets/js/supabase-config.js", import.meta.url), "utf8");
const projectUrl = config.match(/url:\s*"([^"]+)"/)?.[1]?.replace(/\/$/, "");
assert.ok(projectUrl, "Supabase project URL must be configured");

const origins = ["https://anonport.com", "https://www.anonport.com", "https://haoyunlaileha-max.github.io"];
const endpoints = [
  { name: "token-auth", headers: "apikey,authorization,content-type,x-client-info" },
  { name: "create-order", headers: "authorization,apikey,content-type,x-client-info,idempotency-key" },
  { name: "cancel-order", headers: "authorization,apikey,content-type,x-client-info" },
  { name: "create-account-topup", headers: "authorization,apikey,content-type,x-client-info" },
  { name: "create-crypto-invoice", headers: "authorization,apikey,content-type,x-client-info" },
];

for (const origin of origins) {
  for (const endpoint of endpoints) {
    const response = await fetch(`${projectUrl}/functions/v1/${endpoint.name}`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": endpoint.headers,
      },
      signal: AbortSignal.timeout(12000),
    });
    assert.equal(response.status, 204, `${endpoint.name} preflight failed for ${origin}: HTTP ${response.status}`);
    assert.equal(response.headers.get("access-control-allow-origin"), origin, `${endpoint.name} did not allow ${origin}`);
    const allowedHeaders = (response.headers.get("access-control-allow-headers") || "").toLowerCase().split(",").map(value => value.trim());
    for (const header of endpoint.headers.split(",")) assert.ok(allowedHeaders.includes(header), `${endpoint.name} omitted CORS header ${header}`);
  }
}

console.log(`Live Supabase CORS smoke test passed: ${origins.length} origins × ${endpoints.length} customer endpoints.`);
