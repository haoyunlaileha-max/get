import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAX_BODY_BYTES = 65_536;
const ASSET_CODES = new Set(["BTC","ETH","USDT_ERC20","USDT_TRC20","LTC","TRX","SOL","BNB_BEP20","TON"]);

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function safeEqual(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("request_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function validTransfer(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.asset_code === "string" && ASSET_CODES.has(item.asset_code)
    && typeof item.transaction_hash === "string" && item.transaction_hash.length >= 8 && item.transaction_hash.length <= 200
    && Number.isSafeInteger(item.event_index) && Number(item.event_index) >= 0
    && typeof item.destination_address === "string" && item.destination_address.length >= 10 && item.destination_address.length <= 200
    && typeof item.amount_atomic === "string" && /^\d{1,78}$/.test(item.amount_atomic) && BigInt(item.amount_atomic) > 0n
    && Number.isSafeInteger(item.block_height) && Number(item.block_height) >= 0
    && Number.isSafeInteger(item.confirmations) && Number(item.confirmations) >= 0 && Number(item.confirmations) <= 10_000_000;
}

function addressMatches(family: string, expected: string, actual: string) {
  return family === "evm" ? expected.toLowerCase() === actual.toLowerCase() : expected === actual;
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(503, { error: "listener_not_configured" });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json(415, { error: "application_json_required" });
  }

  let body: Record<string, unknown> | null;
  try { body = await readBody(request); }
  catch (error) { return json(error instanceof Error && error.message === "request_too_large" ? 413 : 400, { error: "invalid_request_body" }); }
  if (!body || body.action !== "ingest" || !Array.isArray(body.transfers)
    || body.transfers.length < 1 || body.transfers.length > 50
    || body.transfers.some((item) => !validTransfer(item))) {
    return json(400, { error: "invalid_transfer_batch" });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const secret = request.headers.get("x-listener-secret") ?? "";
  const { data: authorized, error: authorizationError } = await db.rpc("ah_crypto_scan_authorized", { p_secret: secret });
  if (authorizationError || authorized !== true) return json(401, { error: "listener_authentication_failed" });
  const results: Array<Record<string, unknown>> = [];
  let matched = 0, confirmed = 0, manualReview = 0;

  for (const raw of body.transfers as Record<string, unknown>[]) {
    const assetCode = String(raw.asset_code);
    const txHash = String(raw.transaction_hash);
    const eventIndex = Number(raw.event_index);
    const amountAtomic = String(raw.amount_atomic);
    const destination = String(raw.destination_address);
    const confirmations = Number(raw.confirmations);

    const { data: asset, error: assetError } = await db.from("ah_crypto_assets")
      .select("asset_code,chain_family,wallet_address,confirmations_required,listener_enabled,listener_status")
      .eq("asset_code", assetCode).maybeSingle();
    if (assetError || !asset || !asset.listener_enabled || asset.listener_status !== "ready") {
      results.push({ asset_code: assetCode, transaction_hash: txHash, status: "listener_not_ready" });
      continue;
    }
    if (!addressMatches(String(asset.chain_family), String(asset.wallet_address), destination)) {
      results.push({ asset_code: assetCode, transaction_hash: txHash, status: "destination_mismatch" });
      continue;
    }

    const { data: existing } = await db.from("ah_crypto_transfers").select("deposit_id")
      .eq("asset_code", assetCode).eq("transaction_hash", txHash).eq("event_index", eventIndex).maybeSingle();
    let deposit: Record<string, unknown> | null = null;
    if (existing?.deposit_id) {
      const { data } = await db.from("ah_crypto_deposits").select("id,order_id,expected_amount_atomic,quoted_usdt_minor,status,expires_at")
        .eq("id", existing.deposit_id).maybeSingle();
      deposit = data;
    }
    if (!deposit) {
      const { data } = await db.from("ah_crypto_deposits")
        .select("id,order_id,expected_amount_atomic,quoted_usdt_minor,status,expires_at")
        .eq("asset_code", assetCode).eq("expected_amount_atomic", amountAtomic)
        .in("status", ["awaiting", "detected", "confirming"])
        .gt("expires_at", new Date().toISOString()).maybeSingle();
      deposit = data;
    }

    if (!deposit) {
      const { error } = await db.from("ah_crypto_transfers").upsert({
        asset_code: assetCode, transaction_hash: txHash, event_index: eventIndex,
        destination_address: destination, amount_atomic: amountAtomic, block_height: Number(raw.block_height),
        confirmations, status: "manual_review", deposit_id: null, last_seen_at: new Date().toISOString(),
      }, { onConflict: "asset_code,transaction_hash,event_index" });
      if (error) return json(500, { error: "transfer_persistence_failed" });
      manualReview++;
      results.push({ asset_code: assetCode, transaction_hash: txHash, status: "manual_review" });
      continue;
    }

    if (deposit.status === "confirmed") {
      results.push({ asset_code: assetCode, transaction_hash: txHash, status: "already_settled" });
      continue;
    }

    const transferStatus = confirmations >= Number(asset.confirmations_required) ? "confirmed" : "confirming";
    const { error: transferError } = await db.from("ah_crypto_transfers").upsert({
      asset_code: assetCode, transaction_hash: txHash, event_index: eventIndex,
      destination_address: destination, amount_atomic: amountAtomic, block_height: Number(raw.block_height),
      confirmations, status: transferStatus, deposit_id: deposit.id, last_seen_at: new Date().toISOString(),
      ...(transferStatus === "confirmed" ? { confirmed_at: new Date().toISOString() } : {}),
    }, { onConflict: "asset_code,transaction_hash,event_index" });
    if (transferError) return json(500, { error: "transfer_persistence_failed" });

    const { data: linked, error: linkedError } = await db.from("ah_crypto_transfers")
      .select("amount_atomic,confirmations,status").eq("deposit_id", deposit.id)
      .not("status", "in", '("ignored","reorged","manual_review")');
    if (linkedError) return json(500, { error: "transfer_aggregation_failed" });
    const total = (linked ?? []).reduce((sum, row) => sum + BigInt(String(row.amount_atomic)), 0n);
    const minConfirmations = (linked ?? []).reduce((min, row) => Math.min(min, Number(row.confirmations)), Number.MAX_SAFE_INTEGER);
    const expected = BigInt(String(deposit.expected_amount_atomic));
    const required = Number(asset.confirmations_required);

    if (total > expected) {
      await db.from("ah_crypto_deposits").update({ received_amount_atomic: total.toString(), status: "overpaid", updated_at: new Date().toISOString() }).eq("id", deposit.id);
      manualReview++;
      results.push({ asset_code: assetCode, transaction_hash: txHash, status: "overpaid" });
      continue;
    }

    const isFullyConfirmed = total === expected && minConfirmations >= required;
    const nextStatus = isFullyConfirmed ? "confirmed" : total > 0n ? "confirming" : "awaiting";
    const { error: depositError } = await db.from("ah_crypto_deposits").update({
      received_amount_atomic: total.toString(), status: nextStatus,
      ...(isFullyConfirmed ? { confirmed_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    }).eq("id", deposit.id);
    if (depositError) return json(500, { error: "deposit_update_failed" });
    matched++;

    if (isFullyConfirmed) {
      const stableHash = await digest("direct-wallet-crypto|" + deposit.id + "|" + String(deposit.quoted_usdt_minor));
      const { error: paymentError } = await db.rpc("ah_apply_payment_event", {
        p_provider: "direct_wallet_crypto",
        p_event_id: "deposit:" + String(deposit.id),
        p_order_id: String(deposit.order_id),
        p_event_type: "payment.succeeded",
        p_amount_minor: Number(deposit.quoted_usdt_minor),
        p_currency: "USDT",
        p_payload_sha256: stableHash,
      });
      if (paymentError) {
        await db.from("ah_crypto_deposits").update({ status: "manual_review", updated_at: new Date().toISOString() }).eq("id", deposit.id);
        manualReview++;
        results.push({ asset_code: assetCode, transaction_hash: txHash, status: "payment_requires_review" });
        continue;
      }
      confirmed++;
      results.push({ asset_code: assetCode, transaction_hash: txHash, status: "confirmed", order_id: deposit.order_id });
    } else {
      results.push({ asset_code: assetCode, transaction_hash: txHash, status: "confirming", order_id: deposit.order_id });
    }
  }

  return json(200, { ok: true, received: body.transfers.length, matched, confirmed, manual_review: manualReview, results });
});
