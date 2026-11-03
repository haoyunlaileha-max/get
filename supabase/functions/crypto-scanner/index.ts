import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ETH_RPC = Deno.env.get("ETHEREUM_RPC_URL") ?? "https://ethereum-rpc.publicnode.com";
const BSC_RPC = Deno.env.get("BSC_RPC_URL") ?? "https://bsc-dataseed.binance.org";
const SOL_RPC = Deno.env.get("SOLANA_RPC_URL") ?? "https://api.mainnet-beta.solana.com";
const TRON_KEY = Deno.env.get("TRONGRID_API_KEY") ?? "";
const MAX_BATCH = 50;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type Asset = {
  asset_code: string; chain_family: string; ticker: string; network: string;
  token_contract: string | null; decimals: number; wallet_address: string;
  confirmations_required: number; listener_enabled: boolean; listener_status: string;
};
type Transfer = {
  asset_code: string; transaction_hash: string; event_index: number;
  destination_address: string; amount_atomic: string; block_height: number; confirmations: number;
};

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
async function fetchJson(url: string, init: RequestInit = {}, timeout = 12_000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const result = await fetch(url, { ...init, signal: controller.signal, headers: { accept: "application/json", ...(init.headers ?? {}) } });
    if (!result.ok) throw new Error("provider_http_" + result.status);
    return await result.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("provider_timeout");
    throw error;
  } finally { clearTimeout(timer); }
}
async function rpc(endpoint: string, method: string, params: unknown[]) {
  const result = await fetchJson(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (result.error) throw new Error("rpc_" + method + "_failed");
  return result.result;
}
function hexNumber(value: string | null | undefined) { return value ? Number(BigInt(value)) : 0; }
function safeAddressEqual(a: string, b: string, family: string) { return family === "evm" ? a.toLowerCase() === b.toLowerCase() : a === b; }
function topicAddress(address: string) { return "0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0"); }

