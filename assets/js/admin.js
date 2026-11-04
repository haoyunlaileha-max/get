import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window.AH_SUPABASE_CONFIG || {};
const $ = (id) => document.getElementById(id);
const nodes = {
  setup: $("admin-setup"), denied: $("admin-denied"), login: $("admin-login"),
  app: $("admin-app"), error: $("admin-error"), success: $("admin-success"),
  refresh: $("refresh-admin"), signout: $("admin-signout"), language: $("admin-language"),
};
const locale = window.AH_LOCALE;
const languages = ["zh-CN", "zh-TW"];
let language = locale.normalize(localStorage.getItem("ah-language") || "zh-CN");
let supabase;
let busy = false;
const orderPageSize = 20;
let orderPage = 0;
let orderSearch = "";
let orderStatus = "all";
let orderStartDate = "";
let orderEndDate = "";
let orderTotal = 0;
let categoryRows = [];

const t = {
en:{language:"Language",storefront:"Storefront",eyebrow:"OPERATIONS / CONTROL PLANE",title:"Operations console",subtitle:"Monitor orders, payments, provisioning and catalog availability.",refresh:"Refresh data",login_required:"Administrator sign-in required",login_copy:"Sign in with an account assigned the verified admin role, then return here.",open_account:"Open account sign-in",signed_in_as:"Signed in as",sign_out:"Sign out",orders:"Orders",all_records:"All records",paid:"Paid",paid_orders:"Paid orders",queued:"Provisioning queue",waiting_work:"Waiting / retrying",active:"Active plans",catalog:"Catalog",orders_title:"Recent orders",orders_desc:"Customer orders and their current lifecycle state.",order:"Order",customer:"Customer ID",status:"Status",total:"Total",created:"Created",jobs_title:"Provisioning jobs",jobs_desc:"Queue state, attempts and provider references.",payments_title:"Payment events",payments_desc:"Verified webhook audit records.",catalog_title:"Product catalog",catalog_desc:"Enable or disable products and plans. Price changes are intentionally not exposed here.",regions_title:"Data-center regions",regions_desc:"Control whether a region is available for new orders.",security_note:"Admin access is verified using Supabase app_metadata and enforced again by database RLS. Never share service-role keys with this page.",loading:"Loading operational data…",empty:"No records found.",load_error:"Could not load admin data. Check that migrations 0001–0005 are applied and admin RLS is enabled.",not_admin:"This account is not assigned the verified admin role. Ask an authorized project owner to set app_metadata.role = admin.",setup_error:"Add the Supabase project URL and public anon/publishable key to assets/js/supabase-config.js. Never add a service-role key.",enabled:"Enabled",disabled:"Disabled",activate:"Enable",deactivate:"Disable",region_active:"Active",region_inactive:"Inactive",maintenance:"Maintenance",set_active:"Set active",set_inactive:"Set inactive",set_maintenance:"Set maintenance",updated:"Saved successfully.",update_error:"Could not save this change. Verify database migrations and RLS policies.",reconciliation_required:"Manual reconciliation required",reconciliation_title:"Provisioning reconciliation",reconciliation_desc:"Provider resources created after an order changed state; review and clean up manually.",reconciliation_empty:"No jobs require manual reconciliation.",reconciliation_count:"Flagged jobs",reconciliation_overflow:"Showing the newest 100 flagged jobs. Export or inspect the database for older records.",no_jobs:"No provisioning jobs.",no_payments:"No payment events.",attempts:"Attempts",provider_ref:"Provider ref",event:"Event",amount:"Amount",refreshing:"Refreshing…",signing_out:"Signing out…",no_data:"No data"},
zh:{language:"语言",storefront:"网站首页",eyebrow:"运营 / 控制中心",title:"运营管理后台",subtitle:"监控订单、支付、服务器开通任务和商品目录。",refresh:"刷新数据",login_required:"需要管理员登录",login_copy:"请使用已被授予管理员角色的账户登录，然后返回此页面。",open_account:"打开账户登录",signed_in_as:"当前登录",sign_out:"退出登录",orders:"订单总数",all_records:"全部记录",paid:"已付款",paid_orders:"已付款订单",queued:"开通任务",waiting_work:"等待 / 重试中",active:"启用套餐",catalog:"商品目录",orders_title:"最近订单",orders_desc:"客户订单及当前生命周期状态。",order_search_label:"搜索订单 / 客户 UUID",order_date_from:"开始日期",order_date_to:"结束日期",date_range_invalid:"开始日期不能晚于结束日期，请检查日期范围。",order_status_filter:"订单状态",filter_all:"全部状态",search_orders:"搜索",clear_filters:"清除筛选",previous_page:"上一页",next_page:"下一页",search_invalid:"请输入完整的订单 UUID 或客户 UUID。",export_orders:"导出 CSV",exporting_orders:"正在导出…",orders_exported:"订单 CSV 已导出。",orders_export_limit:"已导出前 5,000 笔匹配订单；结果达到导出上限。",export_failed:"导出失败，请检查管理员权限和网络连接。",order:"订单",customer:"客户 ID",status:"状态",total:"总金额",created:"创建时间",jobs_title:"服务器开通任务",jobs_desc:"队列状态、尝试次数和供应商编号。",payments_title:"支付事件",payments_desc:"已验证的 Webhook 审计记录。",catalog_title:"商品目录",catalog_desc:"启用或停用产品与套餐。此处不开放价格修改。",regions_title:"数据中心",regions_desc:"控制机房是否可用于新订单。",security_note:"管理员身份通过 Supabase app_metadata 验证，并由数据库 RLS 再次执行权限控制。切勿向此页面提供 service-role 密钥。",loading:"正在加载运营数据…",empty:"没有记录。",load_error:"无法加载后台数据。请确认已执行 0001–0005 迁移并启用管理员 RLS。",not_admin:"此账户没有经过验证的管理员角色。请项目授权管理员设置 app_metadata.role = admin。",setup_error:"请在 assets/js/supabase-config.js 中填写 Supabase 项目 URL 和公开 anon/publishable key。切勿填写 service-role 密钥。",enabled:"已启用",disabled:"已停用",activate:"启用",deactivate:"停用",region_active:"运行中",region_inactive:"已停用",maintenance:"维护中",set_active:"设为运行中",set_inactive:"设为停用",set_maintenance:"设为维护",updated:"保存成功。",update_error:"保存失败，请检查数据库迁移和 RLS 权限。",reconciliation_required:"需要人工核对供应商资源",reconciliation_title:"开通异常对账",reconciliation_desc:"订单状态变化后供应商仍可能已创建资源；请人工核查并清理。",reconciliation_empty:"目前没有需要人工核对的开通任务。",reconciliation_count:"待核对任务",reconciliation_overflow:"这里只显示最新 100 条异常任务；更早记录请在数据库中查询。",no_jobs:"暂无开通任务。",no_payments:"暂无支付事件。",attempts:"尝试次数",provider_ref:"供应商编号",event:"事件",amount:"金额",refreshing:"刷新中…",signing_out:"正在退出…",no_data:"暂无数据"},
ar:{language:"اللغة",storefront:"المتجر",eyebrow:"العمليات / لوحة التحكم",title:"لوحة العمليات",subtitle:"مراقبة الطلبات والمدفوعات والتجهيز وتوفر الكتالوج.",refresh:"تحديث البيانات",login_required:"يلزم تسجيل دخول المسؤول",login_copy:"سجّل الدخول بحساب يحمل دور المسؤول الموثّق ثم عُد إلى هنا.",open_account:"فتح تسجيل الدخول",signed_in_as:"تم تسجيل الدخول باسم",sign_out:"تسجيل الخروج",orders:"الطلبات",all_records:"كل السجلات",paid:"مدفوع",paid_orders:"الطلبات المدفوعة",queued:"قائمة التجهيز",waiting_work:"قيد الانتظار / إعادة المحاولة",active:"الخطط النشطة",catalog:"الكتالوج",orders_title:"أحدث الطلبات",orders_desc:"طلبات العملاء وحالتها الحالية.",order:"الطلب",customer:"معرّف العميل",status:"الحالة",total:"الإجمالي",created:"تاريخ الإنشاء",jobs_title:"مهام التجهيز",jobs_desc:"حالة المهام والمحاولات ومراجع المزوّد.",payments_title:"أحداث الدفع",payments_desc:"سجلات إشعارات الدفع الموثّقة.",catalog_title:"كتالوج المنتجات",catalog_desc:"تفعيل المنتجات والخطط أو تعطيلها. لا يمكن تعديل الأسعار هنا.",regions_title:"مناطق مراكز البيانات",regions_desc:"التحكم في توفر المنطقة للطلبات الجديدة.",security_note:"يتم التحقق من دور المسؤول عبر app_metadata وتطبيقه أيضاً بواسطة RLS. لا تضع مفاتيح service-role هنا.",loading:"جارٍ تحميل بيانات العمليات…",empty:"لا توجد سجلات.",load_error:"تعذر تحميل البيانات. تحقق من تطبيق عمليات الترحيل 0001–0005 وسياسات RLS.",not_admin:"هذا الحساب ليس مسؤولاً موثّقاً.",setup_error:"أضف رابط Supabase والمفتاح العام إلى ملف الإعداد. لا تضع مفتاح service-role.",enabled:"مفعّل",disabled:"معطّل",activate:"تفعيل",deactivate:"تعطيل",region_active:"نشط",region_inactive:"غير نشط",maintenance:"صيانة",set_active:"تعيين نشط",set_inactive:"تعيين غير نشط",set_maintenance:"تعيين صيانة",updated:"تم الحفظ.",update_error:"تعذر الحفظ. تحقق من الترحيلات وسياسات RLS.",reconciliation_required:"تتطلب مطابقة يدوية مع المزوّد",reconciliation_title:"مطابقة مهام التجهيز",reconciliation_desc:"قد تكون موارد المزوّد أُنشئت بعد تغيّر حالة الطلب؛ راجعها ونظّفها يدوياً.",reconciliation_empty:"لا توجد مهام تتطلب مطابقة يدوية.",reconciliation_count:"المهام المعلّمة",reconciliation_overflow:"يتم عرض أحدث 100 مهمة فقط؛ راجع قاعدة البيانات للسجلات الأقدم.",no_jobs:"لا توجد مهام تجهيز.",no_payments:"لا توجد أحداث دفع.",attempts:"المحاولات",provider_ref:"مرجع المزوّد",event:"الحدث",amount:"المبلغ",refreshing:"جارٍ التحديث…",signing_out:"جارٍ تسجيل الخروج…",no_data:"لا توجد بيانات"},
fr:{language:"Langue",storefront:"Boutique",eyebrow:"OPÉRATIONS / CONTRÔLE",title:"Console d’exploitation",subtitle:"Suivez les commandes, paiements, déploiements et disponibilités du catalogue.",refresh:"Actualiser",login_required:"Connexion administrateur requise",login_copy:"Connectez-vous avec un compte doté du rôle administrateur vérifié.",open_account:"Ouvrir la connexion",signed_in_as:"Connecté en tant que",sign_out:"Déconnexion",orders:"Commandes",all_records:"Tous les enregistrements",paid:"Payées",paid_orders:"Commandes payées",queued:"File de déploiement",waiting_work:"En attente / nouvelle tentative",active:"Offres actives",catalog:"Catalogue",orders_title:"Commandes récentes",orders_desc:"Commandes clients et état actuel.",order:"Commande",customer:"ID client",status:"État",total:"Total",created:"Créée le",jobs_title:"Tâches de déploiement",jobs_desc:"État, tentatives et références fournisseur.",payments_title:"Événements de paiement",payments_desc:"Journaux des webhooks vérifiés.",catalog_title:"Catalogue produits",catalog_desc:"Activer ou désactiver produits et offres. Les prix ne sont pas modifiables ici.",regions_title:"Régions des centres de données",regions_desc:"Gérer la disponibilité des régions pour les nouvelles commandes.",security_note:"Le rôle administrateur est vérifié via app_metadata et imposé par RLS. Ne placez jamais de clé service-role ici.",loading:"Chargement des données…",empty:"Aucun enregistrement.",load_error:"Chargement impossible. Vérifiez les migrations 0001–0005 et les règles RLS.",not_admin:"Ce compte ne possède pas le rôle administrateur vérifié.",setup_error:"Configurez l’URL Supabase et la clé publique dans le fichier de configuration. Jamais de clé service-role.",enabled:"Activé",disabled:"Désactivé",activate:"Activer",deactivate:"Désactiver",region_active:"Actif",region_inactive:"Inactif",maintenance:"Maintenance",set_active:"Définir actif",set_inactive:"Définir inactif",set_maintenance:"Définir maintenance",updated:"Enregistré.",update_error:"Échec de l’enregistrement. Vérifiez les migrations et RLS.",reconciliation_required:"Rapprochement manuel requis",reconciliation_title:"Rapprochement du provisionnement",reconciliation_desc:"Des ressources fournisseur peuvent exister après un changement d’état de commande ; vérifiez-les et nettoyez-les manuellement.",reconciliation_empty:"Aucune tâche ne nécessite de rapprochement manuel.",reconciliation_count:"Tâches signalées",reconciliation_overflow:"Les 100 tâches les plus récentes sont affichées ; consultez la base pour les anciennes.",no_jobs:"Aucune tâche.",no_payments:"Aucun événement.",attempts:"Tentatives",provider_ref:"Réf. fournisseur",event:"Événement",amount:"Montant",refreshing:"Actualisation…",signing_out:"Déconnexion…",no_data:"Aucune donnée"},
ru:{language:"Язык",storefront:"Магазин",eyebrow:"ОПЕРАЦИИ / ПАНЕЛЬ УПРАВЛЕНИЯ",title:"Панель операций",subtitle:"Заказы, платежи, развёртывание серверов и доступность каталога.",refresh:"Обновить данные",login_required:"Требуется вход администратора",login_copy:"Войдите под учётной записью с подтверждённой ролью администратора.",open_account:"Открыть вход",signed_in_as:"Выполнен вход:",sign_out:"Выйти",orders:"Заказы",all_records:"Все записи",paid:"Оплачено",paid_orders:"Оплаченные заказы",queued:"Очередь развёртывания",waiting_work:"Ожидание / повтор",active:"Активные тарифы",catalog:"Каталог",orders_title:"Последние заказы",orders_desc:"Заказы клиентов и их текущий статус.",order:"Заказ",customer:"ID клиента",status:"Статус",total:"Сумма",created:"Создан",jobs_title:"Задачи развёртывания",jobs_desc:"Статус, попытки и ссылки провайдера.",payments_title:"Платёжные события",payments_desc:"Проверенные записи webhook.",catalog_title:"Каталог продуктов",catalog_desc:"Включение и отключение продуктов и тарифов. Изменение цен здесь недоступно.",regions_title:"Регионы дата-центров",regions_desc:"Управление доступностью регионов для новых заказов.",security_note:"Роль администратора проверяется через app_metadata и дополнительно ограничивается RLS. Не добавляйте service-role ключ.",loading:"Загрузка данных…",empty:"Записей нет.",load_error:"Не удалось загрузить данные. Проверьте миграции 0001–0005 и RLS.",not_admin:"У этой учётной записи нет подтверждённой роли администратора.",setup_error:"Укажите URL Supabase и публичный ключ в файле конфигурации. Не используйте service-role ключ.",enabled:"Включено",disabled:"Отключено",activate:"Включить",deactivate:"Отключить",region_active:"Активен",region_inactive:"Неактивен",maintenance:"Обслуживание",set_active:"Сделать активным",set_inactive:"Отключить",set_maintenance:"Обслуживание",updated:"Сохранено.",update_error:"Не удалось сохранить. Проверьте миграции и RLS.",reconciliation_required:"Требуется ручная сверка с провайдером",reconciliation_title:"Сверка развёртывания",reconciliation_desc:"Ресурс провайдера мог быть создан после изменения статуса заказа; проверьте и удалите его вручную.",reconciliation_empty:"Нет задач, требующих ручной сверки.",reconciliation_count:"Помеченные задачи",reconciliation_overflow:"Показаны последние 100 задач; более ранние записи доступны в базе данных.",no_jobs:"Задач нет.",no_payments:"Событий нет.",attempts:"Попытки",provider_ref:"ID провайдера",event:"Событие",amount:"Сумма",refreshing:"Обновление…",signing_out:"Выход…",no_data:"Нет данных"},
es:{language:"Idioma",storefront:"Tienda",eyebrow:"OPERACIONES / CONTROL",title:"Consola de operaciones",subtitle:"Supervisa pedidos, pagos, aprovisionamiento y disponibilidad del catálogo.",refresh:"Actualizar datos",login_required:"Se requiere acceso de administrador",login_copy:"Inicia sesión con una cuenta que tenga el rol de administrador verificado.",open_account:"Abrir inicio de sesión",signed_in_as:"Sesión de",sign_out:"Cerrar sesión",orders:"Pedidos",all_records:"Todos los registros",paid:"Pagados",paid_orders:"Pedidos pagados",queued:"Cola de aprovisionamiento",waiting_work:"En espera / reintento",active:"Planes activos",catalog:"Catálogo",orders_title:"Pedidos recientes",orders_desc:"Pedidos de clientes y estado actual.",order:"Pedido",customer:"ID de cliente",status:"Estado",total:"Total",created:"Creado",jobs_title:"Tareas de aprovisionamiento",jobs_desc:"Estado, intentos y referencias del proveedor.",payments_title:"Eventos de pago",payments_desc:"Registros de webhooks verificados.",catalog_title:"Catálogo de productos",catalog_desc:"Activar o desactivar productos y planes. Los precios no se modifican aquí.",regions_title:"Regiones de centros de datos",regions_desc:"Controla la disponibilidad de regiones para nuevos pedidos.",security_note:"El rol de administrador se verifica mediante app_metadata y RLS. Nunca incluyas claves service-role aquí.",loading:"Cargando datos…",empty:"No hay registros.",load_error:"No se pudieron cargar los datos. Comprueba las migraciones 0001–0005 y RLS.",not_admin:"Esta cuenta no tiene el rol de administrador verificado.",setup_error:"Configura la URL de Supabase y la clave pública. Nunca uses la clave service-role.",enabled:"Activo",disabled:"Inactivo",activate:"Activar",deactivate:"Desactivar",region_active:"Activa",region_inactive:"Inactiva",maintenance:"Mantenimiento",set_active:"Marcar activa",set_inactive:"Marcar inactiva",set_maintenance:"Mantenimiento",updated:"Guardado.",update_error:"No se pudo guardar. Comprueba migraciones y RLS.",reconciliation_required:"Se requiere conciliación manual",reconciliation_title:"Conciliación de aprovisionamiento",reconciliation_desc:"El proveedor puede haber creado recursos tras cambiar el estado del pedido; revíselos y elimínelos manualmente.",reconciliation_empty:"No hay tareas que requieran conciliación manual.",reconciliation_count:"Tareas marcadas",reconciliation_overflow:"Se muestran las 100 tareas más recientes; consulta la base de datos para las anteriores.",no_jobs:"No hay tareas.",no_payments:"No hay eventos.",attempts:"Intentos",provider_ref:"Referencia proveedor",event:"Evento",amount:"Importe",refreshing:"Actualizando…",signing_out:"Cerrando sesión…",no_data:"Sin datos"}
};


