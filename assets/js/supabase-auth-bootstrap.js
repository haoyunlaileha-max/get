(() => {
  const config = window.AH_SUPABASE_CONFIG || {};
  window.AH_SUPABASE_READY = (async () => {
    if (!config.url || !config.anonKey) throw new Error("Supabase 项目配置缺失。");
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    return createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  })();
  // Prevent an early unhandled-rejection warning; consumers still receive the rejection.
  window.AH_SUPABASE_READY.catch(() => {});
})();
