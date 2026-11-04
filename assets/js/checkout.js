(() => {
  "use strict";

  const config = window.AH_SUPABASE_CONFIG || {};
  const planList = document.getElementById("plan-list");
  const regionSelect = document.getElementById("config-region");
  const form = document.getElementById("configure-form");
  const summary = document.getElementById("config-summary");
  const dialog = document.getElementById("configure-dialog");
  const submitButton = form.querySelector('[type="submit"]');
  const categoryMap = {
    linux_vps: "vps",
    dedicated_server: "dedicated",
    windows_rdp: "rdp",
    gpu: "gpu",
    domain: "domains"
  };
  const pageCategory = document.body.dataset.productCategory || "";
  let client = null;
  let selectedPlan = null;
  let activeRegions = [];
  let availableMappings = [];

  function money(minor, currency) {
    try {
      return new Intl.NumberFormat(document.documentElement.lang || "zh-CN", {
        style: "currency",
        currency
      }).format(Number(minor) / 100);
    } catch {
      return (Number(minor) / 100).toFixed(2) + " " + currency;
    }
  }

  function period(value) {
    return ({
      hourly: "小时",
      monthly: "月",
      quarterly: "季度",
      annually: "年",
      one_time: "一次性"
    })[value] || value;
  }

  function appendText(parent, tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = String(value ?? "");
    parent.append(node);
    return node;
  }

  function renderPlans(products, mappings) {
    const storageClient = client;
    availableMappings = mappings || [];
    const sellablePlanIds = new Set(availableMappings.map((mapping) => mapping.plan_id));
    const plans = products.flatMap((product) => (product.ah_plans || [])
      .filter((plan) => plan.is_active !== false && sellablePlanIds.has(plan.id) && (!pageCategory || categoryMap[product.category] === pageCategory))
      .map((plan) => ({ ...plan, product })))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

    if (!plans.length) {
      planList.replaceChildren();
      appendText(planList, "p", "sub", "目前没有已发布且具有可售机房库存的套餐。请稍后查看实时目录。");
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const plan of plans) {
      const card = document.createElement("article");
      card.className = "plan";
      card.dataset.type = categoryMap[plan.product.category] || "vps";
      if(plan.product.image_path){const image=document.createElement("img");image.className="plan-product-image";image.src=storageClient.storage.from("product-images").getPublicUrl(plan.product.image_path).data.publicUrl;image.alt=plan.product.name;image.loading="lazy";card.append(image);}
      const top = appendText(card, "div", "plan-topline", plan.code || plan.product.name);
      top.title = plan.product.name;
      appendText(card, "h3", "", plan.name);
      appendText(card, "p", "desc", plan.description || plan.product.description || "");
      const price = document.createElement("div");
      price.className = "price";
      price.textContent = money(plan.price_minor, plan.currency);
      appendText(price, "small", "", " / " + period(plan.billing_period));
      card.append(price);

      const specs = document.createElement("div");
      specs.className = "specs";
      const entries = Object.entries(plan.specs || {}).slice(0, 8);
      for (const [key, value] of entries) {
        appendText(specs, "span", "", key + "：" + (Array.isArray(value) ? value.join(" / ") : value));
      }
      card.append(specs);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-ghost";
      button.dataset.planId = plan.id;
      button.dataset.order = plan.name;
      button.dataset.price = money(plan.price_minor, plan.currency) + " / " + period(plan.billing_period);
      button.dataset.osOptions = JSON.stringify(Array.isArray(plan.specs?.os_options) ? plan.specs.os_options : []);
      button.textContent = "选择套餐";
      card.append(button);
      fragment.append(card);
    }
    planList.replaceChildren(fragment);
    document.querySelectorAll(".filter").forEach((button) => button.classList.toggle("active", button.dataset.filter === "all"));
    document.querySelectorAll(".plan").forEach((card) => { card.hidden = false; });
  }

  function renderRegions(mappings) {
    const unique = new Map();
    for (const mapping of mappings || []) {
      const region = mapping.ah_regions;
      if (region?.id) unique.set(region.id, region);
    }
    activeRegions = [...unique.values()];
    regionSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = activeRegions.length ? "请先选择套餐" : "当前没有可售机房";
    regionSelect.append(placeholder);
    regionSelect.disabled = true;

    const regionList = document.getElementById("homepage-regions");
    if (regionList) {
      regionList.replaceChildren();
      if (!activeRegions.length) {
        appendText(regionList, "p", "sub", "目前没有已发布套餐对应的可售机房。");
      } else {
        for (const region of activeRegions) {
          const item = document.createElement("span");
          item.className = "region region-card";
          item.textContent = [region.name, region.city, region.country_code].filter(Boolean).join(" · ");
          regionList.append(item);
        }
      }
    }
  }

  function openPlan(planButton) {
    selectedPlan = planButton.dataset.planId;
    const planMappings = availableMappings.filter((mapping) => mapping.plan_id === selectedPlan);
    regionSelect.replaceChildren();
    for (const mapping of planMappings) {
      const region = mapping.ah_regions;
      if (!region?.id) continue;
      const option = document.createElement("option");
      option.value = region.id;
      option.textContent = [region.name, region.city].filter(Boolean).join(" · ");
      regionSelect.append(option);
    }
    regionSelect.disabled = regionSelect.options.length === 0;
    document.getElementById("config-title").textContent = planButton.dataset.order;
    document.getElementById("config-price").textContent = planButton.dataset.price;
    const osSelect = document.getElementById("config-os");
    if (osSelect) {
      osSelect.replaceChildren();
      let osOptions = [];
      try { osOptions = JSON.parse(planButton.dataset.osOptions || "[]"); } catch { osOptions = []; }
      if (!Array.isArray(osOptions) || !osOptions.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "以已发布套餐规格为准";
        osSelect.append(option);
        osSelect.disabled = true;
      } else {
        for (const value of osOptions.slice(0, 20)) {
          const option = document.createElement("option");
          option.value = String(value);
          option.textContent = String(value);
          osSelect.append(option);
        }
        osSelect.disabled = false;
      }
    }
    document.querySelector(".config-head .kicker").textContent = "SECURE CHECKOUT / 安全下单";
    summary.hidden = true;
    summary.replaceChildren();
    dialog.showModal();
  }

  function showResult(text, linkToAccount = false) {
    summary.replaceChildren();
    appendText(summary, "p", "", text);
    if (linkToAccount) {
      const link = document.createElement("a");
      link.href = document.body.dataset.accountUrl || "account.html";
      link.textContent = "前往账户中心查看订单";
      summary.append(link);
    }
    summary.hidden = false;
  }

  async function submit() {
    if (!selectedPlan) {
      showResult("未能识别所选套餐，请关闭窗口后重新选择。");
      return;
    }
    if (!regionSelect.value) {
      showResult("当前没有可选数据中心，请联系管理员检查后台区域配置。");
      return;
    }

    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "true");
    submitButton.textContent = "正在安全提交…";
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      const session = data.session;
      if (!session?.access_token) {
        showResult("请先登录或创建账户，再回来提交订单。", true);
        return;
      }

      const response = await fetch(config.url.replace(/\/$/, "") + "/functions/v1/create-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.anonKey,
          Authorization: "Bearer " + session.access_token,
          "Idempotency-Key": crypto.randomUUID()
        },
        body: JSON.stringify({
          plan_id: selectedPlan,
          region_id: regionSelect.value,
          quantity: 1,
          customer_note: document.getElementById("config-os").disabled ? null : "操作系统偏好：" + document.getElementById("config-os").value
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const messages = {
          authentication_required: "登录状态已失效，请重新登录。",
          invalid_or_expired_session: "登录状态已失效，请重新登录。",
          plan_or_region_unavailable: "该套餐或数据中心暂不可售，请重新选择。",
          server_not_configured: "订单服务尚未完成服务器配置。",
          order_creation_failed: "订单创建失败，请稍后重试。"
        };
        throw new Error(messages[result.error] || "订单提交失败（" + response.status + "），请稍后重试。");
      }

      const order = result.order || {};
      showResult(
        "订单已创建，当前状态为待付款。订单编号：" + String(order.order_id || "").toUpperCase() +
        "；应付金额：" + money(order.total_minor, order.currency) +
        "。选择收款网络后，系统会按 USDT 报价换算币种金额。",
        true
      );
      const assetPicker = document.createElement("div");
      assetPicker.className = "crypto-invoice-picker";
      assetPicker.style.cssText = "display:grid;gap:10px;margin-top:16px";
      const assetLabel = appendText(assetPicker, "label", "", "选择支付币种 / 网络");
      const assetSelect = document.createElement("select");
      assetSelect.style.cssText = "width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;background:white;color:#111827";
      assetSelect.setAttribute("aria-label", "选择支付币种和网络");
      const assets = [
        ["BTC","BTC · Bitcoin"],["ETH","ETH · Ethereum"],["USDT_ERC20","USDT · ERC-20"],["USDT_TRC20","USDT · TRC-20"],
        ["LTC","LTC · Litecoin"],["TRX","TRX · TRON"],["SOL","SOL · Solana"],["BNB_BEP20","BNB · BNB Smart Chain"],
        ["TON","TON · Toncoin (native TON)"]
      ];
      for (const [code,label] of assets) { const option=document.createElement("option"); option.value=code; option.textContent=label; assetSelect.append(option); }
      assetLabel.append(assetSelect);
      const invoiceButton = document.createElement("button");
      invoiceButton.type = "button"; invoiceButton.className = "btn btn-primary"; invoiceButton.textContent = "生成链上收款金额";
      const invoiceResult = document.createElement("div");
      invoiceResult.className = "crypto-invoice-result";
      invoiceResult.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px";
      invoiceButton.addEventListener("click", async () => {
        invoiceButton.disabled = true; invoiceResult.textContent = "正在获取实时 USDT 汇率并检查链上监听状态…";
        try {
          const response = await fetch(config.url.replace(/\/$/, "") + "/functions/v1/create-crypto-invoice", {
            method:"POST",
            headers:{"Content-Type":"application/json",apikey:config.anonKey,Authorization:"Bearer "+session.access_token},
            body:JSON.stringify({order_id:order.order_id,asset_code:assetSelect.value})
          });
          const result = await response.json().catch(()=>({}));
          if (!response.ok) {
            const messages = {
              asset_monitoring_unavailable:"该网络的自动到账监听尚未启用，系统暂不开放此网络收款，避免转账后无法自动识别。",
              asset_contract_unverified:"该资产的主网合约信息尚未通过核验，暂不开放收款。",
              market_rate_unavailable:"暂时无法取得可靠 USDT 实时汇率，请稍后重试。",
              order_not_payable:"此订单当前不可支付。",
              order_must_be_priced_in_usdt:"订单必须使用 USDT 计价。"
            };
            throw new Error(messages[result.error] || "暂时无法生成收款信息，请稍后重试。");
          }
          const invoice=result.invoice;
          invoiceResult.textContent = "应付：" + invoice.expected_amount + " " + invoice.ticker + "\n网络：" + invoice.network + "\n收款地址：" + invoice.wallet_address + "\n报价：" + invoice.quoted_usdt + " USDT\n有效期：" + invoice.expires_at;
          const copy=document.createElement("button"); copy.type="button"; copy.className="admin-toggle"; copy.textContent="复制收款地址";
          copy.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(invoice.wallet_address);copy.textContent="已复制";}catch{copy.textContent="复制失败";}});
          invoiceResult.append(document.createElement("br"),copy);
        } catch(error) { invoiceResult.textContent=error?.message || "收款信息生成失败。"; }
        finally { invoiceButton.disabled=false; }
      });
      assetPicker.append(invoiceButton,invoiceResult);
      summary.append(assetPicker);
      submitButton.textContent = "订单已提交";
    } catch (error) {
      showResult(error?.message || "订单提交失败，请稍后重试。");
    } finally {
      submitButton.disabled = false;
      submitButton.removeAttribute("aria-busy");
      if (summary.textContent.includes("订单已创建")) {
        submitButton.textContent = "订单已提交";
      } else {
        submitButton.textContent = "创建待处理订单";
      }
    }
  }

  planList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-plan-id]");
    if (button) openPlan(button);
  });

  window.AH_CHECKOUT = {
    get ready() { return Boolean(client); },
    submit
  };

  if (!config.url || !config.anonKey) return;

  (async () => {
    try {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const supabaseClient = createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });

      const [productsResult, mappingsResult] = await Promise.all([
        supabaseClient.from("ah_products")
          .select("id,name,category,category_id,image_path,description,sort_order,ah_product_categories!inner(is_active),ah_plans(id,code,name,description,price_minor,currency,billing_period,specs,is_active,sort_order)")
          .eq("is_active", true)
          .eq("ah_product_categories.is_active", true)
          .order("sort_order", { ascending: true }),
        supabaseClient.from("ah_plan_regions")
          .select("plan_id,region_id,capacity_units,allocated_units,ah_regions!inner(id,name,city,country_code,status)")
          .eq("is_available", true)
      ]);

      if (productsResult.error) throw productsResult.error;
      if (mappingsResult.error) throw mappingsResult.error;
      client = supabaseClient;
      renderRegions(mappingsResult.data || []);
      renderPlans(productsResult.data || [], mappingsResult.data || []);
      const disclaimer = document.querySelector(".plan-disclaimer");
      if (disclaimer) disclaimer.textContent =
        "仅显示后台已发布、具有有效机房映射且仍有容量的套餐。价格与库存均来自实时目录。付款经链上确认后，管理员通过 Telegram 通知进行人工履约；不会自动开通 VPS。";
      const configDisclaimer = document.querySelector(".config-disclaimer");
      if (configDisclaimer) configDisclaimer.textContent =
        "订单使用链上加密货币收款并自动监控确认。付款确认后通知管理员人工交付；本平台不会自动开通服务器或提取资金。";
      submitButton.textContent = "创建订单并生成链上收款信息";
      document.querySelector(".config-head .kicker").textContent = "SECURE CHECKOUT / 安全下单";
    } catch (error) {
      console.error("Anonymous Hosting catalog could not be loaded:", error);
      const notice = document.createElement("p");
      notice.className = "plan-disclaimer";
      notice.textContent = "暂时无法连接实时销售目录。为避免错误报价，当前不展示参考价格或接受下单，请稍后重试。";
      planList.before(notice);
    }
  })();
})();
