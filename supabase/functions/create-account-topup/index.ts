import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const configuredOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map(v => v.trim()).filter(Boolean);
const ALLOWED_ORIGINS = new Set([...configuredOrigins,"https://haoyunlaileha-max.github.io","https://anonport.com","https://www.anonport.com"]);
const MIN_AMOUNT_MINOR = 3000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(status:number,body:Record<string,unknown>,origin:string|null) {
  const headers = new Headers({"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Vary":"Origin"});
  if(origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin",origin);
    headers.set("Access-Control-Allow-Headers","authorization, apikey, content-type, x-client-info");
    headers.set("Access-Control-Allow-Methods","POST, OPTIONS");
  }
  return new Response(status===204?null:JSON.stringify(body),{status,headers});
}

Deno.serve(async(request:Request)=>{
  const origin=request.headers.get("origin");
  if(request.method==="OPTIONS") return (!origin||!ALLOWED_ORIGINS.has(origin))?reply(403,{error:"origin_not_allowed"},null):reply(204,{},origin);
  if(request.method!=="POST") return reply(405,{error:"method_not_allowed"},origin);
  if(!origin||!ALLOWED_ORIGINS.has(origin)) return reply(403,{error:"origin_not_allowed"},null);
  if(!URL||!ANON_KEY||!SERVICE_KEY) return reply(503,{error:"server_not_configured"},origin);
  if(!(request.headers.get("content-type")??"").toLowerCase().includes("application/json")) return reply(415,{error:"application_json_required"},origin);
  const token=(request.headers.get("authorization")??"").match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token||token.length>8192) return reply(401,{error:"authentication_required"},origin);
  let body:Record<string,unknown>;
  try {
    const reader=request.body?.getReader(); if(!reader) return reply(400,{error:"invalid_json"},origin);
    const chunks:Uint8Array[]=[];let bytes=0;
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4096){await reader.cancel();return reply(413,{error:"request_too_large"},origin);}chunks.push(value);}
    const all=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}
    const parsed:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(all));
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return reply(400,{error:"invalid_request_body"},origin);
    body=parsed as Record<string,unknown>;
  } catch{return reply(400,{error:"invalid_json"},origin);}
  const action=body.action;
  if(action==="assets") {
    if(Object.keys(body).length!==1)return reply(400,{error:"unexpected_request_field"},origin);
  } else if(action==="create") {
    if(Object.keys(body).some(k=>!["action","amount_minor","bonus_eligible","idempotency_key"].includes(k)))return reply(400,{error:"unexpected_request_field"},origin);
  } else return reply(400,{error:"invalid_action"},origin);
  try {
    const auth=createClient(URL,ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:authError}=await auth.auth.getUser(token);
    if(authError||!userData.user)return reply(401,{error:"invalid_or_expired_session"},origin);
    const admin=createClient(URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    if(action==="assets") {
      const {data,error}=await admin.from("ah_crypto_assets")
        .select("asset_code,ticker,network,listener_enabled,listener_status")
        .eq("listener_enabled",true).eq("listener_status","ready").order("asset_code");
      if(error)return reply(500,{error:"asset_list_unavailable"},origin);
      return reply(200,{assets:(data??[]).map(a=>({asset_code:a.asset_code,ticker:a.ticker,network:a.network}))},origin);
    }
    const amount=body.amount_minor;
    const key=body.idempotency_key;
    if(typeof amount!=="number"||!Number.isSafeInteger(amount)||amount<MIN_AMOUNT_MINOR||typeof body.bonus_eligible!=="boolean"||typeof key!=="string"||!UUID.test(key)) {
      return reply(400,{error:"invalid_topup_request"},origin);
    }
    const {data:orderId,error}=await admin.rpc("ah_create_account_topup",{
      p_user_id:userData.user.id,p_amount_minor:amount,p_bonus_eligible:body.bonus_eligible,p_idempotency_key:"topup:"+key
    });
    if(error||!orderId){console.error("account_topup_rpc_failed",{code:error?.code,message:error?.message});const reason=error?.message==="topup_idempotency_conflict"?"topup_idempotency_conflict":error?.message==="topup_order_expired"?"topup_order_expired":error?.message==="invalid_topup_request"?"invalid_topup_request":"topup_creation_failed";return reply(reason==="topup_idempotency_conflict"||reason==="topup_order_expired"?409:500,{error:reason},origin);}
    return reply(201,{order_id:orderId,amount_minor:amount,currency:"USDT"},origin);
  } catch {
    return reply(500,{error:"internal_server_error"},origin);
  }
});
