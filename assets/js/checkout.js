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
  let client = null;
  let selectedPlan = null;
  let activeRegions = [];

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

  function renderPlans(products) {
    const plans = products.flatMap((product) => (product.ah_plans || [])
      .filter((plan) => plan.is_active !== false)
      .map((plan) => ({ ...plan, product })))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

    if (!plans.length) {
      planList.replaceChildren();
      appendText(planList, "p", "sub", "后台尚未发布可购买的套餐，请稍后再试。");
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const plan of plans) {
      const card = document.createElement("article");
      card.className = "plan";
      card.dataset.type = categoryMap[plan.product.category] || "vps";
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
      button.textContent = "选择套餐";
      card.append(button);
      fragment.append(card);
    }
    planList.replaceChildren(fragment);
    document.querySelectorAll(".filter").forEach((button) => button.classList.toggle("active", button.dataset.filter === "all"));
    document.querySelectorAll(".plan").forEach((card) => { card.hidden = false; });
  }

  function renderRegions(regions) {
    activeRegions = regions;
    regionSelect.replaceChildren();
    for (const region of regions) {
      const option = document.createElement("option");
      option.value = region.id;
      option.textContent = [region.name, region.city].filter(Boolean).join(" · ");
      regionSelect.append(option);
    }
    regionSelect.disabled = regions.length === 0;
  }

  function openPlan(planButton) {
    selectedPlan = planButton.dataset.planId;
    document.getElementById("config-title").textContent = planButton.dataset.order;
    document.getElementById("config-price").textContent = planButton.dataset.price;
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
      link.href = "account.html";
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
          customer_note: "操作系统偏好：" + document.getElementById("config-os").value
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
        "订单已创建，当前状态为待处理。订单编号：" + String(order.order_id || "").toUpperCase() +
        "；金额：" + money(order.total_minor, order.currency) +
        "。此步骤不会收取款项，支付与服务器开通尚未启用。",
        true
      );
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

      const [productsResult, regionsResult] = await Promise.all([
        supabaseClient.from("ah_products")
          .select("id,name,category,description,sort_order,ah_plans(id,code,name,description,price_minor,currency,billing_period,specs,is_active,sort_order)")
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
        supabaseClient.from("ah_regions")
          .select("id,name,city,country_code")
          .eq("status", "active")
          .order("name", { ascending: true })
      ]);

      if (productsResult.error) throw productsResult.error;
      if (regionsResult.error) throw regionsResult.error;
      renderRegions(regionsResult.data || []);
      renderPlans(productsResult.data || []);
      client = supabaseClient;
      document.querySelector(".plan-disclaimer").textContent =
        "套餐、价格与可选机房来自后台实时目录。提交后仅创建待处理订单，不会立即扣款或自动开通服务器。";
      document.querySelector(".config-disclaimer").textContent =
        "订单需要登录账户。当前仅创建待处理订单；支付接入和服务器自动开通尚未启用。";
      submitButton.textContent = "创建待处理订单";
      document.querySelector(".config-head .kicker").textContent = "SECURE CHECKOUT / 安全下单";
    } catch (error) {
      console.error("Anonymous Hosting catalog could not be loaded:", error);
      const notice = document.createElement("p");
      notice.className = "plan-disclaimer";
      notice.textContent = "暂时无法连接实时商品目录，当前展示内容仅供参考，请稍后重试。";
      planList.before(notice);
    }
  })();
})();