const inventoryText = {"en":{"inventory_title":"Plan availability by data center","inventory_desc":"Assign plans to regions and control sale status and capacity.","inventory_plan":"Plan","inventory_region":"Data-center region","inventory_capacity":"Capacity (units; blank = unlimited)","inventory_available":"Available for new orders","inventory_save":"Save region assignment","inventory_safety":"Allocated units are calculated from non-terminal orders and cannot be edited here. Capacity changes never delete or alter orders. Blank capacity means unlimited.","inventory_unlimited":"Unlimited","inventory_allocated":"Allocated","inventory_remaining":"Remaining","inventory_migration":"Apply migration 0006 to manage plan-region inventory.","inventory_edit":"Edit assignment","inventory_none":"No plan-region assignments yet.","inventory_saved":"Region assignment saved.","inventory_failed":"Could not save assignment. Check duplicate plan/region pairs and admin RLS."},"zh":{"inventory_title":"套餐机房与库存管理","inventory_desc":"为套餐指定可销售机房，并控制销售状态和容量上限。","inventory_plan":"套餐","inventory_region":"数据中心机房","inventory_capacity":"容量（台；留空表示不限量）","inventory_available":"允许新订单购买","inventory_save":"保存机房关联","inventory_safety":"已分配数量根据未终结订单自动计算，不能在此手动修改。调整容量不会删除或修改订单。容量留空表示不限量。","inventory_unlimited":"不限量","inventory_allocated":"已分配","inventory_remaining":"剩余","inventory_migration":"请先执行数据库迁移 0006，才能管理套餐机房库存。","inventory_edit":"编辑关联","inventory_none":"暂时没有套餐机房关联。","inventory_saved":"机房关联已保存。","inventory_failed":"保存失败，请检查套餐与机房是否重复关联以及管理员 RLS 权限。"},"ar":{"inventory_title":"توفر الخطط حسب مركز البيانات","inventory_desc":"اربط الخطط بالمناطق وتحكم في حالة البيع والسعة.","inventory_plan":"الخطة","inventory_region":"منطقة مركز البيانات","inventory_capacity":"السعة؛ فارغ = غير محدود","inventory_available":"متاح للطلبات الجديدة","inventory_save":"حفظ الربط","inventory_safety":"يُحسب العدد المخصص من الطلبات غير النهائية ولا يمكن تعديله هنا. السعة الفارغة تعني غير محدود.","inventory_unlimited":"غير محدود","inventory_allocated":"مخصص","inventory_remaining":"متبقٍ","inventory_migration":"طبّق ترحيل قاعدة البيانات 0006 لإدارة المخزون.","inventory_edit":"تعديل الربط","inventory_none":"لا توجد روابط بعد.","inventory_saved":"تم حفظ الربط.","inventory_failed":"تعذر الحفظ؛ تحقق من التكرار وسياسات RLS."},"fr":{"inventory_title":"Disponibilité des offres par centre","inventory_desc":"Associez les offres aux régions et gérez leur disponibilité et capacité.","inventory_plan":"Offre","inventory_region":"Région du centre","inventory_capacity":"Capacité (unités ; vide = illimitée)","inventory_available":"Disponible pour les nouvelles commandes","inventory_save":"Enregistrer l’affectation","inventory_safety":"Les unités allouées sont calculées depuis les commandes non terminées et ne sont pas modifiables ici. Une capacité vide signifie illimitée.","inventory_unlimited":"Illimitée","inventory_allocated":"Allouées","inventory_remaining":"Restantes","inventory_migration":"Appliquez la migration 0006 pour gérer les stocks.","inventory_edit":"Modifier","inventory_none":"Aucune affectation pour le moment.","inventory_saved":"Affectation enregistrée.","inventory_failed":"Échec. Vérifiez les doublons et les règles RLS."},"ru":{"inventory_title":"Доступность тарифов по дата-центрам","inventory_desc":"Назначайте тарифы регионам и управляйте продажами и ёмкостью.","inventory_plan":"Тариф","inventory_region":"Регион дата-центра","inventory_capacity":"Вместимость (шт.; пусто = без ограничений)","inventory_available":"Доступно для новых заказов","inventory_save":"Сохранить привязку","inventory_safety":"Занятые единицы рассчитываются по незавершённым заказам и не редактируются здесь. Пустая вместимость означает отсутствие лимита.","inventory_unlimited":"Без ограничений","inventory_allocated":"Занято","inventory_remaining":"Осталось","inventory_migration":"Примените миграцию 0006 для управления запасами.","inventory_edit":"Изменить","inventory_none":"Привязок пока нет.","inventory_saved":"Привязка сохранена.","inventory_failed":"Ошибка. Проверьте дубликаты и RLS."},"es":{"inventory_title":"Disponibilidad de planes por centro de datos","inventory_desc":"Asigna planes a regiones y controla su disponibilidad y capacidad.","inventory_plan":"Plan","inventory_region":"Región del centro de datos","inventory_capacity":"Capacidad (unidades; vacío = ilimitada)","inventory_available":"Disponible para nuevos pedidos","inventory_save":"Guardar asignación","inventory_safety":"Las unidades asignadas se calculan a partir de pedidos no terminales y no se pueden editar aquí. Capacidad vacía significa ilimitada.","inventory_unlimited":"Ilimitada","inventory_allocated":"Asignadas","inventory_remaining":"Restantes","inventory_migration":"Aplica la migración 0006 para gestionar el inventario.","inventory_edit":"Editar asignación","inventory_none":"Aún no hay asignaciones.","inventory_saved":"Asignación guardada.","inventory_failed":"No se pudo guardar. Comprueba duplicados y RLS."}};
const editorText = {
  en:{catalog_manage:"Manage products and plans",catalog_manage_desc:"Create or edit catalog entries. New entries are inactive until explicitly enabled.",product_editor_title:"Product details",product_name:"Product name",product_slug:"Slug",product_category:"Category",description:"Description",sort_order:"Sort order",publish_product:"Publish product immediately",save_product:"Save product",clear_form:"Clear",plan_editor_title:"Plan details",plan_product:"Product",plan_name:"Plan name",plan_code:"Unique plan code",price:"Price (major currency units)",currency:"Currency",billing_period:"Billing period",specs_json:"Specifications (JSON)",publish_plan:"Publish plan immediately",save_plan:"Save plan",edit:"Edit",catalog_safety:"New entries start unpublished by default. Existing prices change only when you edit and save that plan.",invalid_specs:"Specifications must be a valid JSON object.",saved:"Catalog entry saved.",save_failed:"Could not save catalog entry. Check unique slug/code constraints and admin RLS."},
  zh:{catalog_manage:"商品与套餐管理",catalog_manage_desc:"新增或编辑目录项目；新项目默认停用，需明确启用后才会展示。",product_editor_title:"产品信息",product_name:"产品名称",product_slug:"网址标识（slug）",product_category:"产品类别",description:"描述",sort_order:"排序",publish_product:"保存后立即上架",save_product:"保存产品",clear_form:"清空",plan_editor_title:"套餐信息",plan_product:"所属产品",plan_name:"套餐名称",plan_code:"唯一套餐代码",price:"价格（主要货币单位）",currency:"货币代码",billing_period:"计费周期",specs_json:"规格参数（JSON）",publish_plan:"保存后立即上架",save_plan:"保存套餐",edit:"编辑",catalog_safety:"新项目默认不发布。只有编辑并保存对应套餐时才会更改其价格。",invalid_specs:"规格必须是有效的 JSON 对象。",saved:"商品目录已保存。",save_failed:"保存失败，请检查 slug/code 是否重复以及管理员 RLS 权限。"},
  ar:{catalog_manage:"إدارة المنتجات والخطط",catalog_manage_desc:"إنشاء عناصر الكتالوج أو تعديلها؛ العناصر الجديدة غير نشطة افتراضياً.",product_editor_title:"تفاصيل المنتج",product_name:"اسم المنتج",product_slug:"المعرّف",product_category:"الفئة",description:"الوصف",sort_order:"الترتيب",publish_product:"نشر المنتج فوراً",save_product:"حفظ المنتج",clear_form:"مسح",plan_editor_title:"تفاصيل الخطة",plan_product:"المنتج",plan_name:"اسم الخطة",plan_code:"رمز فريد",price:"السعر",currency:"العملة",billing_period:"دورة الفوترة",specs_json:"المواصفات (JSON)",publish_plan:"نشر الخطة فوراً",save_plan:"حفظ الخطة",edit:"تعديل",catalog_safety:"العناصر الجديدة غير منشورة افتراضياً. لا يتغير السعر إلا عند تعديل الخطة وحفظها.",invalid_specs:"يجب أن تكون المواصفات كائن JSON صالحاً.",saved:"تم حفظ الكتالوج.",save_failed:"تعذر الحفظ؛ تحقق من الرمز الفريد وسياسات RLS."},
  fr:{catalog_manage:"Gérer les produits et offres",catalog_manage_desc:"Créer ou modifier le catalogue. Les nouveaux éléments sont désactivés par défaut.",product_editor_title:"Détails du produit",product_name:"Nom du produit",product_slug:"Identifiant",product_category:"Catégorie",description:"Description",sort_order:"Ordre",publish_product:"Publier immédiatement",save_product:"Enregistrer le produit",clear_form:"Effacer",plan_editor_title:"Détails de l’offre",plan_product:"Produit",plan_name:"Nom de l’offre",plan_code:"Code unique",price:"Prix",currency:"Devise",billing_period:"Période de facturation",specs_json:"Caractéristiques (JSON)",publish_plan:"Publier immédiatement",save_plan:"Enregistrer l’offre",edit:"Modifier",catalog_safety:"Les nouveaux éléments sont désactivés par défaut. Un prix ne change qu’après modification et enregistrement.",invalid_specs:"Les caractéristiques doivent être un objet JSON valide.",saved:"Catalogue enregistré.",save_failed:"Échec. Vérifiez l’unicité du code et les règles RLS."},
  ru:{catalog_manage:"Управление товарами и тарифами",catalog_manage_desc:"Создание и редактирование каталога. Новые записи по умолчанию выключены.",product_editor_title:"Данные продукта",product_name:"Название продукта",product_slug:"Идентификатор",product_category:"Категория",description:"Описание",sort_order:"Порядок",publish_product:"Опубликовать сразу",save_product:"Сохранить продукт",clear_form:"Очистить",plan_editor_title:"Данные тарифа",plan_product:"Продукт",plan_name:"Название тарифа",plan_code:"Уникальный код",price:"Цена",currency:"Валюта",billing_period:"Период оплаты",specs_json:"Характеристики (JSON)",publish_plan:"Опубликовать сразу",save_plan:"Сохранить тариф",edit:"Изменить",catalog_safety:"Новые записи по умолчанию скрыты. Цена меняется только после редактирования и сохранения тарифа.",invalid_specs:"Характеристики должны быть корректным JSON-объектом.",saved:"Каталог сохранён.",save_failed:"Ошибка сохранения. Проверьте уникальность кода и RLS."},
  es:{catalog_manage:"Gestionar productos y planes",catalog_manage_desc:"Crear o editar el catálogo. Los elementos nuevos están desactivados por defecto.",product_editor_title:"Datos del producto",product_name:"Nombre del producto",product_slug:"Identificador",product_category:"Categoría",description:"Descripción",sort_order:"Orden",publish_product:"Publicar inmediatamente",save_product:"Guardar producto",clear_form:"Limpiar",plan_editor_title:"Datos del plan",plan_product:"Producto",plan_name:"Nombre del plan",plan_code:"Código único",price:"Precio",currency:"Moneda",billing_period:"Periodo de facturación",specs_json:"Especificaciones (JSON)",publish_plan:"Publicar inmediatamente",save_plan:"Guardar plan",edit:"Editar",catalog_safety:"Los elementos nuevos empiezan desactivados. El precio solo cambia al editar y guardar el plan.",invalid_specs:"Las especificaciones deben ser un objeto JSON válido.",saved:"Catálogo guardado.",save_failed:"No se pudo guardar. Comprueba el código único y RLS."}
};
function editorTr(key) { const value = inventoryText.zh[key] || editorText.zh[key] || inventoryText.en[key] || editorText.en[key] || key; return locale.text(value, language); }
function formValues(form) { return Object.fromEntries(new FormData(form).entries()); }
function fillProductEditor(product) {
  const form = $("product-editor"); form.reset();
  for (const key of ["id","name","slug","category_id","description","sort_order","image_path"]) form.elements.namedItem(key).value = product?.[key] ?? (key === "sort_order" ? 0 : "");
  form.elements.is_active.checked = Boolean(product?.is_active);
  $("product-category").value=product?.category_id||$("product-category").options[0]?.value||"";
  const preview=$("product-image-preview");preview.replaceChildren();
  if(product?.image_path){const image=document.createElement("img");image.src=supabase.storage.from("product-images").getPublicUrl(product.image_path).data.publicUrl;image.alt=product.name||"商品图片";preview.append(image);const note=document.createElement("span");note.textContent="当前商品图片";preview.append(note);}
  else preview.textContent="尚未上传商品图片";
  form.scrollIntoView({ behavior:"smooth", block:"center" });
}
function fillPlanEditor(plan) {
  const form = $("plan-editor"); form.reset();
  const productSelect = $("plan-product");
  productSelect.value = plan?.product_id || productSelect.options[0]?.value || "";
  for (const key of ["id","name","code","currency","billing_period","description","sort_order"]) form.elements.namedItem(key).value = plan?.[key] ?? ({currency:"USDT",billing_period:"monthly",sort_order:0}[key] ?? "");
  form.elements.price.value = plan ? (Number(plan.price_minor)/100).toFixed(2) : "0.00";
  form.elements.specs.value = JSON.stringify(plan?.specs || {cpu:"2 vCPU",ram:"4 GB",storage:"80 GB NVMe",bandwidth:"4 TB",os_options:["Ubuntu 24.04","Debian 12"]},null,2);
  form.elements.is_active.checked = Boolean(plan?.is_active);
  form.scrollIntoView({ behavior:"smooth", block:"center" });
}
function renderProductOptions(products) {
  const select = $("plan-product"); const previous = select.value;
  select.replaceChildren();
  for (const product of products) { const option = document.createElement("option"); option.value = product.id; option.textContent = product.name; select.append(option); }
  if (products.some((p)=>p.id===previous)) select.value=previous;
}
function renderProductCategoryOptions(rows) {
  const select=$("product-category");const previous=select.value;select.replaceChildren();
  for(const row of rows){const option=document.createElement("option");option.value=row.id;option.textContent=row.name+(row.is_active?"":"（停用）");select.append(option);}
  if(rows.some(row=>row.id===previous))select.value=previous;
}
function fillCategoryEditor(row){
  const form=$("category-editor");form.reset();
  for(const key of ["id","name","slug","description","sort_order"])form.elements.namedItem(key).value=row?.[key]??(key==="sort_order"?0:"");
  form.elements.is_active.checked=Boolean(row?.is_active);
  form.elements.slug.readOnly=Boolean(row?.id);
  form.scrollIntoView({behavior:"smooth",block:"center"});
}
function renderCategories(rows){
  const root=$("category-list");root.replaceChildren();renderProductCategoryOptions(rows);
  if(!rows.length){root.textContent="暂无分类";return;}
  for(const row of rows){
    const line=document.createElement("div");line.className="admin-catalog-line";
    const label=document.createElement("span");label.textContent=row.name+" · "+row.slug+" · 排序 "+row.sort_order;
    const state=document.createElement("span");state.className="admin-catalog-state";state.textContent=row.is_active?"已启用":"已停用";
    const edit=document.createElement("button");edit.type="button";edit.className="admin-toggle";edit.textContent="编辑";edit.addEventListener("click",()=>fillCategoryEditor(row));
    const toggle=document.createElement("button");toggle.type="button";toggle.className="admin-toggle";toggle.textContent=row.is_active?"停用":"启用";toggle.addEventListener("click",()=>updateRow("ah_product_categories",row.id,{is_active:!row.is_active}));
    line.append(label,state,edit,toggle);root.append(line);
  }
}
async function saveCategory(form){
  if(busy)return;
  const values=formValues(form);const slug=String(values.slug||"").trim().toLowerCase();const sort=Number(values.sort_order||0);
  if(!values.name?.trim()||values.name.trim().length>80||! /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(slug)||!Number.isSafeInteger(sort)||sort<0||sort>100000){show(nodes.error,"分类名称、slug 或排序不符合要求。");return;}
  const payload={name:values.name.trim(),slug,description:values.description.trim()||null,sort_order:sort,is_active:form.elements.is_active.checked};
  busy=true;show(nodes.error,"");show(nodes.success,"");
  try{const query=values.id?supabase.from("ah_product_categories").update(payload).eq("id",values.id):supabase.from("ah_product_categories").insert(payload);const {error}=await query;if(error)throw error;show(nodes.success,"商品分类已保存。");form.reset();form.elements.sort_order.value="0";form.elements.slug.readOnly=false;busy=false;await loadDashboard();}
  catch{show(nodes.error,"分类保存失败，请检查 slug 是否重复及管理员权限。");}
  finally{busy=false;}
}
$("product-editor").elements.image_file.addEventListener("change",()=>{
  const file=$("product-editor").elements.image_file.files?.[0];const preview=$("product-image-preview");preview.replaceChildren();
  if(!file){preview.textContent="尚未选择新图片";return;}
  if(!["image/jpeg","image/png","image/webp","image/avif"].includes(file.type)||file.size>5*1024*1024){preview.textContent="图片格式不支持或文件超过 5 MB。";return;}
  const image=document.createElement("img");image.src=URL.createObjectURL(file);image.alt="商品图片预览";preview.append(image);
});

