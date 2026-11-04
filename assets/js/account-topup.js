const config=window.AH_SUPABASE_CONFIG||{};
const amountSelect=document.getElementById("topup-amount");
const assetSelect=document.getElementById("topup-method");
const submitButton=document.getElementById("topup-submit");
const invoicePanel=document.getElementById("topup-invoice");
const balanceValue=document.getElementById("account-balance-value");
const balanceState=document.getElementById("account-balance-state");
const historyPanel=document.getElementById("topup-history");
const refreshButton=document.getElementById("topup-refresh");
const previewPanel=document.querySelector(".topup-preview");
if(previewPanel&&invoicePanel)previewPanel.insertBefore(invoicePanel,previewPanel.firstChild);
let client=null,session=null,assets=[],pendingKey=null,pendingOrderId=null,pendingAmountMinor=null,busy=false,currentBalanceMinor=0n;
const amountOptions=document.getElementById("topup-amount-options");
const continueLabel="继续";
function dollars(minor){return "$"+(Number(minor)/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});}
const BONUS_BY_AMOUNT=new Map([[3000,0],[10000,2500],[25000,7500],[50000,20000],[100000,50000],[200000,200000]]);
const customInput=document.getElementById("topup-custom-amount");
let customMode=false;
function selectedBonus(amount){return BONUS_BY_AMOUNT.get(amount)||0;}
function setAmount(amount,custom=false){
  const amountValue=String(amount);
  if(!Array.from(amountSelect.options).some(option=>option.value===amountValue)){
    amountSelect.add(new Option(amountValue+" USDT",amountValue));
  }
  amountSelect.value=amountValue;
  customMode=custom;
  updateTopupPreview();
}
function updateTopupPreview(){
  const amount=Number(amountSelect.value)||3000;
  const bonus=customMode?0:selectedBonus(amount);
  const current=currentBalanceMinor;
  text(document.getElementById("topup-preview-current"),dollars(current));
  text(document.getElementById("topup-preview-add"),dollars(amount));
  text(document.getElementById("topup-preview-bonus"),dollars(bonus));
  text(document.getElementById("topup-preview-total"),dollars(current+BigInt(amount+bonus)));
  text(submitButton,"继续");
  amountOptions?.querySelectorAll("[data-amount]").forEach(button=>{
    const selected=!customMode&&Number(button.dataset.amount)===amount;
    button.classList.toggle("selected",selected);
    button.setAttribute("aria-pressed",String(selected));
  });
  customInput?.closest(".topup-custom-wrap")?.classList.toggle("active",customMode);
}
amountOptions?.addEventListener("click",event=>{
  const button=event.target.closest("[data-amount]");
  if(!button||amountSelect.disabled||busy)return;
  if(customInput)customInput.value="";
  setAmount(Number(button.dataset.amount),false);
});
function applyCustomAmount(){
  if(!customInput||amountSelect.disabled||busy)return;
  let value=Number(customInput.value);
  if(!Number.isFinite(value)||value<=0)value=30;
  if(value<30)value=30;
  value=Math.round(value*100)/100;
  customInput.value=value.toFixed(2);
  const minor=Math.round(value*100);
  if(!Number.isSafeInteger(minor)||minor<3000){customInput.value="30.00";setAmount(3000,true);return;}
  if(![3000,10000,25000,50000,100000,200000].includes(minor))setAmount(minor,true);
  else setAmount(minor,true);
}
customInput?.addEventListener("focus",()=>{if(!customMode)customInput.value="";});
customInput?.addEventListener("change",applyCustomAmount);
customInput?.addEventListener("blur",()=>{if(customInput.value.trim())applyCustomAmount();});
customInput?.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();applyCustomAmount();}});
amountSelect.addEventListener("change",updateTopupPreview);
assetSelect.addEventListener("change",renderAssetPicker);

