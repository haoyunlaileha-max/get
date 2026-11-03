import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("PAYMENT_WEBHOOK_SECRET") ?? "";
const MAX_BODY_BYTES = 32_768;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function verifySignature(rawBody: string, header: string) {
  const parts: Record<string, string> = {};
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== "t" && name !== "v1") continue;
    if (Object.hasOwn(parts, name)) return false;
    parts[name] = part.slice(separator + 1).trim();
  }
  const timestamp = Number(parts.t);
  const signature = parts.v1 ?? "";
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > 300 || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`));
  return safeEqual(bytesToHex(new Uint8Array(signed)), signature.toLowerCase());
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json(415, { error: "application_json_required" });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !WEBHOOK_SECRET) {
    return json(503, { error: "webhook_not_configured" });
  }

  const signatureHeader = request.headers.get("x-ah-signature") ?? "";
  if (!signatureHeader) return json(401, { error: "signature_required" });

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      return json(400, { error: "invalid_content_length" });
    }
    if (parsedLength > MAX_BODY_BYTES) return json(413, { error: "request_too_large" });
  }

  let rawBody: string;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json(400, { error: "invalid_request_body" });
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return json(413, { error: "request_too_large" });
      }
      chunks.push(value);
    }
    const bodyBytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bodyBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    rawBody = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
  } catch {
    return json(400, { error: "invalid_request_body" });
  }

  try {
    if (!await verifySignature(rawBody, signatureHeader)) {
      return json(401, { error: "invalid_or_expired_signature" });
    }

    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json(400, { error: "invalid_event" });
    }
    const event = parsed as Record<string, unknown>;
    const data = event.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return json(400, { error: "invalid_event_data" });
    }
    const payment = data as Record<string, unknown>;
    const provider = event.provider;
    const eventId = event.id;
    const eventType = event.type;
    const orderId = payment.order_id;
    const amountMinor = payment.amount_minor;
    const currency = payment.currency;

    if (typeof provider !== "string" || !/^[a-z0-9_-]{2,40}$/.test(provider)
      || typeof eventId !== "string" || eventId.length < 1 || eventId.length > 200
      || eventType !== "payment.succeeded"
      || typeof orderId !== "string" || !UUID_PATTERN.test(orderId)
      || typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || amountMinor < 0
      || typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
      return json(400, { error: "unsupported_or_invalid_payment_event" });
    }

    const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: result, error } = await client.rpc("ah_apply_payment_event", {
      p_provider: provider,
      p_event_id: eventId,
      p_order_id: orderId,
      p_event_type: eventType,
      p_amount_minor: amountMinor,
      p_currency: currency,
      p_payload_sha256: await sha256(rawBody),
    });

    if (error) {
      const message = error.message ?? "";
      if (message.includes("order_not_found")) return json(404, { error: "order_not_found" });
      if (message.includes("amount_or_currency_mismatch")) return json(409, { error: "payment_amount_or_currency_mismatch" });
      if (message.includes("order_not_payable")) return json(409, { error: "order_not_payable" });
      if (message.includes("payment_event_conflict")) return json(409, { error: "event_id_conflict" });
      if (message.includes("not_authorized")) return json(403, { error: "webhook_not_authorized" });
      return json(400, { error: "payment_event_rejected" });
    }

    return json(200, { received: true, result });
  } catch {
    return json(400, { error: "invalid_webhook_payload" });
  }
});
