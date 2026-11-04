import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGINS = [...new Set([...(Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((v) => v.trim()).filter(Boolean), "https://haoyunlaileha-max.github.io", "https://anonport.com", "https://www.anonport.com"])];
const ASSET_SYMBOLS: Record<string, string> = {
  BTC:"BTCUSDT", ETH:"ETHUSDT", LTC:"LTCUSDT", TRX:"TRXUSDT", SOL:"SOLUSDT",
  BNB_BEP20:"BNBUSDT", TON:"TONUSDT", USDT_ERC20:"", USDT_TRC20:"",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function reply(status:number, body:Record<string,unknown>, origin:string|null) {
  const headers=new Headers({"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Vary":"Origin"});
  if(origin && ALLOWED_ORIGINS.includes(origin)){headers.set("Access-Control-Allow-Origin",origin);headers.set("Access-Control-Allow-Headers","authorization, apikey, content-type, x-client-info");headers.set("Access-Control-Allow-Methods","POST, OPTIONS");}
  return new Response(status===204?null:JSON.stringify(body),{status,headers});
}
function scaledDecimal(value:string,scale:number):bigint {
  if(!/^\d+(?:\.\d+)?$/.test(value)) throw new Error("invalid_market_price");
  const [whole,fraction=""]=value.split(".");
  return BigInt(whole)*10n**BigInt(scale)+BigInt((fraction+"0".repeat(scale)).slice(0,scale));
}
function formatAtomic(value:string,decimals:number):string {
  const raw=BigInt(value),unit=10n**BigInt(decimals),whole=raw/unit;
  const fraction=(raw%unit).toString().padStart(decimals,"0").replace(/0+$/,"");
  return fraction?whole.toString()+"."+fraction:whole.toString();
}
async function marketPrice(symbol:string):Promise<string> {
  const response=await fetch("https://api.binance.com/api/v3/ticker/price?symbol="+encodeURIComponent(symbol),{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(7000)});
  if(!response.ok) throw new Error("market_rate_unavailable");
  const data=await response.json();
  if(typeof data?.price!=="string") throw new Error("market_rate_unavailable");
  return data.price;
}
Deno.serve(async(request:Request)=>{
  const origin=request.headers.get("origin");
  if(request.method==="OPTIONS") return (!origin||!ALLOWED_ORIGINS.includes(origin))?reply(403,{error:"origin_not_allowed"},null):reply(204,{},origin);
  if(request.method!=="POST") return reply(405,{error:"method_not_allowed"},origin);
  if(!origin||!ALLOWED_ORIGINS.includes(origin)) return reply(403,{error:"origin_not_allowed"},null);
  if(!SUPABASE_URL||!SUPABASE_ANON_KEY||!SUPABASE_SERVICE_ROLE_KEY) return reply(503,{error:"server_not_configured"},origin);
  if(!(request.headers.get("content-type")||"").toLowerCase().includes("application/json")) return reply(415,{error:"application_json_required"},origin);
  const token=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token||token.length>8192) return reply(401,{error:"authentication_required"},origin);
  let body:Record<string,unknown>;
  try {
    const reader=request.body?.getReader(); if(!reader) return reply(400,{error:"invalid_json"},origin);
    const chunks:Uint8Array[]=[]; let bytes=0;
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8192){await reader.cancel();return reply(413,{error:"request_too_large"},origin);}chunks.push(value);}
    const all=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}
    const parsed:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(all));
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)) return reply(400,{error:"invalid_request_body"},origin);
    body=parsed as Record<string,unknown>;
    if(Object.keys(body).some((key)=>!["order_id","asset_code"].includes(key))) return reply(400,{error:"unexpected_request_field"},origin);
  } catch{return reply(400,{error:"invalid_json"},origin);}
  const orderId=body.order_id,assetCode=body.asset_code;
  if(typeof orderId!=="string"||!UUID.test(orderId)||typeof assetCode!=="string"||!Object.hasOwn(ASSET_SYMBOLS,assetCode)) return reply(400,{error:"invalid_order_or_asset"},origin);
  try{
    const auth=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:authError}=await auth.auth.getUser(token);
    if(authError||!userData.user) return reply(401,{error:"invalid_or_expired_session"},origin);
    const admin=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const [{data:order,error:orderError},{data:asset,error:assetError}]=await Promise.all([
      admin.from("ah_orders").select("id,user_id,status,currency,total_minor,expires_at").eq("id",orderId).eq("user_id",userData.user.id).maybeSingle(),
      admin.from("ah_crypto_assets").select("asset_code,ticker,network,token_contract,decimals,wallet_address,listener_enabled,listener_status").eq("asset_code",assetCode).maybeSingle(),
    ]);
    if(orderError||!order) return reply(404,{error:"order_not_found"},origin);
    if(assetError||!asset) return reply(404,{error:"asset_not_found"},origin);
    if(order.currency!=="USDT"||!Number.isSafeInteger(order.total_minor)||order.total_minor<=0) return reply(409,{error:"order_must_be_priced_in_usdt"},origin);
    if(!["pending","awaiting_payment"].includes(order.status)) return reply(409,{error:"order_not_payable"},origin);
    // Never issue an address while its chain listener is offline: funds could otherwise be lost or uncredited.
    if(!asset.listener_enabled||asset.listener_status!=="ready") return reply(503,{error:"asset_monitoring_unavailable",asset:assetCode,monitoring:asset.listener_status},origin);
    const symbol=ASSET_SYMBOLS[assetCode],priceText=symbol?await marketPrice(symbol):"1";
    const priceScale=12,priceScaled=scaledDecimal(priceText,priceScale),decimals=Number(asset.decimals);
    const usdtMinor=BigInt(order.total_minor);
    const numerator=usdtMinor*(10n**BigInt(decimals))*(10n**BigInt(priceScale));
    const denominator=100n*priceScaled;
    const baseAtomic=(numerator+denominator-1n)/denominator;
    if(baseAtomic<=0n) return reply(422,{error:"quote_below_asset_precision"},origin);
    const orderExpiry=Date.parse(order.expires_at);
    if(!Number.isFinite(orderExpiry)||orderExpiry<=Date.now()) return reply(409,{error:"order_expired"},origin);
    const expiresAt=new Date(Math.min(Date.now()+30*60*1000,orderExpiry)).toISOString();
    const {data:depositId,error:invoiceError}=await admin.rpc("ah_create_crypto_invoice",{
      p_user_id:userData.user.id,p_order_id:orderId,p_asset_code:assetCode,p_base_amount_atomic:baseAtomic.toString(),
      p_quoted_usdt_minor:order.total_minor,p_quote_price_usdt:priceText,p_expires_at:expiresAt,
    });
    if(invoiceError||!depositId){if(invoiceError?.message?.includes("order_not_payable"))return reply(409,{error:"order_not_payable"},origin);return reply(500,{error:"invoice_creation_failed"},origin);}
    const {data:deposit,error:depositError}=await admin.from("ah_crypto_deposits").select("id,expected_amount_atomic,expires_at,quote_expires_at,quoted_usdt_minor,quote_price_usdt,status").eq("id",depositId).single();
    if(depositError||!deposit)return reply(500,{error:"invoice_lookup_failed"},origin);
    return reply(201,{invoice:{id:deposit.id,order_id:order.id,order_expires_at:order.expires_at,asset_code:asset.asset_code,ticker:asset.ticker,network:asset.network,wallet_address:asset.wallet_address,expected_amount_atomic:deposit.expected_amount_atomic,expected_amount:formatAtomic(String(deposit.expected_amount_atomic),decimals),decimals,quoted_usdt:(Number(deposit.quoted_usdt_minor)/100).toFixed(2),price_usdt:String(deposit.quote_price_usdt),expires_at:deposit.expires_at,quote_expires_at:deposit.quote_expires_at,status:deposit.status}},origin);
  }catch(error){const message=error instanceof Error?error.message:"";if(message==="market_rate_unavailable"||message==="invalid_market_price")return reply(503,{error:"market_rate_unavailable"},origin);return reply(500,{error:"internal_server_error"},origin);}
});