async function saveCatalog(form, table) {
  if (busy) return;
  const values = formValues(form); const id = values.id || null;
  let payload; let uploadedPath=null; let previousPath=null;
  if (table === "ah_products") {
    const category=categoryRows.find(row=>row.id===values.category_id);
    if(!category){show(nodes.error,"请先创建并选择有效商品分类。");return;}
    payload = {name:values.name.trim(),slug:values.slug.trim().toLowerCase(),category:category.slug,category_id:category.id,description:values.description.trim()||null,sort_order:Number(values.sort_order||0),is_active:form.elements.is_active.checked,image_path:values.image_path||null};
    previousPath=values.image_path||null;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.slug) || !Number.isSafeInteger(payload.sort_order) || payload.sort_order<0) { show(nodes.error,editorTr("save_failed")); return; }
    const file=form.elements.image_file.files?.[0];
    if(file){
      const allowed=["image/jpeg","image/png","image/webp","image/avif"];
      if(!allowed.includes(file.type)||file.size>5*1024*1024){show(nodes.error,"图片格式不支持或文件超过 5 MB。");return;}
    }
  } else {
    let specs;
    try { specs=JSON.parse(values.specs); } catch { show(nodes.error,editorTr("invalid_specs")); return; }
    if (!specs || Array.isArray(specs) || typeof specs!=="object") { show(nodes.error,editorTr("invalid_specs")); return; }
    const price=Number(values.price); const priceMinor=Math.round(price*100); const currency="USDT";
    if (!Number.isFinite(price)||price<0||priceMinor>Number.MAX_SAFE_INTEGER||currency!=="USDT"||!Number.isSafeInteger(Number(values.sort_order))||Number(values.sort_order)<0) { show(nodes.error,editorTr("save_failed")); return; }
    payload={product_id:values.product_id,name:values.name.trim(),code:values.code.trim(),description:values.description.trim()||null,price_minor:priceMinor,currency,billing_period:values.billing_period,specs,sort_order:Number(values.sort_order||0),is_active:form.elements.is_active.checked};
    if(!/^[A-Za-z0-9_-]+$/.test(payload.code)||!payload.product_id) { show(nodes.error,editorTr("save_failed")); return; }
  }
  busy=true; show(nodes.error,""); show(nodes.success,"");
  try {
    if(table==="ah_products"){
      const file=form.elements.image_file.files?.[0];
      if(file){
        const extension=({ "image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/avif":"avif" })[file.type];
        uploadedPath="products/"+crypto.randomUUID()+"."+extension;
        const {error:uploadError}=await supabase.storage.from("product-images").upload(uploadedPath,file,{contentType:file.type,cacheControl:"31536000",upsert:false});
        if(uploadError)throw uploadError;
        payload.image_path=uploadedPath;
      }
    }
    const query=id ? supabase.from(table).update(payload).eq("id",id) : supabase.from(table).insert(payload);
    const {error}=await query;
    if(error) throw error;
    if(uploadedPath&&previousPath&&previousPath!==uploadedPath)await supabase.storage.from("product-images").remove([previousPath]);
    show(nodes.success,editorTr("saved")); form.reset();
    if(table==="ah_products") form.elements.sort_order.value="0";
    if(table==="ah_plans") { form.elements.currency.value="USDT"; form.elements.price.value="0"; form.elements.sort_order.value="0"; }
    busy=false; await loadDashboard();
  } catch {
    if(uploadedPath)await supabase.storage.from("product-images").remove([uploadedPath]);
    show(nodes.error,editorTr("save_failed"));
  } finally { busy=false; }
}


