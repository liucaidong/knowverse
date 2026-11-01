import { BACKEND_CONFIG } from "./config.mjs";
import { createSupabaseAuthClient } from "./auth.mjs";
import { createLearningSyncService } from "./sync-engine.mjs";
import { countOutbox } from "./local-event-store.mjs";

const siteRoot = new URL("../../../", import.meta.url);
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

export async function mountBackendAccountPanel(host, options = {}) {
  if (!host) return () => {};
  const store = options.store;
  const auth = createSupabaseAuthClient();
  const syncService = createLearningSyncService(auth, store);
  const stopSyncListener = syncService.start();
  let statusNode;
  let pendingNode;
  let busy = false;

  const shell = node("div", "kv-backend-card");
  const header = node("div", "kv-backend-header");
  const heading = node("div");
  heading.append(node("span", "kv-backend-kicker", "PERSONAL LEARNING CLOUD"));
  heading.append(node("h3", "", "云端学习档案"));
  header.append(heading);
  statusNode = node("span", "kv-backend-status", "检查配置中");
  header.append(statusNode);
  const description = node("p", "kv-backend-description",
    "本地优先保存学习记录；登录同一账户后，可在不同设备之间增量同步学习事件。");
  const account = node("div", "kv-backend-account", "尚未登录");
  const actions = node("div", "kv-backend-actions");
  const signIn = node("button", "lp-data-button primary", "使用 GitHub 登录");
  signIn.type = "button";
  const sync = node("button", "lp-data-button", "立即同步");
  sync.type = "button";
  const signOut = node("button", "lp-data-button", "退出登录");
  signOut.type = "button";
  signOut.hidden = true;
  pendingNode = node("p", "kv-backend-pending", "本地待同步事件：检查中");
  const hint = node("p", "kv-backend-hint",
    "安全边界：浏览器仅保存 Supabase Publishable Key；数据库通过账户白名单和 RLS 控制访问。");
  actions.append(signIn, sync, signOut);
  shell.append(header, description, account, actions, pendingNode, hint);
  host.replaceChildren(shell);

  async function refreshPending() {
    try {
      const count = await countOutbox();
      pendingNode.textContent = "IndexedDB 待同步事件：" + count;
    } catch {
      pendingNode.textContent = "IndexedDB 不可用；当前学习事件仍由兼容存储保留。";
    }
  }

  function setStatus(text, kind = "neutral") {
    statusNode.textContent = text;
    statusNode.dataset.status = kind;
  }

  async function renderSession() {
    if (!BACKEND_CONFIG.enabled) {
      setStatus("本地模式");
      account.textContent = "云端尚未配置。当前学习功能正常运行，数据保存在本机；完成 Supabase 项目配置后即可启用账户和云同步。";
      signIn.hidden = true;
      sync.hidden = true;
      signOut.hidden = true;
      await refreshPending();
      return;
    }
    const session = await auth.getSession();
    if (!session) {
      setStatus("未登录");
      account.textContent = "使用 GitHub 登录后，系统会检查该账户是否已加入 KNOWVERSE 个人账户白名单。";
      signIn.hidden = false;
      sync.hidden = true;
      signOut.hidden = true;
      await refreshPending();
      return;
    }
    account.textContent = "当前账户：" + (session.user?.email || session.user?.user_metadata?.user_name || session.user?.id || "已认证");
    signIn.hidden = true;
    sync.hidden = false;
    signOut.hidden = false;
    const result = await syncService.sync();
    if (result.status === "pending-authorization") {
      setStatus("等待授权", "warning");
      account.textContent += " · OAuth 已成功，但此账户尚未加入管理员白名单。";
    } else if (result.status === "synced") {
      setStatus("已同步", "success");
      account.textContent += " · 本次上传 " + result.pushed + " 条，下载 " + result.pulled + " 条。";
    } else if (result.status === "error") {
      setStatus("同步异常", "warning");
    }
    await refreshPending();
  }

  signIn.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    signIn.disabled = true;
    try {
      await auth.signInWithGitHub(siteRoot);
    } catch (error) {
      setStatus("登录失败", "warning");
      account.textContent = error.message;
      signIn.disabled = false;
      busy = false;
    }
  });

  sync.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    sync.disabled = true;
    try {
      const result = await syncService.sync();
      await renderSessionWithoutSync(result);
    } catch (error) {
      setStatus("同步失败", "warning");
      account.textContent = error.message;
    } finally {
      sync.disabled = false;
      busy = false;
      await refreshPending();
    }
  });

  async function renderSessionWithoutSync(result) {
    if (result.status === "pending-authorization") {
      setStatus("等待授权", "warning");
      account.textContent = "OAuth 已成功，但此账户尚未加入 KNOWVERSE 个人账户白名单。";
    } else if (result.status === "synced") {
      setStatus("已同步", "success");
      account.textContent = "本次上传 " + result.pushed + " 条，下载 " + result.pulled + " 条。";
    } else {
      setStatus("同步状态：" + result.status);
    }
  }

  signOut.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    signOut.disabled = true;
    try {
      await auth.signOut();
      setStatus("已退出");
      await renderSession();
    } catch (error) {
      setStatus("退出失败", "warning");
      account.textContent = error.message;
    } finally {
      signOut.disabled = false;
      busy = false;
    }
  });

  const onSyncState = event => {
    const detail = event.detail || {};
    if (detail.status === "syncing") setStatus("同步中");
    if (detail.status === "synced") {
      setStatus("已同步", "success");
      refreshPending();
    }
    if (detail.status === "error") setStatus("同步异常", "warning");
    if (detail.status === "pending-authorization") setStatus("等待授权", "warning");
  };
  window.addEventListener("knowverse:sync-state", onSyncState);

  try {
    await renderSession();
  } catch (error) {
    setStatus("服务不可用", "warning");
    account.textContent = error.message;
    await refreshPending();
  }

  return () => {
    stopSyncListener();
    window.removeEventListener("knowverse:sync-state", onSyncState);
  };
}
