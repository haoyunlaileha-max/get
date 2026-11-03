import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS")?.trim() || "https://haoyunlaileha-max.github.io")
  .split(",").map((value) => value.trim()).filter(Boolean);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 4_096;

function response(status: number, body: Record<string, unknown>, origin: string | null) {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin" });
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    if (!origin || !allowedOrigins.includes(origin)) return response(403, { error: "origin_not_allowed" }, null);
    return response(204, {}, origin);
  }
  if (request.method !== "POST") return response(405, { error: "method_not_allowed" }, origin);
  if (!origin || !allowedOrigins.includes(origin)) return response(403, { error: "origin_not_allowed" }, null);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return response(503, { error: "server_not_configured" }, origin);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return response(415, { error: "application_json_required" }, origin);

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) return response(413, { error: "request_too_large" }, origin);
  const authorization = request.headers.get("authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch || tokenMatch[1].length > 8_192) return response(401, { error: "authentication_required" }, origin);

  let payload: Record<string, unknown>;
  try {
    const reader = request.body?.getReader();
    if (!reader) return response(400, { error: "invalid_json" }, origin);
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) { await reader.cancel(); return response(413, { error: "request_too_large" }, origin); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return response(400, { error: "invalid_request_body" }, origin);
    payload = parsed as Record<string, unknown>;
    if (Object.keys(payload).length !== 1 || !Object.hasOwn(payload, "order_id")) return response(400, { error: "unexpected_request_field" }, origin);
  } catch { return response(400, { error: "invalid_json" }, origin); }

  const orderId = payload.order_id;
  if (typeof orderId !== "string" || !uuidPattern.test(orderId)) return response(400, { error: "valid_order_id_required" }, origin);

  try {
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
    if (authError || !userData.user) return response(401, { error: "invalid_or_expired_session" }, origin);

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await adminClient.rpc("ah_cancel_unpaid_order", {
      p_order_id: orderId,
      // Identity comes exclusively from the verified Supabase session.
      p_user_id: userData.user.id,
    });
    if (error) {
      const message = error.message ?? "";
      if (message.includes("order_not_found")) return response(404, { error: "order_not_found" }, origin);
      if (message.includes("order_requires_payment_or_provider_workflow")) return response(409, { error: "order_not_cancellable" }, origin);
      if (message.includes("not_authorized")) return response(403, { error: "not_authorized" }, origin);
      return response(500, { error: "order_cancellation_failed" }, origin);
    }
    return response(200, { order: data }, origin);
  } catch { return response(500, { error: "internal_server_error" }, origin); }
});