function renderInventoryOptions(plans, regions) {
  const planSelect=$("inventory-plan"), regionSelect=$("inventory-region");
  const previousPlan=planSelect.value, previousRegion=regionSelect.value;
  planSelect.replaceChildren(); regionSelect.replaceChildren();
  for(const plan of plans){const option=document.createElement("option");option.value=plan.id;option.textContent=plan.name+" · "+plan.code;planSelect.append(option);}
  for(const region of regions){const option=document.createElement("option");option.value=region.id;option.textContent=region.name+" · "+region.city+" ("+region.code+")";regionSelect.append(option);}
  if(plans.some(p=>p.id===previousPlan))planSelect.value=previousPlan;
  if(regions.some(r=>r.id===previousRegion))regionSelect.value=previousRegion;
}
function fillInventoryEditor(row) {
  const form=$("plan-region-editor"); form.reset();
  form.elements.id.value=row?.id||"";
  $("inventory-plan").value=row?.plan_id||$("inventory-plan").options[0]?.value||"";
  $("inventory-region").value=row?.region_id||$("inventory-region").options[0]?.value||"";
  form.elements.capacity_units.value=row?.capacity_units??"";
  form.elements.is_available.checked=Boolean(row?.is_available);
  form.scrollIntoView({behavior:"smooth",block:"center"});
}
function renderPlanRegions(rows, plans, regions) {
  renderInventoryOptions(plans,regions);
  const root=$("plan-region-list");root.replaceChildren();
  if(!rows){root.textContent=editorTr("inventory_migration");return;}
  if(!rows.length){root.textContent=editorTr("inventory_none");return;}
  const planMap=new Map(plans.map(p=>[p.id,p]));
  const regionMap=new Map(regions.map(r=>[r.id,r]));
  for(const row of rows){
    const plan=planMap.get(row.plan_id),region=regionMap.get(row.region_id);
    const line=document.createElement("div");line.className="admin-catalog-line";
    const label=document.createElement("span");label.textContent=(plan?.name||row.plan_id.slice(0,8))+" · "+(region?.name||row.region_id.slice(0,8));
    const stats=document.createElement("small");
    const capacity=row.capacity_units===null?editorTr("inventory_unlimited"):String(row.capacity_units);
    const remaining=row.capacity_units===null?editorTr("inventory_unlimited"):String(Math.max(0,Number(row.capacity_units)-Number(row.allocated_units)));
    stats.textContent=editorTr("inventory_allocated")+": "+row.allocated_units+" / "+capacity+" · "+editorTr("inventory_remaining")+": "+remaining;
    const state=document.createElement("span");state.className="admin-catalog-state";state.textContent=row.is_available?tr("enabled"):tr("disabled");
    const edit=document.createElement("button");edit.className="admin-toggle";edit.type="button";edit.textContent=editorTr("inventory_edit");edit.addEventListener("click",()=>fillInventoryEditor(row));
    line.append(label,stats,state,edit);root.append(line);
  }
}
async function saveInventory(form) {
  if(busy)return;
  const values=formValues(form);
  const capacityText=values.capacity_units.trim();
  const capacity=capacityText===""?null:Number(capacityText);
  if(!values.plan_id||!values.region_id||(capacity!==null&&(!Number.isSafeInteger(capacity)||capacity<0||capacity>2147483647))){show(nodes.error,editorTr("inventory_failed"));return;}
  const payload={plan_id:values.plan_id,region_id:values.region_id,capacity_units:capacity,is_available:form.elements.is_available.checked};
  busy=true;show(nodes.error,"");show(nodes.success,"");
  try{
    let query;
    if(values.id)query=supabase.from("ah_plan_regions").update(payload).eq("id",values.id);
    else query=supabase.from("ah_plan_regions").upsert(payload,{onConflict:"plan_id,region_id"});
    const {error}=await query;if(error)throw error;
    show(nodes.success,editorTr("inventory_saved"));form.reset();
    busy=false;await loadDashboard();
  }catch{show(nodes.error,editorTr("inventory_failed"));}
  finally{busy=false;}
}

