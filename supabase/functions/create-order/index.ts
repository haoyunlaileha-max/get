import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const configuredOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set([
  ...configuredOrigins,
  "https://haoyunlaileha-max.github.io",
  "https://anonport.com",
  "https://www.anonport.com",
])];

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const idempotencyPattern = /^[A-Za-z0-9._:-]{16,128}$/;

function response(status: number, body: Record<string, unknown>, origin: string | null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info, idempotency-key");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    if (!origin || !allowedOrigins.includes(origin)) {
      return response(403, { error: "origin_not_allowed" }, null);
    }
    return response(204, {}, origin);
  }
  if (request.method !== "POST") {
    return response(405, { error: "method_not_allowed" }, origin);
  }
  if (!origin || !allowedOrigins.includes(origin)) {
    return response(403, { error: "origin_not_allowed" }, null);
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return response(503, { error: "server_not_configured" }, origin);
  }

  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return response(415, { error: "application_json_required" }, origin);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 16_384) return response(413, { error: "request_too_large" }, origin);

  const authorization = request.headers.get("authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch || tokenMatch[1].length > 8_192) {
    return response(401, { error: "authentication_required" }, origin);
  }

  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!idempotencyPattern.test(idempotencyKey)) {
    return response(400, { error: "valid_idempotency_key_required" }, origin);
  }

  let payload: Record<string, unknown>;
  try {
    // Enforce the limit against the actual streamed bytes; Content-Length is optional
    // and must never be trusted as the sole request-size check.
    const reader = request.body?.getReader();
    if (!reader) return response(400, { error: "invalid_json" }, origin);
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > 16_384) {
        await reader.cancel();
        return response(413, { error: "request_too_large" }, origin);
      }
      chunks.push(value);
    }
    const bodyBytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bodyBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const bodyText = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
    const parsed: unknown = JSON.parse(bodyText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return response(400, { error: "invalid_request_body" }, origin);
    }
    payload = parsed as Record<string, unknown>;
    const allowedFields = new Set(["plan_id", "region_id", "quantity", "customer_note"]);
    if (Object.keys(payload).some((key) => !allowedFields.has(key))) {
      return response(400, { error: "unexpected_request_field" }, origin);
    }
  } catch {
    return response(400, { error: "invalid_json" }, origin);
  }

  const planId = payload.plan_id;
  const regionId = payload.region_id ?? null;
  const quantity = payload.quantity ?? 1;
  const customerNote = payload.customer_note ?? null;
  if (typeof planId !== "string" || !uuidPattern.test(planId)) {
    return response(400, { error: "valid_plan_id_required" }, origin);
  }
  if (regionId !== null && (typeof regionId !== "string" || !uuidPattern.test(regionId))) {
    return response(400, { error: "invalid_region_id" }, origin);
  }
  if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 20) {
    return response(400, { error: "quantity_must_be_between_1_and_20" }, origin);
  }
  if (customerNote !== null && (typeof customerNote !== "string" || customerNote.length > 500)) {
    return response(400, { error: "customer_note_too_long" }, origin);
  }

  try {
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
    if (authError || !userData.user) {
      return response(401, { error: "invalid_or_expired_session" }, origin);
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await adminClient.rpc("ah_create_order", {
      p_user_id: userData.user.id,
      p_plan_id: planId,
      p_region_id: regionId,
      p_quantity: quantity,
      p_idempotency_key: idempotencyKey,
      p_customer_note: customerNote,
    });

    if (error) {
      const message = error.message ?? "";
      if (message.includes("plan_unavailable") || message.includes("region_unavailable")) {
        return response(409, { error: "plan_or_region_unavailable" }, origin);
      }
      if (message.includes("idempotency_conflict")) {
        return response(409, { error: "idempotency_key_reused_with_different_request" }, origin);
      }
      if (message.includes("not_authorized")) {
        return response(403, { error: "order_service_not_authorized" }, origin);
      }
      if (message.includes("invalid_") || message.includes("order_total_overflow")) {
        return response(400, { error: "invalid_order" }, origin);
      }
      // Do not return raw database messages or credentials to the browser.
      return response(500, { error: "order_creation_failed" }, origin);
    }

    const replayed = Boolean(data && typeof data === "object" && data.replayed === true);
    return response(replayed ? 200 : 201, { order: data }, origin);
  } catch {
    return response(500, { error: "internal_server_error" }, origin);
  }
});
