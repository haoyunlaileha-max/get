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
const profileForm = document.getElementById("profile-form");
const profileSave = document.getElementById("profile-save");
const profileState = document.getElementById("profile-state");
const languageSelect = document.getElementById("account-language");
let supabase;
let mode = "login";
let activeUserId = null;
let language = localStorage.getItem("ah-language") || "en";

const messages = {
en:{portal:"CUSTOMER PORTAL",your_account:"Your account",intro:"Sign in to manage your hosting services and view your orders.",language_label:"Language",back_store:"← Back to storefront",setup_text:"Authentication is not connected yet. Add your Supabase project URL and public anon/publishable key in",setup_suffix:"to enable secure sign-in. Never put a service-role key here.",sign_in:"Sign in",create_account:"Create account",email:"Email address",password:"Password",show:"Show",hide:"Hide",sign_in_secure:"Sign in securely",create_account_btn:"Create account",reset_password:"Send password reset email",authenticated:"Authenticated customer",profile_title:"Profile",display_name:"Display name",save_profile:"Save profile",your_orders:"Your orders",loading_orders:"Loading your orders…",sign_out:"Sign out",privacy_note:"Your credentials are sent directly to your configured Supabase project over HTTPS. This portal does not store passwords in this website.",enter_email:"Enter your email address first.",reset_sending:"Sending…",reset_sent:"If the address is registered, a password reset email will be sent.",signed_out:"You have been signed out.",signup_check:"Account created. Check your email to confirm your address before signing in.",no_orders:"No orders yet. Orders will appear here after checkout is connected.",orders_error:"Your account is signed in, but orders could not be loaded. Check that the database migration has been applied and its RLS policies are active.",profile_loading:"Loading profile…",profile_saved:"Profile saved.",profile_error:"Could not load or save your profile. Check that the database migration is applied and profile RLS is enabled.",profile_saving:"Saving…",signed_user:"Signed-in user",generic_error:"Something went wrong. Please try again.",init_error:"Supabase could not be initialized. Verify the project URL and public anon/publishable key, then reload."},
zh:{portal:"客户中心",your_account:"账户中心",intro:"登录以管理托管服务并查看订单。",language_label:"语言",back_store:"← 返回产品首页",setup_text:"尚未连接身份验证。请在",setup_suffix:"中填写 Supabase 项目 URL 和公开 anon/publishable key，以启用安全登录。切勿填写 service-role 密钥。",sign_in:"登录",create_account:"创建账户",email:"电子邮箱",password:"密码",show:"显示",hide:"隐藏",sign_in_secure:"安全登录",create_account_btn:"创建账户",reset_password:"发送密码重置邮件",authenticated:"已验证客户",profile_title:"个人资料",display_name:"显示名称",save_profile:"保存资料",your_orders:"我的订单",loading_orders:"正在加载订单…",sign_out:"退出登录",privacy_note:"账户凭据通过 HTTPS 直接发送到你配置的 Supabase 项目。本网站不会存储你的密码。",enter_email:"请先输入电子邮箱。",reset_sending:"发送中…",reset_sent:"如果该邮箱已注册，系统将发送密码重置邮件。",signed_out:"你已成功退出登录。",signup_check:"账户已创建，请检查邮箱并完成验证后再登录。",no_orders:"暂无订单。接入结账功能后，订单会显示在这里。",orders_error:"已登录，但无法加载订单。请检查数据库迁移是否执行以及 RLS 策略是否启用。",profile_loading:"正在加载资料…",profile_saved:"资料已保存。",profile_error:"无法加载或保存资料。请检查数据库迁移和个人资料 RLS 权限。",profile_saving:"保存中…",signed_user:"已登录客户",generic_error:"发生错误，请重试。",init_error:"无法初始化 Supabase。请检查项目 URL 和公开 anon/publishable key 后刷新页面。"},
ar:{portal:"بوابة العملاء",your_account:"حسابك",intro:"سجّل الدخول لإدارة خدمات الاستضافة وعرض طلباتك.",language_label:"اللغة",back_store:"العودة إلى المتجر ←",setup_text:"لم يتم ربط المصادقة بعد. أضف رابط مشروع Supabase والمفتاح العام في",setup_suffix:"لتفعيل تسجيل الدخول الآمن. لا تضع مفتاح service-role هنا.",sign_in:"تسجيل الدخول",create_account:"إنشاء حساب",email:"البريد الإلكتروني",password:"كلمة المرور",show:"إظهار",hide:"إخفاء",sign_in_secure:"تسجيل دخول آمن",create_account_btn:"إنشاء حساب",reset_password:"إرسال رابط إعادة تعيين كلمة المرور",authenticated:"عميل موثّق",profile_title:"الملف الشخصي",display_name:"الاسم المعروض",save_profile:"حفظ الملف الشخصي",your_orders:"طلباتك",loading_orders:"جارٍ تحميل الطلبات…",sign_out:"تسجيل الخروج",privacy_note:"تُرسل بيانات اعتمادك مباشرةً إلى مشروع Supabase عبر HTTPS. لا يخزّن هذا الموقع كلمات المرور.",enter_email:"أدخل بريدك الإلكتروني أولاً.",reset_sending:"جارٍ الإرسال…",reset_sent:"إذا كان العنوان مسجلاً فستُرسل رسالة لإعادة تعيين كلمة المرور.",signed_out:"تم تسجيل خروجك.",signup_check:"تم إنشاء الحساب. تحقق من بريدك لتأكيد العنوان قبل تسجيل الدخول.",no_orders:"لا توجد طلبات بعد. ستظهر الطلبات هنا بعد تفعيل الدفع.",orders_error:"تم تسجيل الدخول، لكن تعذر تحميل الطلبات. تحقق من تطبيق ترحيل قاعدة البيانات وسياسات RLS.",profile_loading:"جارٍ تحميل الملف الشخصي…",profile_saved:"تم حفظ الملف الشخصي.",profile_error:"تعذر تحميل الملف الشخصي أو حفظه. تحقق من الترحيل وسياسات RLS.",profile_saving:"جارٍ الحفظ…",signed_user:"مستخدم مسجل الدخول",generic_error:"حدث خطأ. حاول مرة أخرى.",init_error:"تعذر تهيئة Supabase. تحقق من الرابط والمفتاح العام ثم أعد التحميل."},
fr:{portal:"ESPACE CLIENT",your_account:"Votre compte",intro:"Connectez-vous pour gérer vos services et consulter vos commandes.",language_label:"Langue",back_store:"← Retour à la boutique",setup_text:"L’authentification n’est pas encore connectée. Ajoutez l’URL du projet Supabase et la clé publique dans",setup_suffix:"pour activer la connexion. Ne placez jamais de clé service-role ici.",sign_in:"Connexion",create_account:"Créer un compte",email:"Adresse e-mail",password:"Mot de passe",show:"Afficher",hide:"Masquer",sign_in_secure:"Connexion sécurisée",create_account_btn:"Créer un compte",reset_password:"Envoyer un e-mail de réinitialisation",authenticated:"Client authentifié",profile_title:"Profil",display_name:"Nom affiché",save_profile:"Enregistrer le profil",your_orders:"Vos commandes",loading_orders:"Chargement des commandes…",sign_out:"Déconnexion",privacy_note:"Vos identifiants sont envoyés directement à votre projet Supabase via HTTPS. Ce site ne stocke pas vos mots de passe.",enter_email:"Saisissez d’abord votre adresse e-mail.",reset_sending:"Envoi…",reset_sent:"Si cette adresse est enregistrée, un e-mail de réinitialisation sera envoyé.",signed_out:"Vous êtes déconnecté.",signup_check:"Compte créé. Vérifiez votre e-mail avant de vous connecter.",no_orders:"Aucune commande. Elles apparaîtront ici lorsque le paiement sera activé.",orders_error:"Connecté, mais impossible de charger les commandes. Vérifiez la migration et les règles RLS.",profile_loading:"Chargement du profil…",profile_saved:"Profil enregistré.",profile_error:"Impossible de charger ou d’enregistrer le profil. Vérifiez la migration et les règles RLS.",profile_saving:"Enregistrement…",signed_user:"Client connecté",generic_error:"Une erreur est survenue. Réessayez.",init_error:"Impossible d’initialiser Supabase. Vérifiez l’URL et la clé publique, puis rechargez."},
ru:{portal:"КАБИНЕТ КЛИЕНТА",your_account:"Ваш аккаунт",intro:"Войдите, чтобы управлять услугами хостинга и просматривать заказы.",language_label:"Язык",back_store:"← На главную",setup_text:"Авторизация ещё не подключена. Добавьте URL проекта Supabase и публичный ключ в",setup_suffix:"для безопасного входа. Не размещайте здесь service-role ключ.",sign_in:"Войти",create_account:"Создать аккаунт",email:"Электронная почта",password:"Пароль",show:"Показать",hide:"Скрыть",sign_in_secure:"Безопасный вход",create_account_btn:"Создать аккаунт",reset_password:"Отправить письмо для сброса пароля",authenticated:"Проверенный клиент",profile_title:"Профиль",display_name:"Отображаемое имя",save_profile:"Сохранить профиль",your_orders:"Ваши заказы",loading_orders:"Загрузка заказов…",sign_out:"Выйти",privacy_note:"Данные для входа отправляются напрямую в ваш проект Supabase по HTTPS. Сайт не хранит пароли.",enter_email:"Сначала введите адрес электронной почты.",reset_sending:"Отправка…",reset_sent:"Если адрес зарегистрирован, будет отправлено письмо для сброса пароля.",signed_out:"Вы вышли из системы.",signup_check:"Аккаунт создан. Подтвердите адрес в письме перед входом.",no_orders:"Заказов пока нет. Они появятся после подключения оплаты.",orders_error:"Вход выполнен, но заказы не загружены. Проверьте миграцию базы и политики RLS.",profile_loading:"Загрузка профиля…",profile_saved:"Профиль сохранён.",profile_error:"Не удалось загрузить или сохранить профиль. Проверьте миграцию и политики RLS.",profile_saving:"Сохранение…",signed_user:"Вошедший пользователь",generic_error:"Произошла ошибка. Попробуйте ещё раз.",init_error:"Не удалось подключить Supabase. Проверьте URL и публичный ключ и обновите страницу."},
es:{portal:"PORTAL DEL CLIENTE",your_account:"Tu cuenta",intro:"Inicia sesión para administrar tus servicios y consultar tus pedidos.",language_label:"Idioma",back_store:"← Volver a la tienda",setup_text:"La autenticación aún no está conectada. Añade la URL del proyecto Supabase y la clave pública en",setup_suffix:"para activar el acceso seguro. Nunca incluyas aquí una clave service-role.",sign_in:"Iniciar sesión",create_account:"Crear cuenta",email:"Correo electrónico",password:"Contraseña",show:"Mostrar",hide:"Ocultar",sign_in_secure:"Acceso seguro",create_account_btn:"Crear cuenta",reset_password:"Enviar correo para restablecer contraseña",authenticated:"Cliente autenticado",profile_title:"Perfil",display_name:"Nombre visible",save_profile:"Guardar perfil",your_orders:"Tus pedidos",loading_orders:"Cargando pedidos…",sign_out:"Cerrar sesión",privacy_note:"Tus credenciales se envían directamente a tu proyecto Supabase mediante HTTPS. Este sitio no almacena contraseñas.",enter_email:"Introduce primero tu correo electrónico.",reset_sending:"Enviando…",reset_sent:"Si la dirección está registrada, recibirás un correo para restablecer la contraseña.",signed_out:"Has cerrado sesión.",signup_check:"Cuenta creada. Confirma tu correo antes de iniciar sesión.",no_orders:"Aún no hay pedidos. Aparecerán aquí cuando se conecte el pago.",orders_error:"Has iniciado sesión, pero no se pudieron cargar los pedidos. Comprueba la migración y las políticas RLS.",profile_loading:"Cargando perfil…",profile_saved:"Perfil guardado.",profile_error:"No se pudo cargar o guardar el perfil. Comprueba la migración y las políticas RLS.",profile_saving:"Guardando…",signed_user:"Cliente conectado",generic_error:"Se produjo un error. Inténtalo de nuevo.",init_error:"No se pudo iniciar Supabase. Comprueba la URL y la clave pública y vuelve a cargar."}
};
function tr(key){return messages[language]?.[key] || messages.en[key] || key;}
function applyLanguage(code){
  language=messages[code]?code:"en";
  document.documentElement.lang=language;
  document.documentElement.dir=language==="ar"?"rtl":"ltr";
  document.querySelectorAll("[data-i]").forEach(el=>{const value=tr(el.dataset.i);if(value)el.textContent=value;});
  languageSelect.value=language;
  localStorage.setItem("ah-language",language);
  document.getElementById("auth-submit").textContent=mode==="login"?tr("sign_in_secure"):tr("create_account_btn");
  document.getElementById("toggle-password").textContent=document.getElementById("auth-password").type==="password"?tr("show"):tr("hide");
  document.getElementById("reset-password").textContent=tr("reset_password");
}
languageSelect.addEventListener("change",()=>applyLanguage(languageSelect.value));
applyLanguage(language);

