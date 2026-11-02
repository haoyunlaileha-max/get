const config = window.AH_SUPABASE_CONFIG || {};
const setup = document.getElementById("auth-setup");
const authPanel = document.getElementById("auth-panel");
const authForm = document.getElementById("auth-form");
const authError = document.getElementById("auth-error");
const authSuccess = document.getElementById("auth-success");
const dashboard = document.getElementById("account-dashboard");
const ordersState = document.getElementById("orders-state");
const ordersList = document.getElementById("orders-list");
const submitButton = document.getElementById("auth-submit");
const resetButton = document.getElementById("reset-password");
const signOutButton = document.getElementById("sign-out");
let supabase;
let mode = "login";
let activeUserId = null;

function message(target, value) {
  target.textContent = value;
  target.hidden = !value;
}
function setBusy(button, busy, busyText, idleText) {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
  button.textContent = busy ? busyText : idleText;
}
function setMode(next) {
  mode = next;
  const login = mode === "login";
  document.getElementById("login-tab").classList.toggle("active", login);
  document.getElementById("signup-tab").classList.toggle("active", !login);
  document.getElementById("login-tab").setAttribute("aria-selected", String(login));
  document.getElementById("signup-tab").setAttribute("aria-selected", String(!login));
  document.getElementById("auth-password").autocomplete = login ? "current-password" : "new-password";
  setBusy(submitButton, false, "", login ? "Sign in securely" : "Create account");
  message(authError, "");
  message(authSuccess, "");
}
function formatMoney(minor, currency) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(minor) / 100); }
  catch { return (Number(minor) / 100).toFixed(2) + " " + currency; }
}
function renderOrderItem(row) {
  const line = document.createElement("li");
  const label = document.createElement("span");
  label.textContent = row.description_snapshot + (row.quantity > 1 ? " × " + row.quantity : "");
  const price = document.createElement("strong");
  price.textContent = formatMoney(Number(row.unit_price_minor) * Number(row.quantity), "USD");
  line.append(label, price);
  return line;
}
async function renderSession(session) {
  if (!session) {
    activeUserId = null;
    dashboard.hidden = true;
    authPanel.hidden = false;
    return;
  }
  const userId = session.user.id;
  activeUserId = userId;
  authPanel.hidden = true;
  dashboard.hidden = false;
  document.getElementById("account-email").textContent = session.user.email || "Signed-in user";
  ordersState.hidden = false;
  ordersState.textContent = "Loading your orders…";
  ordersList.replaceChildren();
  const { data, error } = await supabase.from("ah_orders")
    .select("id,status,currency,total_minor,created_at,ah_order_items(description_snapshot,quantity,unit_price_minor)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (activeUserId !== userId) return;
  if (error) {
    ordersState.textContent = "Your account is signed in, but orders could not be loaded. Check that the Anonymous Hosting database migration has been applied and that its RLS policies are active.";
    return;
  }
  if (!data?.length) {
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
    status.textContent = String(order.status).replaceAll("_", " ");
    const total = document.createElement("strong");
    total.textContent = formatMoney(order.total_minor, order.currency);
    meta.append(status, total);
    item.append(details, meta);
    const lines = document.createElement("ul");
    lines.className = "order-items";
    for (const row of order.ah_order_items || []) lines.append(renderOrderItem(row));
    if (lines.childElementCount) item.append(lines);
    ordersList.append(item);
  }
}
function showError(error) {
  message(authError, error?.message || "Something went wrong. Please try again.");
  message(authSuccess, "");
}

document.getElementById("toggle-password").addEventListener("click", (event) => {
  const input = document.getElementById("auth-password");
  const button = event.currentTarget;
  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  button.textContent = visible ? "Hide" : "Show";
  button.setAttribute("aria-label", visible ? "Hide password" : "Show password");
  button.setAttribute("aria-pressed", String(visible));
});

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
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    await renderSession(data.session);
    supabase.auth.onAuthStateChange((_event, nextSession) => {
      queueMicrotask(() => renderSession(nextSession).catch(showError));
    });
  } catch (error) {
    setup.hidden = false;
    setup.textContent = "Supabase could not be initialized. Verify the project URL and public anon/publishable key, then reload. " + (error?.message || "");
    authPanel.hidden = true;
  }
}

document.getElementById("login-tab").addEventListener("click", () => setMode("login"));
document.getElementById("signup-tab").addEventListener("click", () => setMode("signup"));
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  message(authError, "");
  message(authSuccess, "");
  setBusy(submitButton, true, mode === "login" ? "Signing in…" : "Creating account…", "");
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
  finally { setBusy(submitButton, false, "", mode === "login" ? "Sign in securely" : "Create account"); }
});
resetButton.addEventListener("click", async () => {
  if (!supabase) return;
  const email = document.getElementById("auth-email").value.trim();
  if (!email) { showError(new Error("Enter your email address first.")); return; }
  message(authError, "");
  setBusy(resetButton, true, "Sending…", "Send password reset email");
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("?")[0] });
    if (error) throw error;
    message(authSuccess, "If the address is registered, a password reset email will be sent.");
    message(authError, "");
  } catch (error) { showError(error); }
  finally { setBusy(resetButton, false, "", "Send password reset email"); }
});
signOutButton.addEventListener("click", async () => {
  if (!supabase) return;
  setBusy(signOutButton, true, "Signing out…", "Sign out");
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    message(authSuccess, "You have been signed out.");
  } catch (error) { showError(error); }
  finally { setBusy(signOutButton, false, "", "Sign out"); }
});
