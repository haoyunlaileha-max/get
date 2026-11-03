import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PUBLISHABLE_KEYS_RAW = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}";
const allowedOrigins = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? "https://haoyunlaileha-max.github.io")
    .split(",").map((value) => value.trim()).filter(Boolean),
);
const encoder = new TextEncoder();
const tokenPattern = /^[A-Fa-f0-9]{4}(?:-[A-Fa-f0-9]{4}){15}$/;

function getPublishableKey() {
  try {
    const keys = JSON.parse(PUBLISHABLE_KEYS_RAW) as Record<string, string>;
    return typeof keys.default === "string" ? keys.default : "";
  } catch {
    return "";
  }
}

function json(status: number, body: Record<string, unknown>, origin: string | null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "apikey, authorization, content-type, x-client-info");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return hex(new Uint8Array(digest));
}

async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return hex(new Uint8Array(signature));
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    if (!origin || !allowedOrigins.has(origin)) return json(403, { error: "origin_not_allowed" }, null);
    return json(204, {}, origin);
  }
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, origin);
  if (!origin || !allowedOrigins.has(origin)) return json(403, { error: "origin_not_allowed" }, null);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json(415, { error: "application_json_required" }, origin);
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(503, { error: "auth_service_not_configured" }, origin);
  }

  const apiKey = request.headers.get("apikey") ?? "";
  const acceptedKeys = [SUPABASE_ANON_KEY, getPublishableKey()].filter(Boolean);
  if (!apiKey || !acceptedKeys.includes(apiKey)) return json(401, { error: "invalid_client_key" }, origin);

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 4096) return json(413, { error: "request_too_large" }, origin);

  let payload: Record<string, unknown>;
  try {
    // Read incrementally so a missing or dishonest Content-Length cannot force
    // an unbounded allocation before the request-size check.
    const reader = request.body?.getReader();
    if (!reader) return json(400, { error: "invalid_json" }, origin);
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > 4096) {
        await reader.cancel();
        return json(413, { error: "request_too_large" }, origin);
      }
      chunks.push(value);
    }
    const raw = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      raw.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json(400, { error: "invalid_request" }, origin);
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "invalid_json" }, origin);
  }

  const action = payload.action;
  const suppliedToken = payload.token;
  if (Object.keys(payload).some((key) => !["action", "token"].includes(key))) {
    return json(400, { error: "unexpected_request_field" }, origin);
  }
  if (action !== "register" && action !== "login") return json(400, { error: "invalid_action" }, origin);
  if (typeof suppliedToken !== "string" || !tokenPattern.test(suppliedToken)) {
    return json(400, { error: "invalid_token_format" }, origin);
  }

  const token = suppliedToken.replaceAll("-", "").toLowerCase();
  const ip = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const ipDigest = await hmacSha256(SUPABASE_SERVICE_ROLE_KEY, ip);
    const { data: allowed, error: limitError } = await admin.rpc("ah_consume_token_auth_attempt", {
      p_bucket_key: `${action}:${ipDigest}`,
      p_limit: action === "register" ? 5 : 15,
      p_window_seconds: action === "register" ? 3600 : 900,
    });
    if (limitError || allowed !== true) {
      return json(limitError ? 503 : 429, { error: limitError ? "rate_limit_unavailable" : "too_many_attempts" }, origin);
    }

    const tokenHash = await sha256(token);
    const email = `token-${tokenHash}@users.anonymous-hosting.invalid`;

    if (action === "register") {
      const { error } = await admin.auth.admin.createUser({
        email,
        password: token,
        email_confirm: true,
        user_metadata: {
          display_name: "令牌账户",
          auth_method: "access_token",
        },
      });
      if (error) {
        const message = (error.message ?? "").toLowerCase();
        if (error.code === "email_exists" || message.includes("already been registered") || message.includes("already exists")) {
          return json(409, { error: "token_already_registered" }, origin);
        }
        return json(400, { error: "account_creation_failed" }, origin);
      }
      return json(201, { registered: true }, origin);
    }

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await authClient.auth.signInWithPassword({ email, password: token });
    if (error || !data.session) return json(401, { error: "invalid_token" }, origin);

    return json(200, {
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    }, origin);
  } catch {
    return json(500, { error: "internal_server_error" }, origin);
  }
});
