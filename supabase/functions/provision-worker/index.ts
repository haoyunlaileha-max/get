import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WORKER_SECRET = Deno.env.get("PROVISIONING_WORKER_SECRET") ?? "";
const PROVIDER_URL = Deno.env.get("PROVISIONER_API_URL") ?? "";
const PROVIDER_TOKEN = Deno.env.get("PROVISIONER_API_TOKEN") ?? "";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function constantTimeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!WORKER_SECRET || !constantTimeEqual(
    request.headers.get("authorization") ?? "",
    `Bearer ${WORKER_SECRET}`,
  )) return json(401, { error: "worker_authentication_failed" });

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(503, { error: "worker_not_configured" });

  let providerUrl: URL;
  try {
    providerUrl = new URL(PROVIDER_URL);
    if (providerUrl.protocol !== "https:" || !PROVIDER_TOKEN) {
      return json(503, { error: "provisioner_not_configured" });
    }
  } catch {
    return json(503, { error: "provisioner_not_configured" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: job, error: claimError } = await supabase.rpc("ah_claim_provisioning_job");
    if (claimError) return json(500, { error: "job_claim_failed" });
    if (!job) return new Response(null, { status: 204 });
    if (job.rejected) return json(409, { error: "order_not_provisionable" });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let providerResponse: Response;
    try {
      providerResponse = await fetch(providerUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${PROVIDER_TOKEN}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `anonymous-hosting-order-${job.order_id}`,
        },
        body: JSON.stringify({
          event: "provision.order",
          order_id: job.order_id,
          currency: job.currency,
          total_minor: job.total_minor,
          region: job.region,
          items: job.items,
        }),
        signal: controller.signal,
      });
    } catch {
      await supabase.rpc("ah_finish_provisioning_job", {
        p_job_id: job.job_id,
        p_success: false,
        p_provider_reference: null,
        p_error_code: "provider_unreachable",
      });
      return json(202, { accepted: true, job_status: "retry_scheduled" });
    } finally {
      clearTimeout(timeout);
    }

    if (!providerResponse.ok) {
      await supabase.rpc("ah_finish_provisioning_job", {
        p_job_id: job.job_id,
        p_success: false,
        p_provider_reference: null,
        p_error_code: `provider_http_${providerResponse.status}`,
      });
      return json(202, { accepted: true, job_status: "retry_scheduled" });
    }

    let providerResult: unknown;
    try {
      providerResult = await providerResponse.json();
    } catch {
      providerResult = null;
    }
    const result = providerResult && typeof providerResult === "object"
      ? providerResult as Record<string, unknown>
      : {};
    if (!["provisioned", "active"].includes(String(result.status))
      || typeof result.external_id !== "string"
      || result.external_id.trim().length === 0
      || result.external_id.length > 200) {
      await supabase.rpc("ah_finish_provisioning_job", {
        p_job_id: job.job_id,
        p_success: false,
        p_provider_reference: null,
        p_error_code: "invalid_provider_response",
      });
      return json(202, { accepted: true, job_status: "retry_scheduled" });
    }

    const { data: finished, error: finishError } = await supabase.rpc("ah_finish_provisioning_job", {
      p_job_id: job.job_id,
      p_success: true,
      p_provider_reference: result.external_id,
      p_error_code: null,
    });
    if (finishError) return json(500, { error: "job_completion_failed" });

    return json(200, { accepted: true, result: finished });
  } catch {
    return json(500, { error: "provisioning_worker_failed" });
  }
});
