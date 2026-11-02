import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window.AH_SUPABASE_CONFIG || {};
const $ = (id) => document.getElementById(id);
const nodes = {
  setup: $("admin-setup"), denied: $("admin-denied"), login: $("admin-login"),
  app: $("admin-app"), error: $("admin-error"), success: $("admin-success"),
  refresh: $("refresh-admin"), signout: $("admin-signout"), language: $("admin-language"),
};
const languages = ["en", "zh", "ar", "fr", "ru", "es"];
let language = localStorage.getItem("ah-language") || "en";
let supabase;
let busy = false;

const t = {
en:{language:"Language",storefront:"Storefront",eyebrow:"OPERATIONS / CONTROL PLANE",title:"Operations console",subtitle:"Monitor orders, payments, provisioning and catalog availability.",refresh:"Refresh data",login_required:"Administrator sign-in required",login_copy:"Sign in with an account assigned the verified admin role, then return here.",open_account:"Open account sign-in",signed_in_as:"Signed in as",sign_out:"Sign out",orders:"Orders",all_records:"All records",paid:"Paid",paid_orders:"Paid orders",queued:"Provisioning queue",waiting_work:"Waiting / retrying",active:"Active plans",catalog:"Catalog",orders_title:"Recent orders",orders_desc:"Customer orders and their current lifecycle state.",order:"Order",customer:"Customer ID",status:"Status",total:"Total",created:"Created",jobs_title:"Provisioning jobs",jobs_desc:"Queue state, attempts and provider references.",payments_title:"Payment events",payments_desc:"Verified webhook audit records.",catalog_title:"Product catalog",catalog_desc:"Enable or disable products and plans. Price changes are intentionally not exposed here.",regions_title:"Data-center regions",regions_desc:"Control whether a region is available for new orders.",security_note:"Admin access is verified using Supabase app_metadata and enforced again by database RLS. Never share service-role keys with this page.",loading:"Loading operational data…",empty:"No records found.",load_error:"Could not load admin data. Check that migrations 0001–0005 are applied and admin RLS is enabled.",not_admin:"This account is not assigned the verified admin role. Ask an authorized project owner to set app_metadata.role = admin.",setup_error:"Add the Supabase project URL and public anon/publishable key to assets/js/supabase-config.js. Never add a service-role key.",enabled:"Enabled",disabled:"Disabled",activate:"Enable",deactivate:"Disable",region_active:"Active",region_inactive:"Inactive",maintenance:"Maintenance",set_active:"Set active",set_inactive:"Set inactive",set_maintenance:"Set maintenance",updated:"Saved successfully.",update_error:"Could not save this change. Verify database migrations and RLS policies.",no_jobs:"No provisioning jobs.",no_payments:"No payment events.",attempts:"Attempts",provider_ref:"Provider ref",event:"Event",amount:"Amount",refreshing:"Refreshing…",signing_out:"Signing out…",no_data:"No data"},
zh:{language:"语言",storefront:"网站首页",eyebrow:"运营 / 控制中心",title:"运营管理后台",subtitle:"监控订单、支付、服务器开通任务和商品目录。",refresh:"刷新数据",login_required:"需要管理员登录",login_copy:"请使用已被授予管理员角色的账户登录，然后返回此页面。",open_account:"打开账户登录",signed_in_as:"当前登录",sign_out:"退出登录",orders:"订单总数",all_records:"全部记录",paid:"已付款",paid_orders:"已付款订单",queued:"开通任务",waiting_work:"等待 / 重试中",active:"启用套餐",catalog:"商品目录",orders_title:"最近订单",orders_desc:"客户订单及当前生命周期状态。",order:"订单",customer:"客户 ID",status:"状态",total:"总金额",created:"创建时间",jobs_title:"服务器开通任务",jobs_desc:"队列状态、尝试次数和供应商编号。",payments_title:"支付事件",payments_desc:"已验证的 Webhook 审计记录。",catalog_title:"商品目录",catalog_desc:"启用或停用产品与套餐。此处不开放价格修改。",regions_title:"数据中心",regions_desc:"控制机房是否可用于新订单。",security_note:"管理员身份通过 Supabase app_metadata 验证，并由数据库 RLS 再次执行权限控制。切勿向此页面提供 service-role 密钥。",loading:"正在加载运营数据…",empty:"没有记录。",load_error:"无法加载后台数据。请确认已执行 0001–0005 迁移并启用管理员 RLS。",not_admin:"此账户没有经过验证的管理员角色。请项目授权管理员设置 app_metadata.role = admin。",setup_error:"请在 assets/js/supabase-config.js 中填写 Supabase 项目 URL 和公开 anon/publishable key。切勿填写 service-role 密钥。",enabled:"已启用",disabled:"已停用",activate:"启用",deactivate:"停用",region_active:"运行中",region_inactive:"已停用",maintenance:"维护中",set_active:"设为运行中",set_inactive:"设为停用",set_maintenance:"设为维护",updated:"保存成功。",update_error:"保存失败，请检查数据库迁移和 RLS 权限。",no_jobs:"暂无开通任务。",no_payments:"暂无支付事件。",attempts:"尝试次数",provider_ref:"供应商编号",event:"事件",amount:"金额",refreshing:"刷新中…",signing_out:"正在退出…",no_data:"暂无数据"},
ar:{language:"اللغة",storefront:"المتجر",eyebrow:"العمليات / لوحة التحكم",title:"لوحة العمليات",subtitle:"مراقبة الطلبات والمدفوعات والتجهيز وتوفر الكتالوج.",refresh:"تحديث البيانات",login_required:"يلزم تسجيل دخول المسؤول",login_copy:"سجّل الدخول بحساب يحمل دور المسؤول الموثّق ثم عُد إلى هنا.",open_account:"فتح تسجيل الدخول",signed_in_as:"تم تسجيل الدخول باسم",sign_out:"تسجيل الخروج",orders:"الطلبات",all_records:"كل السجلات",paid:"مدفوع",paid_orders:"الطلبات المدفوعة",queued:"قائمة التجهيز",waiting_work:"قيد الانتظار / إعادة المحاولة",active:"الخطط النشطة",catalog:"الكتالوج",orders_title:"أحدث الطلبات",orders_desc:"طلبات العملاء وحالتها الحالية.",order:"الطلب",customer:"معرّف العميل",status:"الحالة",total:"الإجمالي",created:"تاريخ الإنشاء",jobs_title:"مهام التجهيز",jobs_desc:"حالة المهام والمحاولات ومراجع المزوّد.",payments_title:"أحداث الدفع",payments_desc:"سجلات إشعارات الدفع الموثّقة.",catalog_title:"كتالوج المنتجات",catalog_desc:"تفعيل المنتجات والخطط أو تعطيلها. لا يمكن تعديل الأسعار هنا.",regions_title:"مناطق مراكز البيانات",regions_desc:"التحكم في توفر المنطقة للطلبات الجديدة.",security_note:"يتم التحقق من دور المسؤول عبر app_metadata وتطبيقه أيضاً بواسطة RLS. لا تضع مفاتيح service-role هنا.",loading:"جارٍ تحميل بيانات العمليات…",empty:"لا توجد سجلات.",load_error:"تعذر تحميل البيانات. تحقق من تطبيق عمليات الترحيل 0001–0005 وسياسات RLS.",not_admin:"هذا الحساب ليس مسؤولاً موثّقاً.",setup_error:"أضف رابط Supabase والمفتاح العام إلى ملف الإعداد. لا تضع مفتاح service-role.",enabled:"مفعّل",disabled:"معطّل",activate:"تفعيل",deactivate:"تعطيل",region_active:"نشط",region_inactive:"غير نشط",maintenance:"صيانة",set_active:"تعيين نشط",set_inactive:"تعيين غير نشط",set_maintenance:"تعيين صيانة",updated:"تم الحفظ.",update_error:"تعذر الحفظ. تحقق من الترحيلات وسياسات RLS.",no_jobs:"لا توجد مهام تجهيز.",no_payments:"لا توجد أحداث دفع.",attempts:"المحاولات",provider_ref:"مرجع المزوّد",event:"الحدث",amount:"المبلغ",refreshing:"جارٍ التحديث…",signing_out:"جارٍ تسجيل الخروج…",no_data:"لا توجد بيانات"},
fr:{language:"Langue",storefront:"Boutique",eyebrow:"OPÉRATIONS / CONTRÔLE",title:"Console d’exploitation",subtitle:"Suivez les commandes, paiements, déploiements et disponibilités du catalogue.",refresh:"Actualiser",login_required:"Connexion administrateur requise",login_copy:"Connectez-vous avec un compte doté du rôle administrateur vérifié.",open_account:"Ouvrir la connexion",signed_in_as:"Connecté en tant que",sign_out:"Déconnexion",orders:"Commandes",all_records:"Tous les enregistrements",paid:"Payées",paid_orders:"Commandes payées",queued:"File de déploiement",waiting_work:"En attente / nouvelle tentative",active:"Offres actives",catalog:"Catalogue",orders_title:"Commandes récentes",orders_desc:"Commandes clients et état actuel.",order:"Commande",customer:"ID client",status:"État",total:"Total",created:"Créée le",jobs_title:"Tâches de déploiement",jobs_desc:"État, tentatives et références fournisseur.",payments_title:"Événements de paiement",payments_desc:"Journaux des webhooks vérifiés.",catalog_title:"Catalogue produits",catalog_desc:"Activer ou désactiver produits et offres. Les prix ne sont pas modifiables ici.",regions_title:"Régions des centres de données",regions_desc:"Gérer la disponibilité des régions pour les nouvelles commandes.",security_note:"Le rôle administrateur est vérifié via app_metadata et imposé par RLS. Ne placez jamais de clé service-role ici.",loading:"Chargement des données…",empty:"Aucun enregistrement.",load_error:"Chargement impossible. Vérifiez les migrations 0001–0005 et les règles RLS.",not_admin:"Ce compte ne possède pas le rôle administrateur vérifié.",setup_error:"Configurez l’URL Supabase et la clé publique dans le fichier de configuration. Jamais de clé service-role.",enabled:"Activé",disabled:"Désactivé",activate:"Activer",deactivate:"Désactiver",region_active:"Actif",region_inactive:"Inactif",maintenance:"Maintenance",set_active:"Définir actif",set_inactive:"Définir inactif",set_maintenance:"Définir maintenance",updated:"Enregistré.",update_error:"Échec de l’enregistrement. Vérifiez les migrations et RLS.",no_jobs:"Aucune tâche.",no_payments:"Aucun événement.",attempts:"Tentatives",provider_ref:"Réf. fournisseur",event:"Événement",amount:"Montant",refreshing:"Actualisation…",signing_out:"Déconnexion…",no_data:"Aucune donnée"},
ru:{language:"Язык",storefront:"Магазин",eyebrow:"ОПЕРАЦИИ / ПАНЕЛЬ УПРАВЛЕНИЯ",title:"Панель операций",subtitle:"Заказы, платежи, развёртывание серверов и доступность каталога.",refresh:"Обновить данные",login_required:"Требуется вход администратора",login_copy:"Войдите под учётной записью с подтверждённой ролью администратора.",open_account:"Открыть вход",signed_in_as:"Выполнен вход:",sign_out:"Выйти",orders:"Заказы",all_records:"Все записи",paid:"Оплачено",paid_orders:"Оплаченные заказы",queued:"Очередь развёртывания",waiting_work:"Ожидание / повтор",active:"Активные тарифы",catalog:"Каталог",orders_title:"Последние заказы",orders_desc:"Заказы клиентов и их текущий статус.",order:"Заказ",customer:"ID клиента",status:"Статус",total:"Сумма",created:"Создан",jobs_title:"Задачи развёртывания",jobs_desc:"Статус, попытки и ссылки провайдера.",payments_title:"Платёжные события",payments_desc:"Проверенные записи webhook.",catalog_title:"Каталог продуктов",catalog_desc:"Включение и отключение продуктов и тарифов. Изменение цен здесь недоступно.",regions_title:"Регионы дата-центров",regions_desc:"Управление доступностью регионов для новых заказов.",security_note:"Роль администратора проверяется через app_metadata и дополнительно ограничивается RLS. Не добавляйте service-role ключ.",loading:"Загрузка данных…",empty:"Записей нет.",load_error:"Не удалось загрузить данные. Проверьте миграции 0001–0005 и RLS.",not_admin:"У этой учётной записи нет подтверждённой роли администратора.",setup_error:"Укажите URL Supabase и публичный ключ в файле конфигурации. Не используйте service-role ключ.",enabled:"Включено",disabled:"Отключено",activate:"Включить",deactivate:"Отключить",region_active:"Активен",region_inactive:"Неактивен",maintenance:"Обслуживание",set_active:"Сделать активным",set_inactive:"Отключить",set_maintenance:"Обслуживание",updated:"Сохранено.",update_error:"Не удалось сохранить. Проверьте миграции и RLS.",no_jobs:"Задач нет.",no_payments:"Событий нет.",attempts:"Попытки",provider_ref:"ID провайдера",event:"Событие",amount:"Сумма",refreshing:"Обновление…",signing_out:"Выход…",no_data:"Нет данных"},
es:{language:"Idioma",storefront:"Tienda",eyebrow:"OPERACIONES / CONTROL",title:"Consola de operaciones",subtitle:"Supervisa pedidos, pagos, aprovisionamiento y disponibilidad del catálogo.",refresh:"Actualizar datos",login_required:"Se requiere acceso de administrador",login_copy:"Inicia sesión con una cuenta que tenga el rol de administrador verificado.",open_account:"Abrir inicio de sesión",signed_in_as:"Sesión de",sign_out:"Cerrar sesión",orders:"Pedidos",all_records:"Todos los registros",paid:"Pagados",paid_orders:"Pedidos pagados",queued:"Cola de aprovisionamiento",waiting_work:"En espera / reintento",active:"Planes activos",catalog:"Catálogo",orders_title:"Pedidos recientes",orders_desc:"Pedidos de clientes y estado actual.",order:"Pedido",customer:"ID de cliente",status:"Estado",total:"Total",created:"Creado",jobs_title:"Tareas de aprovisionamiento",jobs_desc:"Estado, intentos y referencias del proveedor.",payments_title:"Eventos de pago",payments_desc:"Registros de webhooks verificados.",catalog_title:"Catálogo de productos",catalog_desc:"Activar o desactivar productos y planes. Los precios no se modifican aquí.",regions_title:"Regiones de centros de datos",regions_desc:"Controla la disponibilidad de regiones para nuevos pedidos.",security_note:"El rol de administrador se verifica mediante app_metadata y RLS. Nunca incluyas claves service-role aquí.",loading:"Cargando datos…",empty:"No hay registros.",load_error:"No se pudieron cargar los datos. Comprueba las migraciones 0001–0005 y RLS.",not_admin:"Esta cuenta no tiene el rol de administrador verificado.",setup_error:"Configura la URL de Supabase y la clave pública. Nunca uses la clave service-role.",enabled:"Activo",disabled:"Inactivo",activate:"Activar",deactivate:"Desactivar",region_active:"Activa",region_inactive:"Inactiva",maintenance:"Mantenimiento",set_active:"Marcar activa",set_inactive:"Marcar inactiva",set_maintenance:"Mantenimiento",updated:"Guardado.",update_error:"No se pudo guardar. Comprueba migraciones y RLS.",no_jobs:"No hay tareas.",no_payments:"No hay eventos.",attempts:"Intentos",provider_ref:"Referencia proveedor",event:"Evento",amount:"Importe",refreshing:"Actualizando…",signing_out:"Cerrando sesión…",no_data:"Sin datos"}
};