function money(minor){return (Number(minor)/100).toFixed(2)+" USDT";}
function text(node,value){if(node)node.textContent=value;}
function showInvoiceError(value){invoicePanel.hidden=false;invoicePanel.replaceChildren();const p=document.createElement("p");p.textContent=value;invoicePanel.append(p);}
async function api(path,body){
  const current=session;
  if(!current?.access_token)throw new Error("请先登录后再充值。");
  const response=await fetch(config.url.replace(/\/$/,"")+"/functions/v1/"+path,{
    method:"POST",headers:{"Content-Type":"application/json",apikey:config.anonKey,Authorization:"Bearer "+current.access_token},
    body:JSON.stringify(body),cache:"no-store"
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||"充值服务暂时不可用，请稍后重试。");
  return result;
}
const ASSET_LOGOS={USDT:"usdt",BTC:"btc",ETH:"eth",BNB:"bnb",LTC:"ltc",SOL:"sol",TON:"ton",TRX:"trx"};
const ASSET_ORDER=["USDT_TRC20","USDT_ERC20"];
let assetPicker=null;
function assetLogo(ticker){
  const key=ASSET_LOGOS[ticker]||String(ticker||"").toLowerCase();
  const img=document.createElement("img");
  img.className="topup-asset-logo";img.alt="";img.loading="lazy";
  img.src="https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/"+key+".png";
  img.onerror=()=>{const fallback=document.createElement("span");fallback.className="topup-asset-logo-fallback";fallback.textContent=String(ticker||"?").slice(0,4);img.replaceWith(fallback);};
  return img;
}
function assetLabel(asset){
  if(asset.asset_code==="TON")return "TON · GRAM";
  return asset.ticker+" · "+asset.network;
}
function renderAssetPicker(){
  if(!assetPicker){
    assetPicker=document.createElement("div");assetPicker.className="topup-asset-picker";
    const trigger=document.createElement("button");trigger.type="button";trigger.className="topup-asset-trigger";trigger.setAttribute("aria-haspopup","listbox");trigger.setAttribute("aria-expanded","false");
    const menu=document.createElement("div");menu.className="topup-asset-menu";menu.setAttribute("role","listbox");menu.hidden=true;
    trigger.addEventListener("click",()=>{if(assetSelect.disabled)return;const open=menu.hidden;menu.hidden=!open;trigger.setAttribute("aria-expanded",String(open));});
    assetPicker.append(trigger,menu);assetSelect.insertAdjacentElement("afterend",assetPicker);
    assetSelect.classList.add("topup-native-select-hidden");
  }
  const trigger=assetPicker.querySelector(".topup-asset-trigger"),menu=assetPicker.querySelector(".topup-asset-menu");
  trigger.replaceChildren();
  const selected=assets.find(a=>a.asset_code===assetSelect.value);
  if(selected){trigger.append(assetLogo(selected.ticker));const label=document.createElement("span");label.textContent=assetLabel(selected);trigger.append(label);}
  else{const label=document.createElement("span");label.textContent=assets.length?"选择支付方式":"当前没有可用收款网络";trigger.append(label);}
  const arrow=document.createElement("span");arrow.className="topup-asset-chevron";arrow.textContent="⌄";trigger.append(arrow);
  trigger.disabled=assetSelect.disabled;
  menu.replaceChildren();
  assets.forEach(asset=>{
    const option=document.createElement("button");option.type="button";option.className="topup-asset-option";option.setAttribute("role","option");option.setAttribute("aria-selected",String(asset.asset_code===assetSelect.value));
    option.append(assetLogo(asset.ticker));const label=document.createElement("span");label.textContent=assetLabel(asset);option.append(label);
    if(asset.asset_code===assetSelect.value){const check=document.createElement("span");check.className="topup-asset-check";check.textContent="✓";option.append(check);}
    option.addEventListener("click",()=>{assetSelect.value=asset.asset_code;assetSelect.dispatchEvent(new Event("change",{bubbles:true}));menu.hidden=true;trigger.setAttribute("aria-expanded","false");renderAssetPicker();});
    menu.append(option);
  });
}
document.addEventListener("click",event=>{if(assetPicker&&!assetPicker.contains(event.target)){const menu=assetPicker.querySelector(".topup-asset-menu");menu.hidden=true;assetPicker.querySelector(".topup-asset-trigger").setAttribute("aria-expanded","false");}});
async function loadAssets(){
  assetSelect.disabled=true;submitButton.disabled=true;
  assetSelect.replaceChildren(new Option("正在加载可用收款网络…",""));
  renderAssetPicker();
  try{
    const result=await api("create-account-topup",{action:"assets"});
    const returned=Array.isArray(result.assets)?result.assets:[];
    assets=returned.sort((a,b)=>{const ai=ASSET_ORDER.indexOf(a.asset_code),bi=ASSET_ORDER.indexOf(b.asset_code);return (ai<0?999:ai)-(bi<0?999:bi);});
    assetSelect.replaceChildren();
    for(const asset of assets)assetSelect.add(new Option(assetLabel(asset),asset.asset_code));
    if(assets.length)assetSelect.value=assets[0].asset_code;
    if(!assets.length)assetSelect.add(new Option("当前没有可用收款网络",""));
    assetSelect.disabled=!assets.length;submitButton.disabled=!assets.length;
    renderAssetPicker();
  }catch(error){
    assetSelect.replaceChildren(new Option("收款网络加载失败，请刷新重试",""));
    assetSelect.disabled=true;renderAssetPicker();showInvoiceError(error.message);
  }
}
async function refreshBalance(options={}){
  if(!client||!session?.user?.id){
    if(options.manual)throw new Error("登录状态已失效，请重新登录后刷新充值记录。");
    return false;
  }
  const userId=session.user.id;
  text(balanceState,"正在同步余额与充值状态…");
  try{
    const [ledger,topups]=await Promise.all([
      client.from("ah_account_ledger").select("amount_minor").eq("user_id",userId),
      client.from("ah_account_topups").select("id,order_id,amount_minor,bonus_minor,status,created_at,credited_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(12)
    ]);
    if(ledger.error)throw ledger.error;
    if(topups.error)throw topups.error;
    const orderIds=(topups.data||[]).map(item=>item.order_id).filter(Boolean);
    const [orders,deposits]=orderIds.length?await Promise.all([
      client.from("ah_orders").select("id,status,expires_at").in("id",orderIds),
      client.from("ah_crypto_deposits").select("order_id,status,received_amount_atomic,expected_amount_atomic,expires_at,transaction_hash").in("order_id",orderIds).order("created_at",{ascending:false})
    ]):[{data:[],error:null},{data:[],error:null}];
    if(orders.error)throw orders.error;
    if(deposits.error)throw deposits.error;
    const orderById=new Map((orders.data||[]).map(row=>[row.id,row]));
    const depositByOrder=new Map();
    for(const row of deposits.data||[])if(!depositByOrder.has(row.order_id))depositByOrder.set(row.order_id,row);
    const total=(ledger.data||[]).reduce((sum,row)=>sum+BigInt(String(row.amount_minor)),0n);
    currentBalanceMinor=total;updateTopupPreview();
    text(balanceValue,(total/100n).toString()+"."+(total%100n).toString().padStart(2,"0")+" USDT");
    text(balanceState,"余额仅在链上交易达到所需确认数后自动入账。");
    historyPanel.replaceChildren();
    if(!topups.data?.length){const empty=document.createElement("div");empty.className="account-notice";empty.textContent="暂无充值记录。创建充值订单后，状态会显示在这里。";historyPanel.append(empty);return;}
    for(const item of topups.data){
      const row=document.createElement("div");row.className="topup-history-row";
      const left=document.createElement("div"),amount=document.createElement("strong"),meta=document.createElement("small");
      amount.textContent=money(item.amount_minor)+(Number(item.bonus_minor)>0?" + 赠送 "+money(item.bonus_minor):"");meta.textContent="创建时间："+new Date(item.created_at).toLocaleString("zh-CN");left.append(amount,meta);
      const order=orderById.get(item.order_id),deposit=depositByOrder.get(item.order_id);
      const effectiveStatus=item.status==="credited"?"credited":
        item.status==="manual_review"||deposit?.status==="manual_review"||deposit?.status==="overpaid"?"manual_review":
        deposit?.status==="confirmed"?"confirmed":
        deposit?.status==="confirming"?"confirming":
        order?.status==="cancelled"||order?.status==="expired"||((order?.expires_at||deposit?.expires_at)&&Date.parse(order?.expires_at||deposit?.expires_at)<=Date.now())?"expired":
        item.status;
      const status=document.createElement("span");status.className="topup-status"+(["credited","confirmed"].includes(effectiveStatus)?" credited":"");
      status.textContent=effectiveStatus==="credited"?"已入账":effectiveStatus==="confirmed"?"链上已确认，入账处理中":effectiveStatus==="confirming"?"链上确认中":effectiveStatus==="manual_review"?"人工核验中":effectiveStatus==="expired"?"订单已关闭":"等待付款";
      if(item.credited_at){const date=document.createElement("small");date.textContent="入账时间："+new Date(item.credited_at).toLocaleString("zh-CN");left.append(date);}
      row.append(left,status);historyPanel.append(row);
    }
    return true;
  }catch(error){
    text(balanceState,"余额或充值记录暂时无法加载："+(error?.message||"请稍后刷新。"));
    if(options.manual)throw error;
    return false;
  }
}
let refreshInProgress=false;
async function handleRefreshClick(){
  if(refreshInProgress)return;
  refreshInProgress=true;
  const originalLabel=refreshButton?.textContent||"刷新状态";
  if(refreshButton){refreshButton.disabled=true;refreshButton.textContent="正在刷新…";refreshButton.setAttribute("aria-busy","true");}
  try{
    if(!client)throw new Error("账户服务尚未初始化，请刷新页面重试。");
    const {data,error}=await client.auth.getSession();
    if(error)throw error;
    session=data.session;
    if(!session?.user?.id)throw new Error("登录状态已失效，请重新登录后刷新充值记录。");
    await refreshBalance({manual:true});
    if(refreshButton)refreshButton.textContent="已更新";
  }catch(error){
    text(balanceState,error?.message||"刷新失败，请稍后重试。");
    if(refreshButton)refreshButton.textContent="刷新失败";
  }finally{
    refreshInProgress=false;
    if(refreshButton){refreshButton.disabled=false;refreshButton.removeAttribute("aria-busy");}
    window.setTimeout(()=>{if(refreshButton&&!refreshInProgress)refreshButton.textContent=originalLabel;},1800);
  }
}
async function invoiceCard(invoice,amountMinor,bonusMinor){
  invoicePanel.replaceChildren();invoicePanel.hidden=false;
  const title=document.createElement("strong");title.textContent="充值订单已创建，请按以下信息付款";
  const amount=document.createElement("p");amount.textContent="精确应付："+invoice.expected_amount+" "+invoice.ticker;
  const network=document.createElement("p");network.textContent="网络："+invoice.network;
  const quote=document.createElement("p");quote.textContent="账户入账金额："+money(amountMinor+bonusMinor)+"（充值 "+money(amountMinor)+" + 奖励 "+money(bonusMinor)+"）";
  const addressLabel=document.createElement("p");addressLabel.textContent="收款地址：";
  const qrWrap=document.createElement("div");qrWrap.className="topup-qr-wrap";
  const qrLabel=document.createElement("p");qrLabel.textContent="扫描二维码支付";
  const qrImage=document.createElement("img");qrImage.className="topup-qr-image";qrImage.alt="收款地址二维码";qrImage.width=220;qrImage.height=220;
  try{const QR=await import("https://esm.sh/qrcode@1.5.4");qrImage.src=await (QR.default||QR).toDataURL(invoice.wallet_address,{width:220,margin:2,errorCorrectionLevel:"M"});qrWrap.append(qrLabel,qrImage);}catch{qrWrap.textContent="二维码暂时无法生成，请复制收款地址支付。";}
  const address=document.createElement("code");address.className="topup-address";address.textContent=invoice.wallet_address;
  const expires=document.createElement("p");expires.textContent="付款报价有效期至："+new Date(invoice.expires_at).toLocaleString("zh-CN");
  const warning=document.createElement("p");warning.textContent="请使用指定网络并支付精确金额。转错网络、少付或过期转账可能需要人工核验。";
  const copy=document.createElement("button");copy.type="button";copy.className="btn btn-ghost topup-copy-address";copy.textContent="一键复制地址";
  copy.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(invoice.wallet_address);copy.textContent="已复制";}catch{copy.textContent="复制失败，请手动复制地址";}});
  const order=document.createElement("small");order.textContent="充值订单："+invoice.order_id;
  invoicePanel.append(title,amount,network,quote,qrWrap,addressLabel,address,copy,expires,warning,order);
}
async function submitTopup(){
  if(busy||!session)return;
  if(customMode)applyCustomAmount();
  const amount=Number(amountSelect.value),assetCode=assetSelect.value;
  if(!Number.isSafeInteger(amount)||!assetCode){showInvoiceError("请选择充值金额和可用收款网络。");return;}
  busy=true;submitButton.disabled=true;submitButton.textContent="正在创建充值订单…";
  try{
    if(!pendingOrderId){
      if(!pendingKey)pendingKey=crypto.randomUUID();
      const created=await api("create-account-topup",{action:"create",amount_minor:amount,bonus_eligible:!customMode,idempotency_key:pendingKey});
      pendingOrderId=created.order_id;
      pendingAmountMinor=amount;
      amountSelect.disabled=true;if(customInput)customInput.disabled=true;
    }
    if(pendingAmountMinor!==amount)throw new Error("当前充值订单金额已锁定，请完成该订单或刷新充值页面后再创建新订单。");
    submitButton.textContent="正在生成链上收款信息…";
    const result=await api("create-crypto-invoice",{order_id:pendingOrderId,asset_code:assetCode});
    await invoiceCard(result.invoice,amount,customMode?0:selectedBonus(amount));
    pendingKey=null;pendingOrderId=null;pendingAmountMinor=null;amountSelect.disabled=false;
    await refreshBalance();
  }catch(error){
    showInvoiceError(error.message==="topup_creation_failed"?(error.message+"（服务器创建订单失败，请稍后重试）"):error.message==="topup_order_expired"?"原充值订单已过期，请重新点击继续创建新订单。":error.message==="asset_monitoring_unavailable"?"该收款网络暂不可用，系统已阻止生成付款地址。":error.message==="market_rate_unavailable"?"暂时无法取得可靠实时汇率，请稍后重试。":error.message==="asset_contract_unverified"?"该代币合约尚未核验，暂不开放收款。":error.message);
  }finally{
    busy=false;submitButton.disabled=!assets.length;amountSelect.disabled=Boolean(pendingOrderId);if(customInput)customInput.disabled=Boolean(pendingOrderId);submitButton.textContent=pendingOrderId?"继续生成此金额的收款信息":"继续";
  }
}
async function start(){
  if(!config.url||!config.anonKey||!window.AH_SUPABASE_READY)return;
  try{
    client=await window.AH_SUPABASE_READY;
    if(!client)return;
    const {data}=await client.auth.getSession();session=data.session;
    if(session){await loadAssets();await refreshBalance();updateTopupPreview();}
    client.auth.onAuthStateChange((_event,next)=>{queueMicrotask(async()=>{
      session=next;
      if(session){await loadAssets();await refreshBalance();}
      else{assets=[];pendingKey=null;pendingOrderId=null;pendingAmountMinor=null;amountSelect.disabled=false;if(customInput)customInput.disabled=false;assetSelect.replaceChildren(new Option("登录后加载可用网络",""));assetSelect.disabled=true;renderAssetPicker();submitButton.disabled=true;text(balanceValue,"0.00 USDT");text(balanceState,"登录后查看账户余额。");historyPanel.replaceChildren();}
    });});
    window.setInterval(()=>{if(session&&document.visibilityState==="visible")refreshBalance();},30000);
    document.addEventListener("visibilitychange",()=>{if(session&&document.visibilityState==="visible")refreshBalance();});
  }catch{ text(balanceState,"账户充值服务初始化失败，请刷新页面重试。"); }
}
updateTopupPreview();
submitButton.addEventListener("click",submitTopup);
refreshButton?.addEventListener("click",handleRefreshClick);
start();