function tr(key) { return locale.text(t.zh[key] || t.en[key] || key, language); }
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
const adminStatusLabels = {
  draft:"草稿",pending:"待处理",awaiting_payment:"待付款",paid:"已付款",
  provisioning:"开通中",active:"运行中",suspended:"已暂停",cancelled:"已取消",
  failed:"失败",refunded:"已退款",queued:"排队中",processing:"处理中",
  retry_wait:"等待重试",succeeded:"成功",rejected:"已拒绝"
};
function statusPill(value) {
  const status = String(value || "unknown");
  const label = adminStatusLabels[status] || status.replaceAll("_", " ");
  return `<span class="admin-status status-${escapeHtml(status)}">${escapeHtml(locale.text(label, language))}</span>`;
}
function applyLanguage() {
  document.documentElement.lang = language;
  document.documentElement.dir = "ltr";
  document.querySelectorAll("[data-i]").forEach((node) => { const value = tr(node.dataset.i); node.textContent = value === node.dataset.i ? editorTr(node.dataset.i) : value; });
  nodes.language.value = language;
  locale.apply(document.body, language);
}
function renderOrderPagination() {
  const start = orderTotal ? orderPage * orderPageSize + 1 : 0;
  const end = Math.min((orderPage + 1) * orderPageSize, orderTotal);
  $("orders-page-label").textContent = `${start}–${end} / ${orderTotal}`;
  $("orders-prev").disabled = orderPage <= 0 || busy;
  $("orders-next").disabled = (orderPage + 1) * orderPageSize >= orderTotal || busy;
}
function renderOrders(rows) {
  $("orders-count").textContent = String(orderTotal);
  $("orders-body").replaceChildren();
  if (!rows.length) {
    const row = document.createElement("tr"); const cell = document.createElement("td");
    cell.colSpan = 6; cell.textContent = tr("empty"); row.append(cell); $("orders-body").append(row); return;
  }
  for (const order of rows) {
    const row = document.createElement("tr");
    const values = [String(order.id).slice(0, 8).toUpperCase(), String(order.user_id).slice(0, 8), "", money(order.total_minor, order.currency), date(order.created_at)];
    for (const value of values) { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }
    row.children[2].innerHTML = statusPill(order.status);
    const detailCell = document.createElement("td");
    const details = document.createElement("details"); details.className = "admin-order-details";
    const summary = document.createElement("summary"); summary.textContent = locale.text("查看详情", language);
    details.append(summary);
    const body = document.createElement("div"); body.className = "admin-order-detail-body";
    const addLine = (label, value) => {
      const line = document.createElement("p");
      const strong = document.createElement("strong"); strong.textContent = locale.text(label, language) + "：";
      const span = document.createElement("span"); span.textContent = value || "—";
      line.append(strong, span); body.append(line);
    };
    addLine("完整订单编号", order.id);
    addLine("更新时间", date(order.updated_at));
    if (order.expires_at) addLine("订单有效期至", date(order.expires_at));
    if (order.paid_at) addLine("付款确认时间", date(order.paid_at));
    const region = order.ah_regions;
    if (region) addLine("数据中心", [region.name, region.city, region.country_code].filter(Boolean).join(" · "));
    if (order.customer_note) addLine("客户配置备注", order.customer_note);
    const items = document.createElement("ul"); items.className = "admin-order-items";
    for (const item of order.ah_order_items || []) {
      const li = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = item.description_snapshot + " × " + item.quantity;
      const price = document.createElement("span");
      price.textContent = money(Number(item.unit_price_minor) * Number(item.quantity), order.currency);
      li.append(title, price);
      if (item.configuration && Object.keys(item.configuration).length) {
        const config = document.createElement("small");
        config.textContent = JSON.stringify(item.configuration);
        li.append(config);
      }
      items.append(li);
    }
    if (items.childElementCount) body.append(items);
    else addLine("商品明细", "暂无商品明细");
    details.append(body); detailCell.append(details); row.append(detailCell);
    $("orders-body").append(row);
  }
  renderOrderPagination();
}
function renderJobs(rows) {
  const root = $("jobs-list"); root.replaceChildren();
  if (!rows.length) { root.textContent = tr("no_jobs"); return; }
  for (const job of rows) {
    const item = document.createElement("article"); item.className = "admin-record";
    item.innerHTML = `<div class="admin-record-top"><strong>${escapeHtml(String(job.order_id).slice(0, 8))}</strong>${statusPill(job.status)}</div><small>${escapeHtml(tr("attempts"))}: ${Number(job.attempts) || 0}/${Number(job.max_attempts) || 0}</small><small>${escapeHtml(tr("provider_ref"))}: ${escapeHtml(job.provider_reference || "—")}</small>${job.requires_reconciliation ? `<strong class="admin-warning">${escapeHtml(tr("reconciliation_required"))}</strong>` : ""}<small>${escapeHtml(job.last_error_code || "")}</small>`;
    root.append(item);
  }
}
function renderReconciliation(rows, total) {
  const root = $("reconciliation-list"); root.replaceChildren();
  setText("reconciliation-count", String(total));
  if (!rows.length) { root.textContent = tr("reconciliation_empty"); return; }
  for (const job of rows) {
    const item = document.createElement("article"); item.className = "admin-record";
    item.innerHTML = `<div class="admin-record-top"><strong>${escapeHtml(String(job.order_id).slice(0, 8))}</strong>${statusPill(job.status)}</div><small>${escapeHtml(tr("provider_ref"))}: ${escapeHtml(job.provider_reference || "—")}</small><strong class="admin-warning">${escapeHtml(tr("reconciliation_required"))}</strong><small>${escapeHtml(job.last_error_code || "")}</small><small>${escapeHtml(date(job.created_at))}</small>`;
    root.append(item);
  }
  if (total > rows.length) {
    const note = document.createElement("small"); note.className = "admin-warning";
    note.textContent = tr("reconciliation_overflow"); root.append(note);
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
  renderProductOptions(products);
  renderProductCategoryOptions(categoryRows);
  const productMap = new Map(products.map((product) => [product.id, product]));
  for (const product of products) {
    const group = document.createElement("div"); group.className = "admin-catalog-group";
    const head = document.createElement("div"); head.className = "admin-catalog-head";
    const label = document.createElement("div");
    const title=document.createElement("strong");title.textContent=product.name;
    const meta=document.createElement("small");meta.textContent=(categoryRows.find(row=>row.id===product.category_id)?.name||product.category)+" · "+product.slug;
    label.append(title,meta);
    if(product.image_path){const thumb=document.createElement("img");thumb.className="admin-product-thumb";thumb.src=supabase.storage.from("product-images").getPublicUrl(product.image_path).data.publicUrl;thumb.alt=product.name;head.append(thumb);}
    const toggle = document.createElement("button"); toggle.className = "admin-toggle"; toggle.type = "button";
    toggle.textContent = product.is_active ? tr("deactivate") : tr("activate");
    toggle.addEventListener("click", () => updateRow("ah_products", product.id, { is_active: !product.is_active }));
    const editProduct=document.createElement("button"); editProduct.className="admin-toggle"; editProduct.type="button"; editProduct.textContent=editorTr("edit"); editProduct.addEventListener("click",()=>fillProductEditor(product));
    head.append(label, editProduct, toggle); group.append(head);
    for (const plan of plans.filter((entry) => entry.product_id === product.id)) {
      const line = document.createElement("div"); line.className = "admin-catalog-line";
      const name = document.createElement("span"); name.textContent = `${plan.name} · ${money(plan.price_minor, plan.currency)} / ${plan.billing_period}`;
      const state = document.createElement("span"); state.className = "admin-catalog-state"; state.textContent = plan.is_active ? tr("enabled") : tr("disabled");
      const button = document.createElement("button"); button.className = "admin-toggle"; button.type = "button";
      button.textContent = plan.is_active ? tr("deactivate") : tr("activate");
      button.addEventListener("click", () => updateRow("ah_plans", plan.id, { is_active: !plan.is_active }));
      const editPlan=document.createElement("button"); editPlan.className="admin-toggle"; editPlan.type="button"; editPlan.textContent=editorTr("edit"); editPlan.addEventListener("click",()=>fillPlanEditor(plan));
      line.append(name, state, editPlan, button); group.append(line);
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
function renderLaunchReadiness(products, plans, regions, mappings, assets) {
  const activeProducts = products.filter((row) => row.is_active);
  const activeProductIds = new Set(activeProducts.map((row) => row.id));
  const activePlans = plans.filter((row) => row.is_active && activeProductIds.has(row.product_id));
  const activePlanIds = new Set(activePlans.map((row) => row.id));
  const activeRegions = regions.filter((row) => row.status === "active");
  const activeRegionIds = new Set(activeRegions.map((row) => row.id));
  const sellableMappings = mappings.filter((row) =>
    row.is_available &&
    activePlanIds.has(row.plan_id) &&
    activeRegionIds.has(row.region_id) &&
    (row.capacity_units === null || Number(row.allocated_units) < Number(row.capacity_units))
  );
  const readyAssets = assets.filter((row) => row.listener_enabled && row.listener_status === "ready");
  setText("metric-live-products", String(activeProducts.length));
  setText("metric-live-plans", String(activePlans.length));
  setText("metric-live-regions", String(activeRegions.length));
  setText("metric-sellable-mappings", String(sellableMappings.length));
  setText("metric-ready-assets", String(readyAssets.length) + " / " + String(assets.length));

  const blockers = [];
  if (!activeProducts.length) blockers.push("没有已发布产品");
  if (!activePlans.length) blockers.push("没有已发布套餐");
  if (!activeRegions.length) blockers.push("没有已启用的真实机房");
  if (!sellableMappings.length) blockers.push("没有仍有容量的套餐 / 机房关联");
  if (readyAssets.length !== assets.length || !readyAssets.length) blockers.push("部分主网收款监听未就绪");
  const note = $("launch-readiness-state");
  if (note) {
    note.textContent = blockers.length
      ? "当前状态：主网收款监听 " + readyAssets.length + "/" + assets.length + " 就绪；服务器商品销售尚未开放。待处理：" + blockers.join("；") + "。不要录入演示价格或未确认的供应商库存。"
      : "目录与库存检查通过：已发布产品、套餐、启用机房及可售关联均存在，且所有配置资产监听就绪。收款后仍由管理员人工履约；本检查不代表供应商 SLA 或真实付款验收。";
  }
}

async function saveRegion(form) {
  if (busy) return;
  const values = formValues(form);
  const payload = {
    code: String(values.code || "").trim().toUpperCase(),
    name: String(values.name || "").trim(),
    city: String(values.city || "").trim(),
    country_code: String(values.country_code || "").trim().toUpperCase(),
    status: ["inactive", "maintenance", "active"].includes(values.status) ? values.status : "inactive",
  };
  if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(payload.code) ||
      !payload.name || payload.name.length > 100 ||
      !payload.city || payload.city.length > 100 ||
      !/^[A-Z]{2}$/.test(payload.country_code)) {
    show(nodes.error, "机房代码、名称、城市或 ISO 两位国家代码格式不正确。");
    return;
  }
  busy = true; show(nodes.error, ""); show(nodes.success, "");
  try {
    const { error } = await supabase.from("ah_regions").insert(payload);
    if (error) throw error;
    show(nodes.success, "机房记录已创建。新机房仅在供应商和实际库存确认后才应启用。");
    form.reset();
    busy = false;
    await loadDashboard();
  } catch (error) {
    show(nodes.error, error?.code === "23505" ? "机房代码已存在，请使用唯一代码。" : "机房创建失败，请检查管理员权限和数据库状态。");
  } finally { busy = false; }
}

async function updateRow(table, id, values) {
  if (busy) return;
  busy = true; show(nodes.error, "");
  try {
    const { error } = await supabase.from(table).update(values).eq("id", id);
    if (error) throw error;
    show(nodes.success, tr("updated"));
    busy = false;
    await loadDashboard();
  } catch {
    show(nodes.error, tr("update_error"));
  } finally { busy = false; }
}
function getOrderDateBounds() {
  if (orderStartDate && !/^\d{4}-\d{2}-\d{2}$/.test(orderStartDate)) throw new Error("invalid_date");
  if (orderEndDate && !/^\d{4}-\d{2}-\d{2}$/.test(orderEndDate)) throw new Error("invalid_date");
  if (orderStartDate && orderEndDate && orderStartDate > orderEndDate) throw new Error("invalid_date");
  const start = orderStartDate ? new Date(orderStartDate + "T00:00:00") : null;
  const end = orderEndDate ? new Date(orderEndDate + "T00:00:00") : null;
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) throw new Error("invalid_date");
  const localDateKey = (value) => value ? [value.getFullYear(), String(value.getMonth()+1).padStart(2,"0"), String(value.getDate()).padStart(2,"0")].join("-") : "";
  if (start && localDateKey(start) !== orderStartDate) throw new Error("invalid_date");
  if (end && localDateKey(end) !== orderEndDate) throw new Error("invalid_date");
  if (end) end.setDate(end.getDate() + 1);
  return { start: start?.toISOString(), end: end?.toISOString() };
}
function applyOrderDateFilters(query, bounds) {
  if (bounds.start) query = query.gte("created_at", bounds.start);
  if (bounds.end) query = query.lt("created_at", bounds.end);
  return query;
}
function csvCell(value) {
  let textValue = String(value ?? "");
  if (/^\s*[=+@\-]/.test(textValue)) textValue = "'" + textValue;
  return '"' + textValue.replace(/"/g, '""') + '"';
}
async function exportOrders() {
  if (busy) return;
  if (orderSearch && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderSearch)) {
    show(nodes.error, tr("search_invalid")); return;
  }
  busy = true;
  const button = $("export-orders");
  button.disabled = true;
  const previousLabel = button.textContent;
  button.textContent = tr("exporting_orders");
  show(nodes.error, ""); show(nodes.success, "");
  try {
    const dateBounds = getOrderDateBounds();
    const batchSize = 500;
    const exportLimit = 5000;
    const rows = [];
    let expectedCount = 0;
    for (let offset = 0; offset < exportLimit; offset += batchSize) {
      let query = supabase.from("ah_orders")
        .select("id,user_id,status,currency,total_minor,created_at,updated_at,ah_regions(name,city,country_code)", { count: offset === 0 ? "exact" : undefined })
        .order("created_at", { ascending: false });
      if (orderStatus !== "all") query = query.eq("status", orderStatus);
      if (orderSearch) query = query.or("id.eq." + orderSearch + ",user_id.eq." + orderSearch);
      query = applyOrderDateFilters(query, dateBounds);
      const { data, error, count } = await query.range(offset, offset + batchSize - 1);
      if (error) throw error;
      if (offset === 0) expectedCount = count ?? (data || []).length;
      rows.push(...(data || []));
      if (!data || data.length < batchSize || rows.length >= expectedCount) break;
    }
    const headers = ["订单 UUID","客户 UUID","订单状态","币种","总金额","创建时间","更新时间","数据中心"];
    const lines = [headers, ...rows.map((order) => {
      const region = Array.isArray(order.ah_regions) ? order.ah_regions[0] : order.ah_regions;
      return [order.id, order.user_id, adminStatusLabels[order.status] || order.status,
        order.currency, (Number(order.total_minor || 0) / 100).toFixed(2),
        order.created_at, order.updated_at,
        [region?.name, region?.city, region?.country_code].filter(Boolean).join(" / ")];
    })].map((line) => line.map(csvCell).join(","));
    const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "anonymous-hosting-orders-" + new Date().toISOString().slice(0,10) + ".csv";
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    show(nodes.success, expectedCount > exportLimit ? tr("orders_export_limit") : tr("orders_exported"));
  } catch (error) {
    show(nodes.error, error?.message === "invalid_date" ? tr("date_range_invalid") : tr("export_failed"));
  } finally {
    busy = false;
    button.disabled = false;
    button.textContent = previousLabel;
    renderOrderPagination();
    nodes.refresh.disabled = false;
  }
}
async function loadDashboard() {
  if (busy) return;
  busy = true; nodes.refresh.disabled = true; nodes.refresh.textContent = tr("refreshing");
  show(nodes.error, ""); show(nodes.success, "");
  try {
    const dateBounds = getOrderDateBounds();
    let ordersQuery = supabase.from("ah_orders").select("id,user_id,region_id,status,currency,total_minor,created_at,updated_at,paid_at,customer_note,ah_order_items(description_snapshot,quantity,unit_price_minor,configuration),ah_regions(name,city,country_code)", { count: "exact" }).order("created_at", { ascending: false });
    if (orderStatus !== "all") ordersQuery = ordersQuery.eq("status", orderStatus);
    ordersQuery = applyOrderDateFilters(ordersQuery, dateBounds);
    if (orderSearch) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderSearch)) {
        show(nodes.error, tr("search_invalid")); return;
      }
      ordersQuery = ordersQuery.or(`id.eq.${orderSearch},user_id.eq.${orderSearch}`);
    }
    ordersQuery = ordersQuery.range(orderPage * orderPageSize, (orderPage + 1) * orderPageSize - 1);
    const [orders, jobs, reconciliationJobs, payments, products, plans, regions, categories, ordersCount, paidCount, queuedCount, activePlansCount, mappings, cryptoAssets] = await Promise.all([
      ordersQuery,
      supabase.from("ah_provisioning_jobs").select("id,order_id,status,attempts,max_attempts,provider_reference,requires_reconciliation,last_error_code,created_at").order("created_at", { ascending: false }).limit(30),
      supabase.from("ah_provisioning_jobs").select("id,order_id,status,provider_reference,requires_reconciliation,last_error_code,created_at", { count: "exact" }).eq("requires_reconciliation", true).order("created_at", { ascending: false }).limit(100),
      supabase.from("ah_payment_events").select("id,provider,event_id,order_id,event_type,amount_minor,currency,received_at").order("received_at", { ascending: false }).limit(30),
      supabase.from("ah_products").select("id,slug,name,category,category_id,image_path,description,is_active,sort_order").order("sort_order"),
      supabase.from("ah_plans").select("id,product_id,code,name,description,price_minor,currency,billing_period,specs,is_active,sort_order").order("sort_order"),
      supabase.from("ah_regions").select("id,code,name,city,country_code,status").order("name"),
      supabase.from("ah_product_categories").select("id,slug,name,description,sort_order,is_active").order("sort_order"),
      supabase.from("ah_orders").select("*", { count: "exact", head: true }),
      supabase.from("ah_orders").select("*", { count: "exact", head: true }).eq("status", "paid"),
      supabase.from("ah_provisioning_jobs").select("*", { count: "exact", head: true }).in("status", ["queued", "retry_wait", "processing"]),
      supabase.from("ah_plans").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("ah_plan_regions").select("id,plan_id,region_id,is_available,capacity_units,allocated_units").order("created_at", { ascending: false }),
      supabase.from("ah_crypto_assets").select("asset_code,listener_enabled,listener_status").order("asset_code"),
    ]);
    const result = [orders, jobs, reconciliationJobs, payments, products, plans, regions, categories, ordersCount, paidCount, queuedCount, activePlansCount, cryptoAssets];
    if (result.some((entry) => entry.error)) throw new Error("query_failed");
    const mappingRows = mappings.error ? null : (mappings.data || []);
    orderTotal = orders.count ?? 0;
    renderOrders(orders.data || []); renderJobs(jobs.data || []); renderReconciliation(reconciliationJobs.data || [], reconciliationJobs.count ?? 0); renderPayments(payments.data || []);
    categoryRows=categories.data||[];renderCategories(categoryRows);renderCatalog(products.data || [], plans.data || []); renderRegions(regions.data || []); renderPlanRegions(mappingRows, plans.data || [], regions.data || []); renderLaunchReadiness(products.data || [], plans.data || [], regions.data || [], mappingRows || [], cryptoAssets.data || []);
    setText("metric-orders", String(ordersCount.count ?? 0));
    setText("metric-paid", String(paidCount.count ?? 0));
    setText("metric-queued", String(queuedCount.count ?? 0));
    setText("metric-plans", String(activePlansCount.count ?? 0));
  } catch {
    show(nodes.error, tr("load_error"));
  } finally {
    busy = false; nodes.refresh.disabled = false; nodes.refresh.textContent = tr("refresh"); renderOrderPagination();
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
$("category-editor").addEventListener("submit",(event)=>{event.preventDefault();saveCategory(event.currentTarget);});
$("category-editor").addEventListener("reset",()=>{setTimeout(()=>{$("category-editor").elements.sort_order.value="0";$("category-editor").elements.slug.readOnly=false;},0);});
$("product-editor").addEventListener("submit",(event)=>{event.preventDefault();saveCatalog(event.currentTarget,"ah_products");});
$("plan-editor").addEventListener("submit",(event)=>{event.preventDefault();saveCatalog(event.currentTarget,"ah_plans");});
$("plan-region-editor").addEventListener("submit",(event)=>{event.preventDefault();saveInventory(event.currentTarget);});
$("region-editor").addEventListener("submit",(event)=>{event.preventDefault();saveRegion(event.currentTarget);});
$("product-editor").addEventListener("reset",()=>{setTimeout(()=>{ $("product-editor").elements.sort_order.value="0"; $("product-image-preview").textContent="尚未上传商品图片"; },0);});
$("plan-editor").addEventListener("reset",()=>{setTimeout(()=>{ $("plan-editor").elements.currency.value="USDT"; $("plan-editor").elements.price.value="0"; $("plan-editor").elements.sort_order.value="0"; },0);});
$("orders-filter").addEventListener("submit", (event) => {
  event.preventDefault();
  orderSearch = $("order-search").value.trim();
  orderStatus = $("order-status-filter").value || "all";
  orderStartDate = $("order-date-from").value;
  orderEndDate = $("order-date-to").value;
  orderPage = 0;
  loadDashboard();
});
$("clear-order-filters").addEventListener("click", () => {
  $("order-search").value = "";
  $("order-status-filter").value = "all";
  $("order-date-from").value = "";
  $("order-date-to").value = "";
  orderSearch = "";
  orderStatus = "all";
  orderStartDate = "";
  orderEndDate = "";
  orderPage = 0;
  loadDashboard();
});
$("orders-prev").addEventListener("click", () => {
  if (orderPage > 0 && !busy) { orderPage -= 1; loadDashboard(); }
});
$("orders-next").addEventListener("click", () => {
  if ((orderPage + 1) * orderPageSize < orderTotal && !busy) { orderPage += 1; loadDashboard(); }
});
$("export-orders").addEventListener("click", exportOrders);
nodes.refresh.addEventListener("click", loadDashboard);
nodes.signout.addEventListener("click", async () => { if (!supabase) return; nodes.signout.disabled = true; await supabase.auth.signOut(); window.location.replace("account.html"); });
nodes.language.addEventListener("change", () => { language = languages.includes(nodes.language.value) ? nodes.language.value : "zh-CN"; localStorage.setItem("ah-language", language); applyLanguage(); if (!nodes.app.hidden) loadDashboard(); });
initialize();
