import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createSupabaseContext } from "npm:@supabase/server";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
const INTERNAL_SECRET = Deno.env.get("CRYPTO_LISTENER_INTERNAL_SECRET") ?? "";

function json(status:number,body:Record<string,unknown>) {
  return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
function safeEqual(a:string,b:string):boolean {
  if(!a||!b||a.length!==b.length) return false;
  let diff=0;
  for(let i=0;i<a.length;i++) diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
function esc(value:unknown):string {
  return String(value??"—").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}
function amount(atomic:string,decimals:number):string {
  const raw=BigInt(atomic),unit=10n**BigInt(decimals);
  const fraction=(raw%unit).toString().padStart(decimals,"0").replace(/0+$/,"");
  return (raw/unit).toString()+(fraction?"."+fraction:"");
}
const ASSET_DECIMALS:Record<string,number>={BTC:8,ETH:18,USDT_ERC20:6,USDT_TRC20:6,LTC:8,TRX:6,SOL:9,BNB_BEP20:18,TON:9};
const ASSET_LABELS:Record<string,string>={BTC:"BTC · Bitcoin",ETH:"ETH · Ethereum",USDT_ERC20:"USDT · ERC-20",USDT_TRC20:"USDT · TRC-20",LTC:"LTC · Litecoin",TRX:"TRX · TRON",SOL:"SOL · Solana",BNB_BEP20:"BNB · BNB Smart Chain",TON:"GRAM · TON"};
const EVENT_LABELS:Record<string,string>={detected:"检测到链上转账",confirming:"正在等待区块确认",confirmed:"到账已确认",underpaid:"到账金额不足",overpaid:"到账金额超额",manual_review:"需要人工核查",expired:"收款订单已过期"};
async function telegramSend(text:string):Promise<void> {
  if(!TELEGRAM_BOT_TOKEN||!TELEGRAM_CHAT_ID) throw new Error("telegram_secrets_missing");
  const response=await fetch("https://api.telegram.org/bot"+TELEGRAM_BOT_TOKEN+"/sendMessage",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({chat_id:TELEGRAM_CHAT_ID,text,parse_mode:"HTML",disable_web_page_preview:true}),
    signal:AbortSignal.timeout(10000),
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||result?.ok!==true) throw new Error("telegram_api_error_"+String(result?.error_code??response.status));
}
function renderNotification(payload:Record<string,unknown>):string {
  const asset=String(payload.asset_code??"");
  const decimals=ASSET_DECIMALS[asset]??0;
  const event=String(payload.status??"");
  const received=amount(String(payload.received_amount_atomic??"0"),decimals);
  const expected=amount(String(payload.expected_amount_atomic??"0"),decimals);
  const tx=String(payload.transaction_hash??"");
  const txLine=tx?("\n交易哈希：<code>"+esc(tx)+"</code>"):"";
  const title=EVENT_LABELS[event]??"链上收款状态更新";
  const stamp=String(payload.occurred_at??new Date().toISOString());
  return "🔔 <b>"+esc(title)+"</b>\n"+
    "资产网络："+esc(ASSET_LABELS[asset]??asset)+"\n"+
    "订单号：<code>"+esc(payload.order_id)+"</code>\n"+
    "应付金额："+esc(expected)+"\n"+
    "已检测金额："+esc(received)+
    txLine+"\n状态："+esc(event)+"\n时间："+esc(stamp);
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST") return json(405,{error:"method_not_allowed"});
  if(!SUPABASE_URL||!SERVICE_ROLE_KEY) return json(503,{error:"database_not_configured"});
  if(!TELEGRAM_BOT_TOKEN||!TELEGRAM_CHAT_ID) return json(503,{error:"telegram_secrets_missing"});
  let body:Record<string,unknown>;
  try { body=await req.json(); if(!body||typeof body!=="object"||Array.isArray(body)) throw new Error(); }
  catch { return json(400,{error:"invalid_json"}); }
  const hasInternalSecret=!!INTERNAL_SECRET&&safeEqual(req.headers.get("x-listener-secret")??"",INTERNAL_SECRET);
  if(!hasInternalSecret) {
    if(body.action!=="dispatch") return json(401,{error:"unauthorized"});
    const {data:context,error:authError}=await createSupabaseContext(req,{auth:"publishable"});
    if(authError||!context) return json(401,{error:"unauthorized"});
  }
  const admin=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  if(body.action==="test") {
    if(!hasInternalSecret) return json(401,{error:"unauthorized"});
    try { await telegramSend("✅ <b>加密货币收款机器人连接成功</b>\nTelegram 通知通道已连通。后续链上检测、确认及异常状态将发送到此会话。"); return json(200,{ok:true,message:"test_message_sent"}); }
    catch(error) { return json(502,{error:error instanceof Error?error.message:"telegram_send_failed"}); }
  }
  if(body.action!=="dispatch") return json(400,{error:"unsupported_action"});
  const batch=Number.isInteger(body.limit)?Math.max(1,Math.min(50,Number(body.limit))):20;
  const {data:items,error}=await admin.rpc("ah_claim_crypto_telegram_notifications",{p_limit:batch});
  if(error) return json(500,{error:"notification_claim_failed"});
  let delivered=0,failed=0;
  for(const item of (items??[]) as Array<{id:string;payload:Record<string,unknown>;attempts:number}>) {
    try {
      await telegramSend(renderNotification(item.payload));
      const result=await admin.rpc("ah_finish_crypto_telegram_notification",{p_id:item.id,p_success:true,p_error:null});
      if(result.error) throw new Error("outbox_ack_failed");
      delivered++;
    } catch(error) {
      failed++;
      const reason=error instanceof Error?error.message:"telegram_delivery_failed";
      await admin.rpc("ah_finish_crypto_telegram_notification",{p_id:item.id,p_success:false,p_error:reason});
    }
  }
  return json(200,{ok:true,claimed:(items??[]).length,delivered,failed});
});