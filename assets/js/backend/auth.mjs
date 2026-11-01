import { BACKEND_CONFIG } from "./config.mjs";

const textEncoder = new TextEncoder();
const base64Url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

async function createPkcePair() {
  const random = new Uint8Array(48);
  crypto.getRandomValues(random);
  const verifier = base64Url(random);
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(verifier));
  return { verifier, challenge: base64Url(digest) };
}

function parseJson(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function readResponse(response) {
  const raw = await response.text();
  const data = parseJson(raw) ?? raw;
  if (!response.ok) {
    const message = data && typeof data === "object"
      ? data.msg || data.message || data.error_description || data.error || response.statusText
      : String(data || response.statusText);
    const error = new Error("Supabase 请求失败 (" + response.status + "): " + message);
    error.status = response.status;
    error.code = data?.code || data?.error_code || null;
    throw error;
  }
  return data;
}

export class SupabaseAuthClient {
  constructor(config = BACKEND_CONFIG) {
    this.config = config;
  }

  get enabled() {
    return Boolean(this.config.enabled && this.config.supabaseUrl && this.config.publishableKey);
  }

  readStoredSession() {
    try {
      return parseJson(localStorage.getItem(this.config.authStorageKey));
    } catch {
      return null;
    }
  }

  saveSession(session) {
    const normalized = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      token_type: session.token_type || "bearer",
      expires_at: session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
      user: session.user || null,
    };
    try {
      localStorage.setItem(this.config.authStorageKey, JSON.stringify(normalized));
    } catch {
      throw new Error("无法保存登录会话。请检查浏览器本地存储空间和隐私设置。");
    }
    return normalized;
  }

  clearSession() {
    try {
      localStorage.removeItem(this.config.authStorageKey);
      localStorage.removeItem(this.config.pkceStorageKey);
    } catch { /* The next authentication attempt will start a fresh flow. */ }
  }

  async signInWithGitHub(siteRoot) {
    if (!this.enabled) throw new Error("云端服务尚未配置 Supabase URL 与 Publishable Key。");
    if (!globalThis.crypto?.subtle) throw new Error("当前浏览器不支持安全的 OAuth PKCE 登录。");
    const { verifier, challenge } = await createPkcePair();
    localStorage.setItem(this.config.pkceStorageKey, verifier);
    const callback = new URL("auth/callback/", siteRoot);
    const authorize = new URL(this.config.supabaseUrl + "/auth/v1/authorize");
    authorize.searchParams.set("provider", "github");
    authorize.searchParams.set("redirect_to", callback.href);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "s256");
    authorize.searchParams.set("scopes", "read:user");
    location.assign(authorize.href);
  }

  async handleCallback(url = location.href) {
    const callbackUrl = new URL(url);
    const providerError = callbackUrl.searchParams.get("error_description") || callbackUrl.searchParams.get("error");
    if (providerError) throw new Error("GitHub 登录未完成：" + providerError);
    const code = callbackUrl.searchParams.get("code");
    if (!code) throw new Error("登录回调中缺少授权 code。");
    const verifier = localStorage.getItem(this.config.pkceStorageKey);
    if (!verifier) throw new Error("登录验证信息已过期，请重新登录。");
    const response = await fetch(this.config.supabaseUrl + "/auth/v1/token?grant_type=pkce", {
      method: "POST",
      headers: {
        apikey: this.config.publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    });
    const session = this.saveSession(await readResponse(response));
    try { localStorage.removeItem(this.config.pkceStorageKey); } catch { /* Ignore cleanup failure. */ }
    return session;
  }

  async getSession() {
    if (!this.enabled) return null;
    const session = this.readStoredSession();
    if (!session?.access_token || !session?.refresh_token) return null;
    if (Number(session.expires_at || 0) - Math.floor(Date.now() / 1000) > 60) return session;
    try {
      const response = await fetch(this.config.supabaseUrl + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: {
          apikey: this.config.publishableKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      return this.saveSession(await readResponse(response));
    } catch (error) {
      if (error.status === 400 || error.status === 401) this.clearSession();
      throw error;
    }
  }

  async request(path, options = {}) {
    if (!this.enabled) throw new Error("Supabase 尚未配置。");
    const session = options.authenticated === false ? null : await this.getSession();
    const headers = {
      apikey: this.config.publishableKey,
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session?.access_token ? { Authorization: "Bearer " + session.access_token } : {}),
    };
    const requestOptions = {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    };
    let response = await fetch(this.config.supabaseUrl + path, requestOptions);

    // A session can be revoked server-side before the locally cached expires_at.
    // Refresh once on 401; never loop or retry a request without a new access token.
    if (response.status === 401 && session?.refresh_token) {
      const refreshResponse = await fetch(this.config.supabaseUrl + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: {
          apikey: this.config.publishableKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      if (!refreshResponse.ok) {
        this.clearSession();
        return readResponse(refreshResponse);
      }
      const refreshed = this.saveSession(await readResponse(refreshResponse));
      const retryHeaders = {
        ...headers,
        ...(refreshed.access_token ? { Authorization: "Bearer " + refreshed.access_token } : {}),
      };
      response = await fetch(this.config.supabaseUrl + path, {
        ...requestOptions,
        headers: retryHeaders,
      });
      if (response.status === 401) this.clearSession();
    }
    return readResponse(response);
  }

  async signOut() {
    const session = await this.getSession();
    if (session?.access_token) {
      try {
        await this.request("/auth/v1/logout", { method: "POST", body: {} });
      } finally {
        this.clearSession();
      }
    } else {
      this.clearSession();
    }
  }
}

export function createSupabaseAuthClient(config = BACKEND_CONFIG) {
  return new SupabaseAuthClient(config);
}
