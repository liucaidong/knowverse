import { BACKEND_CONFIG } from "./config.mjs";
import { getArchiveRuntime } from "./archive-bootstrap.mjs";
import {
  getArchiveStatus,
  getLearningDocument,
  getLocalDevice,
  listArchiveConflicts,
} from "./local-event-store.mjs";
import { resolveLocalLearningArchiveConflict } from "./local-archive.mjs";

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
const restoreSummary = result =>
  "云端事件读取 " + (result.receivedEvents ?? result.restoredEvents ?? 0) +
  " 条（新增 " + (result.restoredEvents ?? 0) + " 条） · 云端档案读取 " +
  (result.receivedDocuments ?? result.restoredDocuments ?? 0) + " 份（新增 " +
  (result.restoredDocuments ?? 0) + " 份、本地已有 " + (result.unchangedDocuments ?? 0) +
  " 份、跳过本地派生缓存 " + (result.skippedDocuments ?? 0) + " 份）" +
  (Number.isFinite(result.localDocuments) ? " · 本机档案共 " + result.localDocuments + " 份" : "") +
  (result.conflicts ? " · 冲突 " + result.conflicts + " 项" : "") +
  " · 刷新页面后继续未完成学习";

const archiveDocumentLabels = Object.freeze({
  challenge_progress: "挑战进度",
  review_session: "复习现场",
  plan_preferences: "学习规划偏好",
  learner_profile: "学习者档案",
  learning_goal: "学习目标",
  learning_plan: "学习计划",
  learning_plan_head: "学习计划索引",
  learning_task: "学习任务",
  learning_agent_session: "AI 学习会话",
  learning_agent_message: "AI 学习消息",
  proactive_learning_projection: "主动学习仪表盘快照",
});

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
    "登录和退出登录统一使用页面顶部的「全站账户」入口。本面板只负责学习档案状态、主动同步与冲突处理。");
  const sync = node("button", "lp-data-button", "立即同步");
  sync.type = "button";
  const restore = node("button", "lp-data-button", "从云端恢复");
  restore.type = "button";
  restore.hidden = true;
  actions.append(sync, restore);

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

  function setBusy(value, action = "sync") {
    busy = value;
    sync.disabled = value;
    restore.disabled = value;
    sync.textContent = value && action === "sync" ? "正在同步…" : "立即同步";
    restore.textContent = value && action === "restore" ? "正在恢复…" : "从云端恢复";
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
      const [archive, device] = await Promise.all([getArchiveStatus(), getLocalDevice()]);
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
      lastSync.textContent = "最近成功同步：" + dateLabel(archive.lastSyncAt) +
        " · 最近云端恢复：" + dateLabel(archive.lastRestoreAt);
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
      const documentType = remote.document_type || conflict.documentType || "unknown";
      const documentKey = remote.document_key || conflict.documentKey || conflict.documentId || "unknown";
      const local = documentType !== "unknown" && documentKey !== "unknown"
        ? await getLearningDocument(documentType, documentKey).catch(() => null)
        : null;
      const documentLabel = archiveDocumentLabels[documentType] || documentType;
      const keyLabel = documentKey === "current" ? "当前快照" : documentKey;
      const heading = node("strong", "", documentLabel + " · " + keyLabel);
      const localRevision = Number(local?.localRevision) || 0;
      const baseRevision = Number(local?.baseRevision ?? local?.cloudRevision) || 0;
      const remoteRevision = Number(remote.revision) || 0;
      const explanation = node("p", "",
        "本机修订 " + localRevision + "（基于云端版本 " + baseRevision + "）与云端修订 " +
        remoteRevision + " 存在内容差异。本机内容与云端内容均已保留，请明确选择采用哪一版。");
      const choices = node("div", "kv-backend-conflict-actions");
      const keepLocal = node("button", "lp-data-button", "保留本机版本");
      keepLocal.type = "button";
      const keepRemote = node("button", "lp-data-button primary", "采用云端版本");
      keepRemote.type = "button";
      keepLocal.disabled = !local;
      keepRemote.disabled = !local || !remote.document_payload;
      keepLocal.addEventListener("click", async () => {
        if (busy || !local) return;
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
        if (busy || !local || !remote.document_payload) return;
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
      restore.hidden = true;
      await renderArchive();
      await renderConflicts();
      return;
    }

    const session = await auth.getSession();
    if (!session) {
      setStatus("未登录");
      account.textContent = "当前没有云端账户会话。你可以继续离线学习；登录后才会建立跨设备同步。";
      sync.hidden = true;
      restore.hidden = true;
      await renderArchive();
      await renderConflicts();
      return;
    }

    const user = session.user || {};
    account.textContent = "当前账户：" + (user.email || user.user_metadata?.user_name || user.id || "已认证");
    sync.hidden = false;
    restore.hidden = false;

    if (syncNow) {
      setBusy(true, "sync");
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

  async function restoreCloud() {
    if (busy || !syncService?.restoreFromCloud) return;
    setBusy(true, "restore");
    try {
      const result = await syncService.restoreFromCloud();
      if (result.status === "restored") {
        setStatus(result.conflicts ? "恢复完成 · 有冲突待选择" : "云端恢复完成", result.conflicts ? "warning" : "success");
        lastSyncLabel = restoreSummary(result);
        setError("");
      } else if (result.status === "pending-authorization") {
        setStatus("等待账户授权", "warning");
      } else if (result.status === "offline") {
        setStatus("离线，暂不能恢复", "warning");
      } else if (result.status === "signed-out") {
        setStatus("请先登录", "warning");
      } else {
        setStatus("恢复状态：" + result.status, "warning");
      }
    } catch (error) {
      setStatus("云端恢复失败", "warning");
      setError(error.message || "云端恢复失败；原有本机学习数据已保留。");
    } finally {
      setBusy(false);
      await renderArchive();
      await renderConflicts();
      if (lastSyncLabel) account.textContent = account.textContent.split(" · 云端事件读取 ")[0] + " · " + lastSyncLabel;
    }
  }

  sync.addEventListener("click", () => renderSession({ syncNow: true }));
  restore.addEventListener("click", restoreCloud);
  const onSyncState = async event => {
    if (destroyed) return;
    const detail = event.detail || {};
    if (detail.status === "syncing") setStatus("同步中");
    if (detail.status === "restore-queued") setStatus("等待当前同步结束，再从云端恢复");
    if (detail.status === "restoring") setStatus("正在从云端恢复");
    if (detail.status === "restored") {
      setStatus(detail.conflicts ? "恢复完成 · 有冲突待选择" : "云端恢复完成", detail.conflicts ? "warning" : "success");
      lastSyncLabel = restoreSummary(detail);
      await renderArchive();
      await renderConflicts();
    } else if (detail.status === "synced") {
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
    restore.removeEventListener("click", restoreCloud);
    window.removeEventListener("online", onNetwork);
    window.removeEventListener("offline", onNetwork);
  };
}
