const config = window.AH_SUPABASE_CONFIG || {};
const setup = document.getElementById("auth-setup");
const authPanel = document.getElementById("auth-panel");
const authForm = document.getElementById("auth-form");
const authError = document.getElementById("auth-error");
const authSuccess = document.getElementById("auth-success");
const dashboard = document.getElementById("account-dashboard");
const ordersState = document.getElementById("orders-state");
const ordersList = document.getElementById("orders-list");
let supabase;
let mode = "login";

function message(target, value) {
  target.textContent = value;
  target.hidden = !value;
}
function setMode(next) {
  mode = next;
  const login = mode === "login";
  document.getElementById("login-tab").classList.toggle("active", login);
  document.getElementById("signup-tab").classList.toggle("active", !login);
  document.getElementById("login-tab").setAttribute("aria-selected", String(login));
  document.getElementById("signup-tab").setAttribute("aria-selected", String(!login));
  document.getElementById("auth-submit").textContent = login ? "Sign in securely" : "Create account";
  document.getElementById("auth-password").autocomplete = login ? "current-password" : "new-password";
  message(authError, "");
  message(authSuccess, "");
}
function formatMoney(minor, currency) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(minor) / 100); }
  catch { return (Number(minor) / 100).toFixed(2) + " " + currency; }
}
async function renderSession(session) {
  if (!session) {
    dashboard.hidden = true;
    authPanel.hidden = false;
    return;
  }
  authPanel.hidden = true;
  dashboard.hidden = false;
  document.getElementById("account-email").textContent = session.user.email || "Signed-in user";
  ordersState.hidden = false;
  ordersState.textContent = "Loading your orders…";
  ordersList.replaceChildren();
  const { data, error } = await supabase.from("ah_orders")
    .select("id,status,currency,total_minor,created_at")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    ordersState.textContent = "Your account is signed in, but orders could not be loaded. Check that the Anonymous Hosting database migration has been applied.";
    return;
  }
  if (!data.length) {
    ordersState.textContent = "No orders yet. Orders will appear here after checkout is connected.";
    return;
  }
  ordersState.hidden = true;
  for (const order of data) {
    const item = document.createElement("article");
    item.className = "order-row";
    const details = document.createElement("div");
    const id = document.createElement("strong");
    id.textContent = "Order " + order.id.slice(0, 8).toUpperCase();
    const date = document.createElement("small");
    date.textContent = new Date(order.created_at).toLocaleString();
    details.append(id, date);
    const meta = document.createElement("div");
    meta.className = "order-meta";
    const status = document.createElement("span");
    status.className = "order-status";
    status.textContent = order.status.replaceAll("_", " ");
    const total = document.createElement("strong");
    total.textContent = formatMoney(order.total_minor, order.currency);
    meta.append(status, total);
    item.append(details, meta);
    ordersList.append(item);
  }
}
function showError(error) {
  message(authError, error?.message || "Something went wrong. Please try again.");
  message(authSuccess, "");
}

if (!config.url || !config.anonKey) {
  setup.hidden = false;
} else {
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    supabase = createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    setup.hidden = true;
    authPanel.hidden = false;
    const { data: { session } } = await supabase.auth.getSession();
    await renderSession(session);
    supabase.auth.onAuthStateChange((_event, nextSession) => {
      queueMicrotask(() => renderSession(nextSession));
    });
  } catch (error) {
    setup.hidden = false;
    setup.textContent = "Supabase could not be initialized. Verify the project URL and public anon/publishable key, then reload. " + (error?.message || "");
  }
}

document.getElementById("login-tab").addEventListener("click", () => setMode("login"));
document.getElementById("signup-tab").addEventListener("click", () => setMode("signup"));
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  message(authError, "");
  message(authSuccess, "");
  const submit = document.getElementById("auth-submit");
  submit.disabled = true;
  try {
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split("?")[0] } });
    if (result.error) throw result.error;
    if (mode === "signup" && !result.data.session) {
      message(authSuccess, "Account created. Check your email to confirm your address before signing in.");
    } else {
      await renderSession(result.data.session);
    }
  } catch (error) { showError(error); }
  finally { submit.disabled = false; }
});
document.getElementById("reset-password").addEventListener("click", async () => {
  if (!supabase) return;
  const email = document.getElementById("auth-email").value.trim();
  if (!email) { showError(new Error("Enter your email address first.")); return; }
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("?")[0] });
    if (error) throw error;
    message(authSuccess, "If the address is registered, a password reset email will be sent.");
    message(authError, "");
  } catch (error) { showError(error); }
});
document.getElementById("sign-out").addEventListener("click", async () => {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) showError(error);
});
