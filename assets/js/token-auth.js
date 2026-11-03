(() => {
  const config = window.AH_SUPABASE_CONFIG || {};
  const loginTab = document.getElementById("token-login-tab");
  const signupTab = document.getElementById("token-signup-tab");
  const loginPanel = document.getElementById("token-login-panel");
  const signupPanel = document.getElementById("token-signup-panel");
  const message = document.getElementById("token-auth-message");
  const generated = document.getElementById("generated-token");
  const result = document.getElementById("token-result");
  const createButton = document.getElementById("generate-token");
  const loginButton = document.getElementById("token-login-submit");
  const tokenInput = document.getElementById("access-token");
  let pendingToken = null;
  let registrationComplete = false;

  if (!loginTab || !signupTab || !loginPanel || !signupPanel) return;

  function setMode(mode) {
    const isLogin = mode === "login";
    loginPanel.hidden = !isLogin;
    signupPanel.hidden = isLogin;
    loginTab.classList.toggle("active", isLogin);
    signupTab.classList.toggle("active", !isLogin);
    loginTab.setAttribute("aria-selected", String(isLogin));
    signupTab.setAttribute("aria-selected", String(!isLogin));
    message.hidden = true;
    message.textContent = "";
  }

  function showMessage(text) {
    message.textContent = text;
    message.hidden = false;
  }

  function setBusy(button, busy, text) {
    if (!button) return;
    button.disabled = busy;
    if (text) button.textContent = text;
    button.setAttribute("aria-busy", String(busy));
  }

  function makeToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("").toUpperCase();
    return hex.match(/.{1,4}/g).join("-");
  }

  async function requestAuth(action, token) {
    if (!config.url || !config.anonKey) throw new Error("登录服务尚未配置，请稍后再试。");
    const response = await fetch(config.url.replace(/\/+$/, "") + "/functions/v1/token-auth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": config.anonKey
      },
      body: JSON.stringify({ action, token })
    });
    let body = {};
    try { body = await response.json(); } catch { /* Ignore non-JSON error bodies. */ }
    if (response.ok) return body;
    const errors = {
      invalid_token: "访问令牌不正确，请检查后重试。",
      invalid_token_format: "令牌格式不正确，请检查是否完整。",
      token_already_registered: "该令牌已经注册。请切换到登录页面。",
      too_many_attempts: "操作过于频繁，请稍后再试。",
      origin_not_allowed: "当前网站来源未获授权，请联系管理员。",
      auth_service_not_configured: "登录服务尚未完成服务器配置。",
      account_creation_failed: "创建账户失败，请稍后重试。"
    };
    throw new Error(errors[body.error] || "请求失败，请稍后重试。");
  }

  async function applySession(session) {
    // Reuse the account page's initialized client and its auth storage.
    const client = window.AH_SUPABASE_AUTH_CLIENT;
    if (!client) throw new Error("账户中心仍在初始化，请稍后再试。");
    const { data, error } = await client.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token
    });
    if (error) throw error;
    if (!data?.session?.user) throw new Error("登录会话未能建立，请重试。");
    // Render the dashboard directly; do not reload and risk losing the just-written session.
    if (typeof window.AH_RENDER_ACCOUNT_SESSION === "function") {
      await window.AH_RENDER_ACCOUNT_SESSION(data.session);
    }
  }

  loginTab.addEventListener("click", () => setMode("login"));
  signupTab.addEventListener("click", () => setMode("signup"));
  document.getElementById("show-token-signup")?.addEventListener("click", () => setMode("signup"));
  document.getElementById("show-token-login")?.addEventListener("click", () => {
    if (pendingToken && registrationComplete) tokenInput.value = pendingToken;
    setMode("login");
  });

  loginButton?.addEventListener("click", async () => {
    const compactToken = (tokenInput.value || "").replace(/[\s-]+/g, "").toUpperCase();
    const token = /^[A-F0-9]{64}$/.test(compactToken)
      ? compactToken.match(/.{4}/g).join("-")
      : (tokenInput.value || "").replace(/\s+/g, "").toUpperCase();
    if (!token) {
      showMessage("请输入访问令牌。");
      return;
    }
    setBusy(loginButton, true, "正在验证…");
    try {
      const data = await requestAuth("login", token);
      await applySession(data.session);
    } catch (error) {
      showMessage(error?.message || "登录失败，请重试。");
    } finally {
      setBusy(loginButton, false, "登录");
    }
  });

  createButton?.addEventListener("click", async () => {
    if (!crypto?.getRandomValues) {
      showMessage("当前浏览器无法安全生成随机令牌，请使用现代浏览器。");
      return;
    }
    if (!pendingToken || registrationComplete) {
      pendingToken = makeToken();
      registrationComplete = false;
      result.hidden = true;
    }
    setBusy(createButton, true, "正在安全创建…");
    try {
      const data = await requestAuth("register", pendingToken);
      if (!data.registered) throw new Error("服务器未确认账户创建，请重试。");
      registrationComplete = true;
      generated.value = pendingToken;
      result.hidden = false;
      createButton.textContent = "创建另一个令牌";
      showMessage("账户已创建。请立即复制并安全保存令牌；完整令牌不会再次显示。");
    } catch (error) {
      if (error?.message === "该令牌已经注册。请切换到登录页面。") {
        registrationComplete = true;
        generated.value = pendingToken;
        result.hidden = false;
        showMessage("账户已存在。请复制当前令牌并切换到登录页面。");
      } else {
        showMessage(error?.message || "创建账户失败，请重试。");
      }
    } finally {
      createButton.disabled = false;
      createButton.setAttribute("aria-busy", "false");
      if (!registrationComplete) createButton.textContent = "创建我的令牌";
    }
  });

  document.getElementById("copy-token")?.addEventListener("click", async () => {
    if (!generated.value) return;
    try {
      await navigator.clipboard.writeText(generated.value);
      showMessage("令牌已复制。请保存在密码管理器或其他安全位置。");
    } catch {
      generated.focus();
      generated.select();
      showMessage("浏览器未允许自动复制，请手动复制选中的令牌。");
    }
  });

  const params = new URLSearchParams(location.search);
  setMode(params.get("mode") === "signup" ? "signup" : "login");
  if (location.hash === "#register" || location.hash === "#signup") setMode("signup");
})();
