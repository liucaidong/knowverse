import { BACKEND_CONFIG } from "./config.mjs";
import {
  acknowledgeArchiveDocuments,
  acknowledgeOutbox,
  countOutbox,
  getArchiveMeta,
  getDocumentSyncCursor,
  getLocalDevice,
  getSyncCursor,
  listOutbox,
  listPendingArchiveDocuments,
  persistLearningEvents,
  reconcileLocalSnapshot,
  setArchiveMeta,
  setDocumentSyncCursor,
  setSyncCursor,
} from "./local-event-store.mjs";
import {
  applyRemoteLearningArchiveDocument,
  captureLocalLearningArchive,
} from "./local-archive.mjs";

const cleanEvent = event => Object.fromEntries(Object.entries(event || {}).filter(([key]) => !key.startsWith("_")));
const dispatchStatus = detail => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("knowverse:sync-state", { detail }));
  }
};
const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

export function createLearningSyncService(auth, progressStore, config = BACKEND_CONFIG) {
  let running = false;
  let scheduled = false;
  let rerunRequested = false;
  let retryAttempt = 0;
  let retryTimer = null;

  async function profile() {
    return auth.request("/rest/v1/rpc/get_learning_sync_profile", { method: "POST", body: {} });
  }

  async function pushEvents(device) {
    let pushed = 0;
    for (let page = 0; page < 100; page += 1) {
      const batch = await listOutbox(100);
      if (!batch.length) break;
      const result = await auth.request("/rest/v1/rpc/sync_push_learning_events", {
        method: "POST",
        body: {
          p_device_id: device.id,
          p_events: batch.map(row => ({
            event_id: row.id,
            device_seq: row.deviceSeq,
            event_payload: cleanEvent(row.event),
          })),
        },
      });
      const confirmed = (result?.confirmed || []).map(item => item.event_id).filter(Boolean);
      if (!confirmed.length) throw new Error("云端没有确认本批学习事件，Outbox 已保留以便重试。");
      await acknowledgeOutbox(confirmed);
      pushed += confirmed.length;
      if (confirmed.length < batch.length) break;
    }
    return pushed;
  }

  async function pushDocuments(device) {
    let pushed = 0;
    const conflictIds = new Set();
    for (let page = 0; page < 100; page += 1) {
      const batch = await listPendingArchiveDocuments(50);
      if (!batch.length) break;
      const result = await auth.request("/rest/v1/rpc/sync_push_learning_documents", {
        method: "POST",
        body: {
          p_device_id: device.id,
          p_documents: batch.map(row => ({
            document_id: row.id,
            document_type: row.type,
            document_key: row.key,
            base_revision: row.baseRevision || 0,
            local_revision: row.localRevision,
            document_payload: row.payload,
          })),
        },
      });
      const confirmed = Array.isArray(result?.confirmed) ? result.confirmed : [];
      const rejected = Array.isArray(result?.conflicts) ? result.conflicts : [];
      if (confirmed.length) {
        await acknowledgeArchiveDocuments(confirmed);
        pushed += confirmed.length;
      }
      for (const remote of rejected) {
        const applied = await applyRemoteLearningArchiveDocument(remote);
        if (applied.status === "conflict") conflictIds.add(remote.document_id);
      }
      if (!confirmed.length && !rejected.length) {
        throw new Error("云端没有确认学习档案文档，待同步文档已保留。");
      }
      if (rejected.length || confirmed.length < batch.length) break;
    }
    return { pushed, conflictIds: [...conflictIds] };
  }

  async function pullEvents(userId) {
    let cursor = await getSyncCursor(userId);
    let pulled = 0;
    for (let page = 0; page < 20; page += 1) {
      const previousCursor = cursor;
      const result = await auth.request("/rest/v1/rpc/sync_pull_learning_events", {
        method: "POST",
        body: { p_after_user_seq: cursor, p_page_size: 100 },
      });
      const rows = Array.isArray(result?.events) ? result.events : [];
      const remoteEvents = rows.map(row => row.event_payload);
      if (remoteEvents.some(event => !event || typeof event.id !== "string" || !event.id)) {
        throw new Error("云端事件页包含无效记录；同步游标未推进。");
      }
      if (remoteEvents.length) {
        if (!progressStore.appendMany(remoteEvents, { remote: true })) {
          throw new Error("云端事件已读取，但合并到本地学习档案失败；同步游标未推进。");
        }
        await persistLearningEvents(remoteEvents, { origin: "cloud", queue: false });
        pulled += remoteEvents.length;
      }
      const nextCursor = Number(result?.next_cursor ?? cursor);
      if (nextCursor > cursor) {
        cursor = nextCursor;
        await setSyncCursor(userId, cursor);
      }
      if (!result?.has_more || !rows.length || nextCursor <= previousCursor) break;
    }
    return { pulled, cursor };
  }

  async function pullDocuments(userId) {
    let cursor = await getDocumentSyncCursor(userId);
    let pulled = 0;
    const conflictIds = new Set();
    for (let page = 0; page < 20; page += 1) {
      const previousCursor = cursor;
      const result = await auth.request("/rest/v1/rpc/sync_pull_learning_documents", {
        method: "POST",
        body: { p_after_document_seq: cursor, p_page_size: 100 },
      });
      const rows = Array.isArray(result?.documents) ? result.documents : [];
      for (const remote of rows) {
        const applied = await applyRemoteLearningArchiveDocument(remote);
        if (applied.status === "conflict") conflictIds.add(remote.document_id);
        if (applied.status === "applied") pulled += 1;
      }
      const nextCursor = Number(result?.next_cursor ?? cursor);
      if (nextCursor > cursor) {
        cursor = nextCursor;
        await setDocumentSyncCursor(userId, cursor);
      }
      if (!result?.has_more || !rows.length || nextCursor <= previousCursor) break;
    }
    return { pulled, cursor, conflictIds: [...conflictIds] };
  }

  async function sync() {
    if (running) {
      rerunRequested = true;
      return { status: "syncing" };
    }
    if (!config.enabled) return { status: "local-only", reason: "backend-not-configured" };
    if (!isOnline()) {
      const result = { status: "offline", reason: "network-unavailable" };
      dispatchStatus(result);
      return result;
    }
    running = true;
    dispatchStatus({ status: "syncing" });
    try {
      const session = await auth.getSession();
      if (!session) {
        const result = { status: "signed-out" };
        dispatchStatus(result);
        return result;
      }

      const account = await profile();
      if (!account?.authorized) {
        const result = { status: "pending-authorization", user: session.user || null };
        dispatchStatus(result);
        return result;
      }

      const userId = session.user?.id || account.user_id || "current";
      const boundUserId = await getArchiveMeta("bound-user-id");
      if (boundUserId && boundUserId !== userId) {
        throw new Error("此浏览器的本地学习档案已绑定另一个账户。为保护不同账户的数据隔离，当前账户不会自动上传这份档案；请先在原账户导出备份。");
      }
      if (!boundUserId) await setArchiveMeta("bound-user-id", userId);

      const device = await getLocalDevice();
      await auth.request("/rest/v1/rpc/register_device", {
        method: "POST",
        body: {
          p_device_id: device.id,
          p_label: "KNOWVERSE 浏览器设备",
          p_platform: typeof navigator !== "undefined" && /iPhone|Android|Mobile/i.test(navigator.userAgent || "") ? "mobile-web" : "desktop-web",
        },
      });

      await captureLocalLearningArchive(progressStore);
      await reconcileLocalSnapshot(progressStore.load());
      const pushedEvents = await pushEvents(device);
      const pushedDocuments = await pushDocuments(device);
      const pulledEvents = await pullEvents(userId);
      const pulledDocuments = await pullDocuments(userId);
      const pendingEvents = await countOutbox();
      const result = {
        status: "synced",
        pushed: pushedEvents,
        pulled: pulledEvents.pulled,
        pushedDocuments: pushedDocuments.pushed,
        pulledDocuments: pulledDocuments.pulled,
        conflicts: new Set([...pushedDocuments.conflictIds, ...pulledDocuments.conflictIds]).size,
        pending: pendingEvents,
        cursor: pulledEvents.cursor,
        documentCursor: pulledDocuments.cursor,
      };
      await setArchiveMeta("last-successful-sync", new Date().toISOString());
      await setArchiveMeta("last-sync-error", null);
      retryAttempt = 0;
      dispatchStatus(result);
      return result;
    } catch (error) {
      const result = { status: "error", message: error.message || "同步失败" };
      await setArchiveMeta("last-sync-error", result.message).catch(() => {});
      dispatchStatus(result);
      retryAttempt = Math.min(8, retryAttempt + 1);
      scheduleSync();
      throw error;
    } finally {
      running = false;
      if (rerunRequested) {
        rerunRequested = false;
        scheduleSync(1200);
      }
    }
  }

  async function initialize() {
    if (!config.enabled) {
      const result = { status: "local-only", reason: "backend-not-configured" };
      dispatchStatus(result);
      return result;
    }
    await captureLocalLearningArchive(progressStore);
    return sync();
  }

  function scheduleSync(delay) {
    if (scheduled || !config.enabled || !isOnline()) return;
    scheduled = true;
    const wait = Number.isFinite(delay) ? delay : Math.min(300000, 1200 * (2 ** retryAttempt));
    retryTimer = setTimeout(() => {
      scheduled = false;
      retryTimer = null;
      sync().catch(() => {
        retryAttempt = Math.min(8, retryAttempt + 1);
        scheduleSync();
      });
    }, wait);
  }

  function start() {
    if (typeof window === "undefined") return () => {};
    const onEvents = event => {
      if (event.detail?.remote || !config.enabled) return;
      persistLearningEvents(event.detail?.events || [], { queue: true })
        .then(() => scheduleSync(1200))
        .catch(error => dispatchStatus({ status: "error", message: "学习事件进入 Outbox 失败：" + error.message }));
    };
    const onArchive = () => {
      if (!config.enabled) return;
      captureLocalLearningArchive(progressStore)
        .then(() => scheduleSync(1200))
        .catch(error => dispatchStatus({ status: "error", message: "学习档案写入失败：" + error.message }));
    };
    const onOnline = () => scheduleSync(0);
    const onVisibility = () => {
      if (document.visibilityState === "visible") scheduleSync(0);
    };
    window.addEventListener("knowverse:learning-events-appended", onEvents);
    window.addEventListener("knowverse:learning-archive-capture", onArchive);
    window.addEventListener("knowverse:learning-archive-delete", onArchive);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("knowverse:learning-events-appended", onEvents);
      window.removeEventListener("knowverse:learning-archive-capture", onArchive);
      window.removeEventListener("knowverse:learning-archive-delete", onArchive);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }

  return { initialize, sync, start };
}
