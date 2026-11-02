const locale = window.AH_LOCALE;
const lang = document.getElementById("language");
function applyLanguage(code) {
  const selected = locale.normalize(code);
  document.documentElement.lang = selected;
  document.documentElement.dir = "ltr";
  lang.value = selected;
  locale.apply(document.body, selected);
  localStorage.setItem("ah-language", selected);
}
lang.addEventListener("change", () => applyLanguage(lang.value));
applyLanguage(localStorage.getItem("ah-language") || "zh-CN");
document.getElementById("year").textContent = new Date().getFullYear();

const mobileMenu = document.getElementById("mobile-menu");
const navLinks = document.querySelector(".links");
mobileMenu.addEventListener("click", () => {
  const open = mobileMenu.getAttribute("aria-expanded") !== "true";
  mobileMenu.setAttribute("aria-expanded", String(open));
  mobileMenu.setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
  navLinks.style.display = open ? "flex" : "";
});
navLinks.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
  mobileMenu.setAttribute("aria-expanded", "false");
  mobileMenu.setAttribute("aria-label", "打开菜单");
  navLinks.style.display = "";
}));

const configureDialog = document.getElementById("configure-dialog");
const configTitle = document.getElementById("config-title");
const configPrice = document.getElementById("config-price");
const configSummary = document.getElementById("config-summary");
document.querySelectorAll("[data-order]").forEach((button) => button.addEventListener("click", () => {
  configTitle.textContent = button.dataset.order;
  configPrice.textContent = button.dataset.price;
  configSummary.hidden = true;
  configureDialog.showModal();
}));
document.getElementById("config-close").addEventListener("click", () => configureDialog.close());
configureDialog.addEventListener("click", (event) => { if (event.target === configureDialog) configureDialog.close(); });
document.getElementById("configure-form").addEventListener("submit", (event) => {
  event.preventDefault();
  configSummary.hidden = false;
  configSummary.textContent = "配置预览：" + configTitle.textContent + " · " + configPrice.textContent + " · " + document.getElementById("config-region").value + " · " + document.getElementById("config-os").value + "。演示环境，不会提交订单。";
});
function filterPlans(filter) {
  document.querySelectorAll(".filter").forEach((button) => button.classList.toggle("active", button.dataset.filter === filter));
  document.querySelectorAll(".plan").forEach((plan) => { plan.hidden = !(filter === "all" || plan.dataset.type === filter); });
}
document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", () => filterPlans(button.dataset.filter)));
document.querySelectorAll(".product").forEach((card) => card.addEventListener("click", () => {
  const filter = card.dataset.category;
  if (filter) filterPlans(filter);
}));
document.querySelectorAll("[data-jump-filter]").forEach((link) => link.addEventListener("click", () => filterPlans(link.dataset.jumpFilter)));