async function authorized(db: ReturnType<typeof createClient>, secret: string) {
  if (!secret) return false;
  const { data, error } = await db.rpc("ah_crypto_scan_authorized", { p_secret: secret });
  return !error && data === true;
}
async function ingest(endpoint: string, secret: string, transfers: Transfer[]) {
  let accepted = 0;
  for (let i = 0; i < transfers.length; i += MAX_BATCH) {
    const batch = transfers.slice(i, i + MAX_BATCH);
    const result = await fetchJson(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-listener-secret": secret }, body: JSON.stringify({ action: "ingest", transfers: batch }) });
    if (!result.ok) throw new Error("listener_ingest_rejected");
    accepted += Number(result.received ?? batch.length);
  }
  return accepted;
}
async function markCursor(db: ReturnType<typeof createClient>, asset: Asset, cursor: string | null, errorCode: string | null) {
  await db.from("ah_crypto_listener_cursors").upsert({
    asset_code: asset.asset_code, ...(cursor !== null ? { cursor_value: cursor } : {}),
    last_scanned_at: new Date().toISOString(), ...(errorCode ? { last_error_code: errorCode, consecutive_failures: 1 } : { last_success_at: new Date().toISOString(), last_error_code: null, consecutive_failures: 0 }),
    updated_at: new Date().toISOString(),
  }, { onConflict: "asset_code" });
  await db.from("ah_crypto_assets").update({
    listener_status: errorCode ? "degraded" : "ready", updated_at: new Date().toISOString(),
  }).eq("asset_code", asset.asset_code);
}
async function getCursor(db: ReturnType<typeof createClient>, code: string) {
  const { data } = await db.from("ah_crypto_listener_cursors").select("cursor_value").eq("asset_code", code).maybeSingle();
  return data?.cursor_value ?? null;
}

async function scanUtxo(db: ReturnType<typeof createClient>, asset: Asset, secret: string, endpoint: string) {
  const base = endpoint.replace(/\/$/, "");
  const [txs, tipText] = await Promise.all([
    fetchJson(base + "/api/address/" + encodeURIComponent(asset.wallet_address) + "/txs"),
    fetch(base + "/api/blocks/tip/height").then(async r => { if (!r.ok) throw new Error("provider_http_" + r.status); return r.text(); }),
  ]);
  const tip = Number(tipText);
  if (!Array.isArray(txs) || !Number.isSafeInteger(tip)) throw new Error("provider_response_invalid");
  const transfers: Transfer[] = [];
  for (const tx of txs) {
    const height = Number(tx.status?.block_height ?? 0);
    const confirmations = tx.status?.confirmed && height > 0 ? Math.max(1, tip - height + 1) : 0;
    for (let i = 0; i < (tx.vout ?? []).length; i++) {
      const output = tx.vout[i];
      const address = output.scriptpubkey_address ?? output.scriptpubkey?.address ?? "";
      const amount = String(output.value ?? "");
      if (safeAddressEqual(String(address), asset.wallet_address, asset.chain_family) && /^\d+$/.test(amount) && BigInt(amount) > 0n) {
        transfers.push({ asset_code: asset.asset_code, transaction_hash: tx.txid, event_index: i, destination_address: asset.wallet_address, amount_atomic: amount, block_height: height, confirmations });
      }
    }
  }
  await ingest(URL + "/functions/v1/crypto-listener", secret, transfers);
  await markCursor(db, asset, txs[0]?.txid ?? await getCursor(db, asset.asset_code), null);
  return transfers.length;
}

async function scanEvm(db: ReturnType<typeof createClient>, asset: Asset, secret: string, endpoint: string) {
  const tip = hexNumber(await rpc(endpoint, "eth_blockNumber", []));
  if (!Number.isSafeInteger(tip) || tip < 1) throw new Error("rpc_tip_invalid");
  const saved = await getCursor(db, asset.asset_code);
  const last = saved === null ? Math.max(0, tip - 20) : Math.max(0, Number(saved) || 0);
  const from = Math.max(0, last - 15);
  const to = Math.min(tip, Math.max(from, last + 50));
  const transfers: Transfer[] = [];
  if (asset.token_contract) {
    const logs = await rpc(endpoint, "eth_getLogs", [{
      fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16),
      address: asset.token_contract,
      topics: [TRANSFER_TOPIC, null, topicAddress(asset.wallet_address)],
    }]);
    if (!Array.isArray(logs)) throw new Error("rpc_logs_invalid");
    for (const log of logs) {
      if (log.removed || !log.topics?.[2]) continue;
      const block = hexNumber(log.blockNumber);
      const amount = BigInt(log.data ?? "0x0");
      if (amount <= 0n) continue;
      transfers.push({
        asset_code: asset.asset_code, transaction_hash: String(log.transactionHash),
        event_index: hexNumber(log.logIndex), destination_address: asset.wallet_address,
        amount_atomic: amount.toString(), block_height: block, confirmations: Math.max(0, tip - block + 1),
      });
    }
  } else {
    for (let block = from; block <= to; block++) {
      const item = await rpc(endpoint, "eth_getBlockByNumber", ["0x" + block.toString(16), true]);
      if (!item || !Array.isArray(item.transactions)) throw new Error("rpc_block_invalid");
      for (const tx of item.transactions) {
        if (!tx.to || !safeAddressEqual(String(tx.to), asset.wallet_address, "evm")) continue;
        const amount = BigInt(tx.value ?? "0x0");
        if (amount <= 0n) continue;
        const receipt = await rpc(endpoint, "eth_getTransactionReceipt", [tx.hash]);
        if (!receipt || receipt.status !== "0x1") continue;
        transfers.push({
          asset_code: asset.asset_code, transaction_hash: String(tx.hash), event_index: 0,
          destination_address: asset.wallet_address, amount_atomic: amount.toString(),
          block_height: block, confirmations: Math.max(0, tip - block + 1),
        });
      }
    }
  }
  await ingest(URL + "/functions/v1/crypto-listener", secret, transfers);
  await markCursor(db, asset, String(to), null);
  return transfers.length;
}

