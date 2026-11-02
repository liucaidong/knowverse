import { BACKEND_CONFIG } from "./config.mjs";
import { getArchiveRuntime } from "./archive-bootstrap.mjs";
import {
  getArchiveStatus,
  getLocalDevice,
  listArchiveConflicts,
} from "./local-event-store.mjs";
import { resolveLocalLearningArchiveConflict } from "./local-archive.mjs";

const siteRoot = new URL("../../../", import.meta.url);
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const dateLabel = value => {
  if (!value) return "尚无成功同步记录";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(date);
};
const shortId = value => value ? String(value).slice(0, 8) + "…" : "尚未初始化";

export async function mountBackendAccountPanel(host, options = {}) {
  if (!host) return () => {};
  const runtime = await getArchiveRuntime();
  const auth = runtime.auth;
  const syncService = runtime.syncService;
  let busy = false;
  let lastSyncLabel = null;
  let destroyed = false;

  const shell = node("section", "kv-backend-card");
  shell.setAttribute("aria-label", "云端学习档案与设备同步");
  const header = node("div", "kv-backend-header");
  const heading = node("div");
  heading.append(node("span", "kv-backend-kicker", "PERSONAL LEARNING CLOUD"));
  heading.append(node("h3", "", "云端学习档案"));
  const status = node("span", "kv-backend-status", "正在检查");
  status.dataset.status = "neutral";
  header.append(heading, status);

  const description = node("p", "kv-backend-description",
    "这是 KNOWVERSE 全站共享账户，不是当前页面的独立登录。登录后，同一会话可用于知识库、实验室、展厅、解谜和学习驾驶舱。公开知识内容无需登录；登录用于个人学习档案云端同步，学习内容仍优先保存在本机。");
  const account = node("div", "kv-backend-account", "正在读取账户…");
  const metrics = node("div", "kv-backend-metrics");
  const detailList = node("dl", "kv-backend-details");
  const lastSync = node("p", "kv-backend-last-sync", "最近成功同步：尚无记录");
  const errorBox = node("p", "kv-backend-error");
  errorBox.hidden = true;
  const actions = node("div", "kv-backend-actions");
  const accountGuide = node("p", "kv-backend-account-guide",
    "登录与退出统一使用页面顶部的「全站账户」入口。本面板只负责学习档案状态、主动同步与冲突处理。");
  const sync = node("button", "lp-data-button", "立即同步");
  sync.type = "button";
  actions.append(sync);

  const conflictSection = node("section", "kv-backend-conflicts");
  conflictSection.hidden = true;
  conflictSection.append(node("h4", "", "需要处理的档案冲突"));
  const conflictList = node("div", "kv-backend-conflict-list");
  conflictSection.append(conflictList);

  const hint = node("p", "kv-backend-hint",
    "安全边界：GitHub OAuth 仅请求 read:user，不申请 GitHub 仓库读写权限。云端数据由账户白名单、RLS 与受控 RPC 隔离；退出全站账户不会删除本地学习记录。");
  shell.append(header, description, account, accountGuide, metrics, detailList, lastSync, errorBox, actions, conflictSection, hint);
  host.replaceChildren(shell);

  function setStatus(label, kind = "neutral") {
    status.textContent = label;
    status.dataset.status = kind;
  }

  function setError(message) {
    errorBox.hidden = !message;
    errorBox.textContent = message || "";
  }

  if (runtime.bootstrapError) {
    setError("本地归档数据库初始化失败。请检查浏览器 IndexedDB 权限与存储空间后刷新页面。");
  }

  function setBusy(value) {
    busy = value;
    sync.disabled = value;
    sync.textContent = value ? "正在处理…" : "立即同步";
  }

  function addMetric(label, value, note = "") {
    const card = node("div", "kv-backend-metric");
    card.append(node("span", "kv-backend-metric-label", label));
    card.append(node("strong", "kv-backend-metric-value", String(value)));
    if (note) card.append(node("small", "kv-backend-metric-note", note));
    metrics.append(card);
  }

  function addDetail(label, value) {
    detailList.append(node("dt", "", label), node("dd", "", value));
  }

  async function renderArchive() {
    try {
      const [archive, device] = await Promise.all([getArchiveStatus(options.store?.load?.()?.events?.length || 0), getLocalDevice()]);
      metrics.replaceChildren();
      addMetric("本地学习事件", archive.eventRecords ?? "—", "当前设备学习记录");
      addMetric("待上传事件", archive.pendingEvents, "服务端确认后才会清除");
      addMetric("待同步档案", archive.pendingDocuments, "挑战 / 复习 / 偏好");
      addMetric("冲突待处理", archive.conflicts, "不会自动覆盖任何一端");
      detailList.replaceChildren();
      addDetail("当前设备", shortId(device?.id));
      addDetail("本地数据库", archive.indexedDbAvailable ? "IndexedDB 可用" : "IndexedDB 不可用");
      addDetail("本地档案", archive.indexedDbAvailable ? "当前存储可用" : "当前存储不可用");
      addDetail("档案文档", archive.documents + " 份");
      addDetail("网络", typeof navigator === "undefined" ? "未知" : navigator.onLine ? "在线" : "离线");
      lastSync.textContent = "最近成功同步：" + dateLabel(archive.lastSyncAt);
      if (archive.lastSyncError) setError("上次同步失败：" + archive.lastSyncError);
      return archive;
    } catch (error) {
      setError("无法读取本地档案状态：" + (error.message || "未知错误"));
      return null;
    }
  }

  async function renderConflicts() {
    const conflicts = await listArchiveConflicts();
    conflictList.replaceChildren();
    conflictSection.hidden = !conflicts.length;
    for (const conflict of conflicts) {
      const card = node("article", "kv-backend-conflict");
      const remote = conflict.remote || {};
      const heading = node("strong", "", conflict.document_type + " · " + conflict.document_key);
      const explanation = node("p", "", "另一台设备已经把此档案更新到云端版本 " + remote.revision +
        "。本机修改与云端修改都已保留，请明确选择保留哪一版。");
      const choices = node("div", "kv-backend-conflict-actions");
      const keepLocal = node("button", "lp-data-button", "保留本机版本");
      keepLocal.type = "button";
      const keepRemote = node("button", "lp-data-button primary", "采用云端版本");
      keepRemote.type = "button";
      keepLocal.addEventListener("click", async () => {
        if (busy) return;
        setBusy(true);
        try {
          await resolveLocalLearningArchiveConflict(conflict.id, "local");
          setError("");
          await syncService.sync();
          await renderArchive();
          await renderConflicts();
        } catch (error) {
          setError(error.message || "冲突处理失败");
        } finally { setBusy(false); }
      });
      keepRemote.addEventListener("click", async () => {
        if (busy) return;
        setBusy(true);
        try {
          await resolveLocalLearningArchiveConflict(conflict.id, "remote");
          setError("");
          await syncService.sync();
          await renderArchive();
          await renderConflicts();
        } catch (error) {
          setError(error.message || "冲突处理失败");
        } finally { setBusy(false); }
      });
      choices.append(keepLocal, keepRemote);
      card.append(heading, explanation, choices);
      conflictList.append(card);
    }
  }

  async function renderSession({ syncNow = false } = {}) {
    if (!BACKEND_CONFIG.enabled) {
      setStatus("本地模式");
      account.textContent = "云端尚未配置。无需登录即可继续学习；当前设备上的学习事件、挑战进度与复习现场会保存在本机。";
      sync.hidden = true;
      await renderArchive();
      await renderConflicts();
      return;
    }

    const session = await auth.getSession();
    if (!session) {
      setStatus("未登录");
      account.textContent = "当前没有云端账户会话。你可以继续离线学习；登录后才会建立跨设备同步。";
      sync.hidden = true;
      await renderArchive();
      await renderConflicts();
      return;
    }

    const user = session.user || {};
    account.textContent = "当前账户：" + (user.email || user.user_metadata?.user_name || user.id || "已认证");
    sync.hidden = false;

    if (syncNow) {
      setBusy(true);
      try {
        const result = await syncService.sync();
        if (result.status === "pending-authorization") {
          setStatus("等待授权", "warning");
          account.textContent += " · OAuth 成功，但账户尚未加入管理员白名单。";
        } else if (result.status === "synced") {
          setStatus(result.conflicts ? "有冲突待处理" : "已同步", result.conflicts ? "warning" : "success");
          lastSyncLabel = "本次上传事件 " + result.pushed + " 条、下载 " + result.pulled +
            " 条；档案上传 " + result.pushedDocuments + " 份、恢复 " + result.pulledDocuments + " 份。";
        } else if (result.status === "offline") {
          setStatus("离线待同步", "warning");
        } else {
          setStatus("同步状态：" + result.status);
        }
        setError("");
      } catch (error) {
        setStatus("同步失败", "warning");
        setError(error.message || "同步失败；本地待同步数据已保留。");
      } finally {
        setBusy(false);
      }
    } else {
      setStatus("已登录");
    }
    if (lastSyncLabel) account.textContent += " · " + lastSyncLabel;
    await renderArchive();
    await renderConflicts();
  }

  sync.addEventListener("click", () => renderSession({ syncNow: true }));
  const onSyncState = async event => {
    if (destroyed) return;
    const detail = event.detail || {};
    if (detail.status === "syncing") setStatus("同步中");
    if (detail.status === "synced") {
      setStatus(detail.conflicts ? "有冲突待处理" : "已同步", detail.conflicts ? "warning" : "success");
      lastSyncLabel = "上传 " + detail.pushed + " 条事件 · 下载 " + detail.pulled + " 条事件";
      await renderArchive();
      await renderConflicts();
    } else if (detail.status === "offline") {
      setStatus("离线待同步", "warning");
    } else if (detail.status === "error") {
      setStatus("同步异常", "warning");
      setError(detail.message || "同步失败；待同步数据已保留。");
      await renderArchive();
    } else if (detail.status === "pending-authorization") {
      setStatus("等待授权", "warning");
    }
  };
  const onNetwork = () => {
    renderArchive().catch(() => {});
    if (!navigator.onLine) setStatus("离线学习", "warning");
  };
  const onAuthState = () => renderSession();
  window.addEventListener("knowverse:auth-state", onAuthState);
  window.addEventListener("storage", event => {
    if (event.key === BACKEND_CONFIG.authStorageKey) renderSession();
  });
  window.addEventListener("knowverse:sync-state", onSyncState);
  window.addEventListener("online", onNetwork);
  window.addEventListener("offline", onNetwork);
  window.addEventListener("knowverse:archive-state", () => renderArchive());

  try {
    await renderSession({ syncNow: true });
  } catch (error) {
    setStatus("服务不可用", "warning");
    setError(error.message || "云端服务暂时不可用；本地学习仍可继续。");
    await renderArchive();
  }

  return () => {
    destroyed = true;
    window.removeEventListener("knowverse:auth-state", onAuthState);
    window.removeEventListener("knowverse:sync-state", onSyncState);
    window.removeEventListener("online", onNetwork);
    window.removeEventListener("offline", onNetwork);
  };
}
