(() => {
  const loginTab = document.getElementById("token-login-tab");
  const signupTab = document.getElementById("token-signup-tab");
  const loginPanel = document.getElementById("token-login-panel");
  const signupPanel = document.getElementById("token-signup-panel");
  const message = document.getElementById("token-auth-message");
  const generated = document.getElementById("generated-token");
  const result = document.getElementById("token-result");
  const createButton = document.getElementById("generate-token");
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
  function makeToken() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("").toUpperCase();
    return hex.match(/.{1,4}/g).join("-");
  }

  loginTab.addEventListener("click", () => setMode("login"));
  signupTab.addEventListener("click", () => setMode("signup"));
  document.getElementById("show-token-signup")?.addEventListener("click", () => setMode("signup"));
  document.getElementById("show-token-login")?.addEventListener("click", () => setMode("login"));
  document.getElementById("token-login-submit")?.addEventListener("click", () => {
    const value = document.getElementById("access-token").value.trim();
    if (!value) {
      showMessage("请输入访问令牌。");
      return;
    }
    showMessage("令牌验证服务尚未接入。当前不会发送或验证令牌，也不会创建登录会话。");
  });
  createButton?.addEventListener("click", () => {
    if (!crypto?.getRandomValues) {
      showMessage("当前浏览器无法安全生成随机令牌，请使用支持安全随机数的现代浏览器。");
      return;
    }
    generated.value = makeToken();
    result.hidden = false;
    createButton.textContent = "重新生成演示令牌";
    showMessage("演示令牌已在本机生成。请注意：它没有保存到服务器，离开页面后无法恢复，也不能用于登录。");
  });
  document.getElementById("copy-token")?.addEventListener("click", async () => {
    if (!generated.value) return;
    try {
      await navigator.clipboard.writeText(generated.value);
      showMessage("已复制演示令牌。请勿将其用于真实账户。");
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