async function scanSolana(db: ReturnType<typeof createClient>, asset: Asset, secret: string) {
  const signatures = await rpc(SOL_RPC, "getSignaturesForAddress", [asset.wallet_address, { limit: 25, commitment: "confirmed" }]);
  if (!Array.isArray(signatures)) throw new Error("solana_signatures_invalid");
  const transfers: Transfer[] = [];
  for (const item of signatures) {
    if (item.err || !item.signature) continue;
    const tx = await rpc(SOL_RPC, "getTransaction", [item.signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
    if (!tx || !tx.meta || tx.meta.err) continue;
    const keys = tx.transaction?.message?.accountKeys ?? [];
    let event = 0;
    const instructions = [...(tx.transaction?.message?.instructions ?? []), ...(tx.meta.innerInstructions ?? []).flatMap((entry: any) => entry.instructions ?? [])];
    for (const instruction of instructions) {
      const parsed = instruction.parsed;
      if (parsed?.type !== "transfer" || parsed?.info?.destination !== asset.wallet_address) continue;
      const lamports = BigInt(String(parsed.info.lamports ?? "0"));
      if (lamports <= 0n) continue;
      transfers.push({ asset_code: asset.asset_code, transaction_hash: item.signature, event_index: event++, destination_address: asset.wallet_address, amount_atomic: lamports.toString(), block_height: Number(tx.slot ?? item.slot ?? 0), confirmations: item.confirmationStatus === "finalized" ? 32 : 0 });
    }
  }
  await ingest(URL + "/functions/v1/crypto-listener", secret, transfers);
  await markCursor(db, asset, signatures[0]?.signature ?? await getCursor(db, asset.asset_code), null);
  return transfers.length;
}

async function scanTron(db: ReturnType<typeof createClient>, asset: Asset, secret: string) {
  if (!TRON_KEY) throw new Error("trongrid_api_key_missing");
  const headers = { "TRON-PRO-API-KEY": TRON_KEY };
  const base = "https://api.trongrid.io";
  const head = await fetchJson(base + "/wallet/getnowblock", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
  const tip = Number(head.block_header?.raw_data?.number ?? 0);
  if (!tip) throw new Error("tron_head_invalid");
  let rows: any[] = [];
  if (asset.token_contract) {
    const url = base + "/v1/accounts/" + encodeURIComponent(asset.wallet_address) + "/transactions/trc20?only_confirmed=true&only_to=true&limit=200&contract_address=" + encodeURIComponent(asset.token_contract);
    const result = await fetchJson(url, { headers });
    rows = result.data ?? [];
  } else {
    const url = base + "/v1/accounts/" + encodeURIComponent(asset.wallet_address) + "/transactions?only_confirmed=true&only_to=true&limit=200&order_by=block_timestamp,desc";
    const result = await fetchJson(url, { headers });
    rows = result.data ?? [];
  }
  const transfers: Transfer[] = [];
  for (const row of rows) {
    const block = Number(row.block_number ?? row.blockNumber ?? 0);
    if (!block || !row.transaction_id && !row.txID) continue;
    let amount = "0", destination = asset.wallet_address, eventIndex = 0;
    if (asset.token_contract) {
      if (String(row.token_info?.address ?? "").toLowerCase() !== asset.token_contract.toLowerCase()) continue;
      if (String(row.to ?? "") !== asset.wallet_address) continue;
      amount = String(row.value ?? "0"); eventIndex = Number(row.event_index ?? 0);
    } else {
      const contract = row.raw_data?.contract?.find((x: any) => x.type === "TransferContract");
      if (!contract) continue;
      const value = contract.parameter?.value ?? {};
      amount = String(value.amount ?? "0");
      eventIndex = Number(row.raw_data?.contract?.index ?? 0);
    }
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) continue;
    transfers.push({ asset_code: asset.asset_code, transaction_hash: String(row.transaction_id ?? row.txID), event_index: eventIndex, destination_address: destination, amount_atomic: amount, block_height: block, confirmations: Math.max(0, tip - block + 1) });
  }
  await ingest(URL + "/functions/v1/crypto-listener", secret, transfers);
  await markCursor(db, asset, rows[0]?.transaction_id ?? rows[0]?.txID ?? await getCursor(db, asset.asset_code), null);
  return transfers.length;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return response(405, { error: "method_not_allowed" });
  if (!URL || !SERVICE_KEY) return response(503, { error: "scanner_not_configured" });
  const secret = request.headers.get("x-cron-secret") ?? "";
  const db = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!(await authorized(db, secret))) return response(401, { error: "scanner_authentication_failed" });
  const { data: assets, error } = await db.from("ah_crypto_assets")
    .select("asset_code,chain_family,ticker,network,token_contract,decimals,wallet_address,confirmations_required,listener_enabled,listener_status")
    .eq("listener_enabled", true).eq("listener_status", "ready").order("asset_code");
  if (error) return response(500, { error: "asset_registry_read_failed" });
  const summary: Record<string, unknown>[] = [];
  for (const asset of (assets ?? []) as Asset[]) {
    try {
      let count = 0;
      if (asset.chain_family === "bitcoin") count = await scanUtxo(db, asset, secret, "https://mempool.space");
      else if (asset.chain_family === "litecoin") count = await scanUtxo(db, asset, secret, "https://litecoinspace.org");
      else if (asset.chain_family === "evm") count = await scanEvm(db, asset, secret, asset.asset_code === "BNB_BEP20" ? BSC_RPC : ETH_RPC);
      else if (asset.chain_family === "solana") count = await scanSolana(db, asset, secret);
      else if (asset.chain_family === "tron") count = await scanTron(db, asset, secret);
      else throw new Error("provider_not_implemented");
      summary.push({ asset_code: asset.asset_code, scanned: true, transfers: count });
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 80) : "scanner_error";
      await markCursor(db, asset, null, code);
      summary.push({ asset_code: asset.asset_code, scanned: false, error: code });
    }
  }
  return response(200, { ok: true, assets: summary.length, summary });
});
