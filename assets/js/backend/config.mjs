const source = globalThis.KNOWVERSE_BACKEND_CONFIG || {};
const supabaseUrl = typeof source.supabaseUrl === "string" ? source.supabaseUrl.replace(/\/+$/, "") : "";
const publishableKey = typeof source.publishableKey === "string" ? source.publishableKey.trim() : "";
const secureUrl = /^https:\/\//i.test(supabaseUrl)
  || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(supabaseUrl);

export const BACKEND_CONFIG = Object.freeze({
  supabaseUrl,
  publishableKey,
  enabled: secureUrl && publishableKey.length > 10,
  authStorageKey: "knowverse:supabase-session:v1",
  pkceStorageKey: "knowverse:supabase-pkce:v1",
});

export function isBackendConfigured() {
  return BACKEND_CONFIG.enabled;
}