function tr(key) { return (messages[language] || messages.en)[key] || messages.en[key] || key; }
function setText(id, value) { const node = $(id); if (node) node.textContent = value; }
function show(node, message) { node.hidden = !message; if (message) node.textContent = message; }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}
function money(minor, currency) {
  const amount = Number(minor);
  if (!Number.isFinite(amount)) return "—";
  try { return new Intl.NumberFormat(language, { style: "currency", currency: String(currency || "USD").trim() }).format(amount / 100); }
  catch { return `${(amount / 100).toFixed(2)} ${currency || "USD"}`; }
}
function date(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}
function statusPill(value) {
  const status = String(value || "unknown");
  return `<span class="admin-status status-${escapeHtml(status)}">${escapeHtml(status.replaceAll("_", " "))}</span>`;
}
function applyLanguage() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  document.querySelectorAll("[data-i]").forEach((node) => { node.textContent = tr(node.dataset.i); });
  nodes.language.value = language;
}
function renderOrders(rows) {
  $("orders-count").textContent = String(rows.length);
  $("orders-body").replaceChildren();
  if (!rows.length) {
    const row = document.createElement("tr"); const cell = document.createElement("td");
    cell.colSpan = 5; cell.textContent = tr("empty"); row.append(cell); $("orders-body").append(row); return;
  }
  for (const order of rows) {
    const row = document.createElement("tr");
    const values = [String(order.id).slice(0, 8), String(order.user_id).slice(0, 8), order.status, money(order.total_minor, order.currency), date(order.created_at)];
    for (const value of values) { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }
    row.children[2].innerHTML = statusPill(order.status);
    $("orders-body").append(row);
  }
}
function renderJobs(rows) {
  const root = $("jobs-list"); root.replaceChildren();
  if (!rows.length) { root.textContent = tr("no_jobs"); return; }
  for (const job of rows) {
    const item = document.createElement("article"); item.className = "admin-record";
    item.innerHTML = `<div class="admin-record-top"><strong>${escapeHtml(String(job.order_id).slice(0, 8))}</strong>${statusPill(job.status)}</div><small>${escapeHtml(tr("attempts"))}: ${Number(job.attempts) || 0}/${Number(job.max_attempts) || 0}</small><small>${escapeHtml(tr("provider_ref"))}: ${escapeHtml(job.provider_reference || "—")}</small><small>${escapeHtml(job.last_error_code || "")}</small>`;
    root.append(item);
  }
}
function renderPayments(rows) {
  const root = $("payments-list"); root.replaceChildren();
  if (!rows.length) { root.textContent = tr("no_payments"); return; }
  for (const event of rows) {
    const item = document.createElement("article"); item.className = "admin-record";
    item.innerHTML = `<div class="admin-record-top"><strong>${escapeHtml(event.provider)} · ${escapeHtml(String(event.event_id).slice(0, 22))}</strong>${statusPill(event.event_type)}</div><small>${escapeHtml(tr("order"))}: ${escapeHtml(String(event.order_id).slice(0, 8))}</small><small>${escapeHtml(tr("amount"))}: ${escapeHtml(money(event.amount_minor, event.currency))}</small><small>${escapeHtml(date(event.received_at))}</small>`;
    root.append(item);
  }
}
function renderCatalog(products, plans) {
  const root = $("catalog-list"); root.replaceChildren();
  const productMap = new Map(products.map((product) => [product.id, product]));
  for (const product of products) {
    const group = document.createElement("div"); group.className = "admin-catalog-group";
    const head = document.createElement("div"); head.className = "admin-catalog-head";
    const label = document.createElement("div"); label.innerHTML = `<strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category)} · ${escapeHtml(product.slug)}</small>`;
    const toggle = document.createElement("button"); toggle.className = "admin-toggle"; toggle.type = "button";
    toggle.textContent = product.is_active ? tr("deactivate") : tr("activate");
    toggle.addEventListener("click", () => updateRow("ah_products", product.id, { is_active: !product.is_active }));
    head.append(label, toggle); group.append(head);
    for (const plan of plans.filter((entry) => entry.product_id === product.id)) {
      const line = document.createElement("div"); line.className = "admin-catalog-line";
      const name = document.createElement("span"); name.textContent = `${plan.name} · ${money(plan.price_minor, plan.currency)} / ${plan.billing_period}`;
      const state = document.createElement("span"); state.className = "admin-catalog-state"; state.textContent = plan.is_active ? tr("enabled") : tr("disabled");
      const button = document.createElement("button"); button.className = "admin-toggle"; button.type = "button";
      button.textContent = plan.is_active ? tr("deactivate") : tr("activate");
      button.addEventListener("click", () => updateRow("ah_plans", plan.id, { is_active: !plan.is_active }));
      line.append(name, state, button); group.append(line);
    }
    root.append(group);
  }
  if (!productMap.size) root.textContent = tr("empty");
}
function renderRegions(rows) {
  const root = $("regions-list"); root.replaceChildren();
  for (const region of rows) {
    const line = document.createElement("div"); line.className = "admin-catalog-line";
    const label = document.createElement("span"); label.textContent = `${region.name} · ${region.city}, ${region.country_code} · ${region.code}`;
    const state = document.createElement("span"); state.className = "admin-catalog-state"; state.textContent = tr(region.status === "active" ? "region_active" : region.status === "maintenance" ? "maintenance" : "region_inactive");
    const select = document.createElement("select"); select.className = "admin-region-select"; select.setAttribute("aria-label", region.name);
    for (const value of ["active", "inactive", "maintenance"]) {
      const option = document.createElement("option"); option.value = value;
      option.textContent = tr(value === "active" ? "set_active" : value === "inactive" ? "set_inactive" : "set_maintenance"); option.selected = region.status === value; select.append(option);
    }
    select.addEventListener("change", () => updateRow("ah_regions", region.id, { status: select.value }));
    line.append(label, state, select); root.append(line);
  }
  if (!rows.length) root.textContent = tr("empty");
}
async function updateRow(table, id, values) {
  if (busy) return;
  busy = true; show(nodes.error, "");
  try {
    const { error } = await supabase.from(table).update(values).eq("id", id);
    if (error) throw error;
    show(nodes.success, tr("updated")); await loadDashboard();
  } catch {
    show(nodes.error, tr("update_error"));
  } finally { busy = false; }
}
async function loadDashboard() {
  if (busy) return;
  busy = true; nodes.refresh.disabled = true; nodes.refresh.textContent = tr("refreshing");
  show(nodes.error, ""); show(nodes.success, "");
  try {
    const [orders, jobs, payments, products, plans, regions] = await Promise.all([
      supabase.from("ah_orders").select("id,user_id,status,currency,total_minor,created_at").order("created_at", { ascending: false }).limit(50),
      supabase.from("ah_provisioning_jobs").select("id,order_id,status,attempts,max_attempts,provider_reference,last_error_code,created_at").order("created_at", { ascending: false }).limit(30),
      supabase.from("ah_payment_events").select("id,provider,event_id,order_id,event_type,amount_minor,currency,received_at").order("received_at", { ascending: false }).limit(30),
      supabase.from("ah_products").select("id,slug,name,category,is_active,sort_order").order("sort_order"),
      supabase.from("ah_plans").select("id,product_id,code,name,price_minor,currency,billing_period,is_active,sort_order").order("sort_order"),
      supabase.from("ah_regions").select("id,code,name,city,country_code,status").order("name"),
    ]);
    const result = [orders, jobs, payments, products, plans, regions];
    if (result.some((entry) => entry.error)) throw new Error("query_failed");
    renderOrders(orders.data || []); renderJobs(jobs.data || []); renderPayments(payments.data || []);
    renderCatalog(products.data || [], plans.data || []); renderRegions(regions.data || []);
    setText("metric-orders", String((orders.data || []).length));
    setText("metric-paid", String((orders.data || []).filter((row) => row.status === "paid").length));
    setText("metric-queued", String((jobs.data || []).filter((row) => ["queued", "retry_wait", "processing"].includes(row.status)).length));
    setText("metric-plans", String((plans.data || []).filter((row) => row.is_active).length));
  } catch {
    show(nodes.error, tr("load_error"));
  } finally {
    busy = false; nodes.refresh.disabled = false; nodes.refresh.textContent = tr("refresh");
  }
}
async function initialize() {
  applyLanguage();
  if (!config.url || !config.anonKey) { show(nodes.setup, tr("setup_error")); return; }
  try {
    supabase = createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { nodes.login.hidden = false; return; }
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) { nodes.login.hidden = false; return; }
    if (user.app_metadata?.role !== "admin") { show(nodes.denied, tr("not_admin")); return; }
    setText("admin-email", user.email || user.id);
    nodes.app.hidden = false;
    await loadDashboard();
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") window.location.replace("account.html");
    });
  } catch {
    show(nodes.error, tr("load_error"));
  }
}
nodes.refresh.addEventListener("click", loadDashboard);
nodes.signout.addEventListener("click", async () => { if (!supabase) return; nodes.signout.disabled = true; await supabase.auth.signOut(); window.location.replace("account.html"); });
nodes.language.addEventListener("change", () => { language = languages.includes(nodes.language.value) ? nodes.language.value : "en"; localStorage.setItem("ah-language", language); applyLanguage(); if (!nodes.app.hidden) loadDashboard(); });
initialize();