function message(target,value){target.textContent=value;target.hidden=!value;}
function setBusy(button,busy,busyText,idleText){button.disabled=busy;button.setAttribute("aria-busy",String(busy));button.textContent=busy?busyText:idleText;}
function setMode(next){
  mode=next;const login=mode==="login";
  document.getElementById("login-tab").classList.toggle("active",login);
  document.getElementById("signup-tab").classList.toggle("active",!login);
  document.getElementById("login-tab").setAttribute("aria-selected",String(login));
  document.getElementById("signup-tab").setAttribute("aria-selected",String(!login));
  document.getElementById("auth-password").autocomplete=login?"current-password":"new-password";
  setBusy(submitButton,false,"",login?tr("sign_in_secure"):tr("create_account_btn"));
  message(authError,"");message(authSuccess,"");
}
function formatMoney(minor,currency){
  try{return new Intl.NumberFormat(language,{style:"currency",currency}).format(Number(minor)/100);}
  catch{return (Number(minor)/100).toFixed(2)+" "+currency;}
}
function renderOrderItem(row,currency){
  const line=document.createElement("li");
  const label=document.createElement("span");
  label.textContent=row.description_snapshot+(row.quantity>1?" × "+row.quantity:"");
  const price=document.createElement("strong");
  price.textContent=formatMoney(Number(row.unit_price_minor)*Number(row.quantity),currency);
  line.append(label,price);return line;
}
async function loadProfile(userId){
  profileState.textContent=tr("profile_loading");
  const {data,error}=await supabase.from("ah_profiles").select("display_name").eq("id",userId).maybeSingle();
  if(activeUserId!==userId)return;
  if(error){profileState.textContent=tr("profile_error");return;}
  document.getElementById("profile-name").value=data?.display_name||"";
  profileState.textContent="";
}
async function renderSession(session){
  if(!session){activeUserId=null;dashboard.hidden=true;authPanel.hidden=false;return;}
  const userId=session.user.id;activeUserId=userId;
  authPanel.hidden=true;dashboard.hidden=false;
  document.getElementById("account-email").textContent=session.user.email||tr("signed_user");
  ordersState.hidden=false;ordersState.textContent=tr("loading_orders");ordersList.replaceChildren();
  await loadProfile(userId);
  const {data,error}=await supabase.from("ah_orders").select("id,status,currency,total_minor,created_at,ah_order_items(description_snapshot,quantity,unit_price_minor)").eq("user_id",userId).order("created_at",{ascending:false}).limit(20);
  if(activeUserId!==userId)return;
  if(error){ordersState.textContent=tr("orders_error");return;}
  if(!data?.length){ordersState.textContent=tr("no_orders");return;}
  ordersState.hidden=true;
  for(const order of data){
    const item=document.createElement("article");item.className="order-row";
    const details=document.createElement("div");
    const id=document.createElement("strong");id.textContent="Order "+order.id.slice(0,8).toUpperCase();
    const date=document.createElement("small");date.textContent=new Date(order.created_at).toLocaleString(language);
    details.append(id,date);
    const meta=document.createElement("div");meta.className="order-meta";
    const status=document.createElement("span");status.className="order-status";status.textContent=String(order.status).replaceAll("_"," ");
    const total=document.createElement("strong");total.textContent=formatMoney(order.total_minor,order.currency);
    meta.append(status,total);item.append(details,meta);
    const lines=document.createElement("ul");lines.className="order-items";
    for(const row of order.ah_order_items||[])lines.append(renderOrderItem(row,order.currency));
    if(lines.childElementCount)item.append(lines);
    ordersList.append(item);
  }
}
function showError(error){message(authError,error?.message||tr("generic_error"));message(authSuccess,"");}
document.getElementById("toggle-password").addEventListener("click",event=>{
  const input=document.getElementById("auth-password");const button=event.currentTarget;
  const visible=input.type==="password";input.type=visible?"text":"password";
  button.textContent=tr(visible?"hide":"show");
  button.setAttribute("aria-label",tr(visible?"hide":"show"));button.setAttribute("aria-pressed",String(visible));
});
if(!config.url||!config.anonKey){setup.hidden=false;}
else{
  try{
    const {createClient}=await import("https://esm.sh/@supabase/supabase-js@2");
    supabase=createClient(config.url,config.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    setup.hidden=true;authPanel.hidden=false;
    const {data,error}=await supabase.auth.getSession();if(error)throw error;
    await renderSession(data.session);
    supabase.auth.onAuthStateChange((_event,nextSession)=>{queueMicrotask(()=>renderSession(nextSession).catch(showError));});
  }catch(error){setup.hidden=false;setup.textContent=tr("init_error")+" "+(error?.message||"");authPanel.hidden=true;}
}
document.getElementById("login-tab").addEventListener("click",()=>setMode("login"));
document.getElementById("signup-tab").addEventListener("click",()=>setMode("signup"));
authForm.addEventListener("submit",async event=>{
  event.preventDefault();if(!supabase)return;
  message(authError,"");message(authSuccess,"");
  setBusy(submitButton,true,mode==="login"?"…":tr("create_account_btn")+"…","");
  try{
    const email=document.getElementById("auth-email").value.trim();
    const password=document.getElementById("auth-password").value;
    const result=mode==="login"?await supabase.auth.signInWithPassword({email,password}):await supabase.auth.signUp({email,password,options:{emailRedirectTo:location.href.split("?")[0]}});
    if(result.error)throw result.error;
    if(mode==="signup"&&!result.data.session)message(authSuccess,tr("signup_check"));
    else await renderSession(result.data.session);
  }catch(error){showError(error);}
  finally{setBusy(submitButton,false,"",mode==="login"?tr("sign_in_secure"):tr("create_account_btn"));}
});
resetButton.addEventListener("click",async()=>{
  if(!supabase)return;const email=document.getElementById("auth-email").value.trim();
  if(!email){showError(new Error(tr("enter_email")));return;}
  message(authError,"");setBusy(resetButton,true,tr("reset_sending"),"");
  try{
    const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.href.split("?")[0]});
    if(error)throw error;message(authSuccess,tr("reset_sent"));message(authError,"");
  }catch(error){showError(error);}
  finally{setBusy(resetButton,false,"",tr("reset_password"));}
});
profileForm.addEventListener("submit",async event=>{
  event.preventDefault();if(!supabase||!activeUserId)return;
  const userId=activeUserId;const displayName=document.getElementById("profile-name").value.trim();
  if(displayName.length>80){profileState.textContent=tr("profile_error");return;}
  setBusy(profileSave,true,tr("profile_saving"),tr("save_profile"));
  try{
    const {error}=await supabase.from("ah_profiles").update({display_name:displayName||null}).eq("id",userId);
    if(error)throw error;if(activeUserId===userId)profileState.textContent=tr("profile_saved");
  }catch(error){profileState.textContent=tr("profile_error");}
  finally{setBusy(profileSave,false,"",tr("save_profile"));}
});
signOutButton.addEventListener("click",async()=>{
  if(!supabase)return;setBusy(signOutButton,true,"…",tr("sign_out"));
  try{const {error}=await supabase.auth.signOut();if(error)throw error;message(authSuccess,tr("signed_out"));}
  catch(error){showError(error);}
  finally{setBusy(signOutButton,false,"",tr("sign_out"));}
});
