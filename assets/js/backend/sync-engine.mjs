import { BACKEND_CONFIG } from "./config.mjs";
import {
  acknowledgeArchiveDocuments,
  acknowledgeOutbox,
  acquireSyncLease,
  bindLocalAccount,
  countOutbox,
  getArchiveMeta,
  getDocumentSyncCursor,
  getLocalDevice,
  getSyncCursor,
  listOutbox,
  listArchiveDocuments,
  listPendingArchiveDocuments,
  mergeRemoteLearningEvents,
  releaseSyncLease,
  setArchiveMeta,
  setDocumentSyncCursor,
  setSyncCursor,
} from "./local-event-store.mjs";
import { applyRemoteLearningArchiveDocument } from "./local-archive.mjs";

const cleanEvent = event => Object.fromEntries(Object.entries(event || {}).filter(([key]) => !key.startsWith("_")));
const dispatchStatus = detail => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("knowverse:sync-state", { detail }));
};
const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;
const operationOwner = globalThis.crypto?.randomUUID?.()
  || "sync-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);

export function createLearningSyncService(auth, progressStore, config = BACKEND_CONFIG) {
  let running = false;
  let scheduled = false;
  let retryAttempt = 0;
  let retryTimer = null;
  let serial = Promise.resolve();
  let queuedOperations = 0;
  let activeOperation = null;

  function enqueue(operation, operationName) {
    const alreadyWaiting = activeOperation !== null || queuedOperations > 0;
    queuedOperations += 1;
    if (alreadyWaiting) {
      dispatchStatus({ status: "queued", operation: operationName, waitingFor: activeOperation });
    }
    const run = () => {
      queuedOperations = Math.max(0, queuedOperations - 1);
      activeOperation = operationName;
      return operation();
    };
    const task = serial.then(run, run);
    serial = task.catch(() => {}).finally(() => {
      if (activeOperation === operationName) activeOperation = null;
    });
    return task;
  }

  async function withLease(operation, action) {
    if (running) throw new Error("同步服务内部锁状态异常：同一标签页并发操作未被串行化。");
    const waitMs = Math.max(0, Number(config.syncLeaseWaitMs ?? 30000) || 0);
    const pollMs = Math.max(50, Number(config.syncLeasePollMs ?? 250) || 250);
    const deadline = Date.now() + waitMs;
    let acquired = await acquireSyncLease("learning-sync", operationOwner, 900000);
    while (!acquired && Date.now() < deadline) {
      dispatchStatus({ status: "waiting-for-sync-lease", operation, reason: "another-tab-holds-the-sync-lease" });
      await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
      acquired = await acquireSyncLease("learning-sync", operationOwner, 900000);
    }
    if (!acquired) {
      const result = { status: "busy", operation, reason: "another-tab-holds-the-sync-lease" };
      dispatchStatus(result);
      return result;
    }
    running = true;
    try { return await action(); }
    finally {
      running = false;
      await releaseSyncLease("learning-sync", operationOwner);
    }
  }

  async function profile() {
    return auth.request("/rest/v1/rpc/get_learning_sync_profile", { method: "POST", body: {} });
  }

  async function ensureAccountAndDevice(session, account) {
    const userId = session.user?.id || account.user_id;
    if (!userId || userId !== account.user_id) {
      throw new Error("Supabase 会话用户与服务器学习档案用户不匹配，已停止同步。");
    }
    await bindLocalAccount(userId);
    const device = await getLocalDevice();
    await auth.request("/rest/v1/rpc/register_device", {
      method: "POST",
      body: {
        p_device_id: device.id,
        p_label: "KNOWVERSE 浏览器设备",
        p_platform: typeof navigator !== "undefined" &&
          /iPhone|Android|Mobile/i.test(navigator.userAgent || "") ? "mobile-web" : "desktop-web",
      },
    });
    return { userId, device };
  }

  /**
   * A single server RPC commits the event batch and document batch inside one
   * PostgreSQL transaction. The local Outbox is acknowledged only afterward.
   */
  async function pushChanges(device, userId) {
    let pushedEvents = 0;
    let pushedDocuments = 0;
    const conflictIds = new Set();
    for (let page = 0; page < 100; page += 1) {
      const [eventBatch, documentBatch] = await Promise.all([
        listOutbox(100),
        listPendingArchiveDocuments(50),
      ]);
      if (!eventBatch.length && !documentBatch.length) break;
      const result = await auth.request("/rest/v1/rpc/sync_commit_learning_batch", {
        method: "POST",
        body: {
          p_device_id: device.id,
          p_expected_user_id: userId,
          p_events: eventBatch.map(row => ({
            event_id: row.id,
            device_seq: row.deviceSeq,
            event_payload: cleanEvent(row.event),
          })),
          p_documents: documentBatch.map(row => ({
            document_id: row.id,
            document_type: row.type,
            document_key: row.key,
            base_revision: row.baseRevision || 0,
            local_revision: row.localRevision,
            document_payload: row.payload,
          })),
        },
      });
      const eventResult = result?.events || {};
      const documentResult = result?.documents || {};
      const confirmedEvents = Array.isArray(eventResult.confirmed) ? eventResult.confirmed : [];
      const confirmedDocuments = Array.isArray(documentResult.confirmed) ? documentResult.confirmed : [];
      const rejectedDocuments = Array.isArray(documentResult.conflicts) ? documentResult.conflicts : [];
      if (result?.status === "conflict") {
        if (!rejectedDocuments.length) {
          return { pushedEvents, pushedDocuments, conflictIds: [...conflictIds], blocked: true };
        }
        let unreconciledConflict = false;
        for (const remote of rejectedDocuments) {
          const applied = await applyRemoteLearningArchiveDocument(remote, userId);
          if (applied.status === "conflict") conflictIds.add(remote.document_id);
          else if (applied.status === "ignored") unreconciledConflict = true;
        }
        if (unreconciledConflict) {
          return { pushedEvents, pushedDocuments, conflictIds: [...conflictIds], blocked: true };
        }
        // The atomic RPC rolled back both documents and events. Conflicted
        // documents are now marked conflict=true and excluded from the next
        // pending-document batch; retry once in this loop so independent
        // append-only learning events can still commit without overwriting
        // either side of the unresolved document conflict.
        continue;
      }
      if (result?.status !== "committed") {
        throw new Error("服务端没有返回可确认的原子批次提交状态；本地 Outbox 和文档均未确认。");
      }
      if (eventBatch.length && !confirmedEvents.length) {
        throw new Error("服务端未确认本批学习事件；原子批次失败，本地 Outbox 保留。");
      }
      if (documentBatch.length && !confirmedDocuments.length && !rejectedDocuments.length) {
        throw new Error("服务端未确认本批学习文档；原子批次失败，本地文档保留。");
      }
      if (confirmedEvents.length) {
        await acknowledgeOutbox(confirmedEvents);
        pushedEvents += confirmedEvents.length;
      }
      if (confirmedDocuments.length) {
        await acknowledgeArchiveDocuments(confirmedDocuments);
        pushedDocuments += confirmedDocuments.length;
      }
      for (const remote of rejectedDocuments) {
        const applied = await applyRemoteLearningArchiveDocument(remote, userId);
        if (applied.status === "conflict") conflictIds.add(remote.document_id);
      }
      if (rejectedDocuments.length || confirmedEvents.length < eventBatch.length ||
          confirmedDocuments.length < documentBatch.length) break;
    }
    return { pushedEvents, pushedDocuments, conflictIds: [...conflictIds] };
  }

  async function pullEvents(userId, { fromBeginning = false } = {}) {
    const storedCursor = await getSyncCursor(userId);
    let cursor = fromBeginning ? 0 : storedCursor;
    let pulled = 0;
    let received = 0;
    for (let page = 0; page < 100; page += 1) {
      const previousCursor = cursor;
      const result = await auth.request("/rest/v1/rpc/sync_pull_learning_events_for_account", {
        method: "POST",
        body: { p_expected_user_id: userId, p_after_user_seq: cursor, p_page_size: 100 },
      });
      const rows = Array.isArray(result?.events) ? result.events : [];
      if (rows.some(row => !row?.event_payload || row.event_id !== row.event_payload.id ||
          !Number.isSafeInteger(Number(row.user_seq)) || Number(row.user_seq) <= cursor)) {
        throw new Error("云端事件页包含无效或重复游标记录；本地游标未推进。");
      }
      received += rows.length;
      if (rows.length) pulled += await mergeRemoteLearningEvents(rows, userId);
      const nextCursor = Number(result?.next_cursor ?? cursor);
      if (!Number.isSafeInteger(nextCursor) || nextCursor < cursor ||
          (rows.length && nextCursor < Math.max(...rows.map(row => Number(row.user_seq))))) {
        throw new Error("云端事件游标无效、倒退或未覆盖返回记录；本地游标未改变。");
      }
      if (nextCursor > cursor) {
        cursor = nextCursor;
        if (cursor > storedCursor) await setSyncCursor(userId, cursor);
      }
      if (!result?.has_more || !rows.length || nextCursor <= previousCursor) break;
    }
    return { pulled, received, cursor: Math.max(cursor, storedCursor) };
  }

  async function pullDocuments(userId, { fromBeginning = false } = {}) {
    const storedCursor = await getDocumentSyncCursor(userId);
    let cursor = fromBeginning ? 0 : storedCursor;
    let pulled = 0;
    let received = 0;
    let unchanged = 0;
    let skipped = 0;
    const conflictIds = new Set();
    for (let page = 0; page < 100; page += 1) {
      const previousCursor = cursor;
      const result = await auth.request("/rest/v1/rpc/sync_pull_learning_documents_for_account", {
        method: "POST",
        body: { p_expected_user_id: userId, p_after_document_seq: cursor, p_page_size: 100 },
      });
      const rows = Array.isArray(result?.documents) ? result.documents : [];
      received += rows.length;
      for (const remote of rows) {
        const applied = await applyRemoteLearningArchiveDocument(remote, userId);
        if (applied.status === "conflict") conflictIds.add(remote.document_id);
        else if (applied.status === "applied") pulled += 1;
        else if (applied.reason === "derived-cache-local-only") skipped += 1;
        else unchanged += 1;
      }
      const nextCursor = Number(result?.next_cursor ?? cursor);
      if (!Number.isSafeInteger(nextCursor) || nextCursor < cursor ||
          (rows.length && nextCursor < Math.max(...rows.map(row => Number(row.document_seq))))) {
        throw new Error("云端学习文档游标无效、倒退或未覆盖返回记录；本地游标未改变。");
      }
      if (nextCursor > cursor) {
        cursor = nextCursor;
        if (cursor > storedCursor) await setDocumentSyncCursor(userId, cursor);
      }
      if (!result?.has_more || !rows.length || nextCursor <= previousCursor) break;
    }
    return { pulled, received, unchanged, skipped, cursor: Math.max(cursor, storedCursor), conflictIds: [...conflictIds] };
  }

  async function restoreOperation() {
    if (!config.enabled) return { status: "local-only", operation: "restore", reason: "backend-not-configured" };
    if (!isOnline()) {
      const result = { status: "offline", operation: "restore", reason: "network-unavailable" };
      dispatchStatus(result);
      return result;
    }
    return withLease("restore", async () => {
      dispatchStatus({ status: "restoring", operation: "restore" });
      try {
        const session = await auth.getSession();
        if (!session) {
          const result = { status: "signed-out", operation: "restore" };
          dispatchStatus(result);
          return result;
        }
        const account = await profile();
        if (!account?.authorized) {
          const result = { status: "pending-authorization", operation: "restore", user: session.user || null };
          dispatchStatus(result);
          return result;
        }
        const { userId, device } = await ensureAccountAndDevice(session, account);
        // Manual restore is a full, idempotent reconciliation, not merely an
        // incremental cursor pull. This also repairs a stale cursor whose local
        // records were lost independently. Remote events are append-only and
        // archive documents are revision/CAS protected, so replay is safe.
        const [pulledEvents, pulledDocuments] = await Promise.all([
          pullEvents(userId, { fromBeginning: true }),
          pullDocuments(userId, { fromBeginning: true }),
        ]);
        const localDocuments = await listArchiveDocuments(1000);
        const result = {
          status: "restored",
          operation: "restore",
          restoredEvents: pulledEvents.pulled,
          receivedEvents: pulledEvents.received,
          restoredDocuments: pulledDocuments.pulled,
          receivedDocuments: pulledDocuments.received,
          unchangedDocuments: pulledDocuments.unchanged,
          skippedDocuments: pulledDocuments.skipped,
          localDocuments: localDocuments.length,
          conflicts: new Set(pulledDocuments.conflictIds).size,
          cursor: pulledEvents.cursor,
          documentCursor: pulledDocuments.cursor,
          deviceId: device.id,
        };
        await setArchiveMeta("last-cloud-restore-at", new Date().toISOString());
        dispatchStatus(result);
        return result;
      } catch (error) {
        const result = { status: "error", operation: "restore", message: error.message || "云端恢复失败" };
        dispatchStatus(result);
        throw error;
      }
    });
  }

  async function syncOperation() {
    if (!config.enabled) return { status: "local-only", operation: "sync", reason: "backend-not-configured" };
    if (!isOnline()) {
      const result = { status: "offline", operation: "sync", reason: "network-unavailable" };
      dispatchStatus(result);
      return result;
    }
    return withLease("sync", async () => {
      dispatchStatus({ status: "syncing", operation: "sync" });
      try {
        const session = await auth.getSession();
        if (!session) {
          const result = { status: "signed-out", operation: "sync" };
          dispatchStatus(result);
          return result;
        }
        const account = await profile();
        if (!account?.authorized) {
          const result = { status: "pending-authorization", operation: "sync", user: session.user || null };
          dispatchStatus(result);
          return result;
        }
        const { userId, device } = await ensureAccountAndDevice(session, account);
        const pushed = await pushChanges(device, userId);
        const [pulledEvents, pulledDocuments, pendingEvents] = await Promise.all([
          pullEvents(userId),
          pullDocuments(userId),
          countOutbox(),
        ]);
        const pendingDocuments = await listPendingArchiveDocuments(1000);
        const result = {
          status: pushed.blocked ? "blocked" : (pendingEvents > 0 || pendingDocuments.length > 0 ? "partial" : "synced"),
          operation: "sync",
          blocked: Boolean(pushed.blocked),
          pushed: pushed.pushedEvents,
          pulled: pulledEvents.pulled,
          pushedDocuments: pushed.pushedDocuments,
          pulledDocuments: pulledDocuments.pulled,
          conflicts: new Set([...pushed.conflictIds, ...pulledDocuments.conflictIds]).size,
          pending: pendingEvents,
          pendingDocuments: pendingDocuments.length,
          cursor: pulledEvents.cursor,
          documentCursor: pulledDocuments.cursor,
          deviceId: device.id,
        };
        if (result.status === "synced") {
          await setArchiveMeta("last-successful-sync", new Date().toISOString());
          await setArchiveMeta("last-sync-error", null);
          retryAttempt = 0;
        }
        dispatchStatus(result);
        return result;
      } catch (error) {
        const result = { status: "error", operation: "sync", message: error.message || "同步失败" };
        await setArchiveMeta("last-sync-error", result.message);
        dispatchStatus(result);
        retryAttempt = Math.min(8, retryAttempt + 1);
        scheduleSync();
        throw error;
      }
    });
  }

  async function initialize() {
    if (!config.enabled) {
      const result = { status: "local-only", reason: "backend-not-configured" };
      dispatchStatus(result);
      return result;
    }
    return sync();
  }

  function sync() {
    return enqueue(syncOperation, "sync");
  }
  function restoreFromCloud() {
    return enqueue(restoreOperation, "restore");
  }

  function scheduleSync(delay) {
    if (scheduled || !config.enabled || !isOnline()) return;
    scheduled = true;
    const wait = Number.isFinite(delay) ? delay : Math.min(300000, 1200 * (2 ** retryAttempt));
    retryTimer = setTimeout(() => {
      scheduled = false;
      retryTimer = null;
      sync().catch(error => {
        dispatchStatus({ status: "error", message: error.message || "同步重试失败" });
      });
    }, wait);
  }

  function start() {
    if (typeof window === "undefined") return () => {};
    const onEvents = event => {
      if (!event.detail?.remote) scheduleSync(1200);
    };
    const onArchive = () => scheduleSync(1200);
    const onOnline = () => scheduleSync(0);
    const onVisibility = () => {
      if (document.visibilityState === "visible") scheduleSync(0);
    };
    const onStorageUpgrade = () => dispatchStatus({
      status: "error",
      message: "另一个标签页阻塞了 IndexedDB 数据库升级。请关闭旧版本标签页后刷新。",
    });
    window.addEventListener("knowverse:learning-events-appended", onEvents);
    window.addEventListener("knowverse:learning-archive-capture", onArchive);
    window.addEventListener("knowverse:learning-archive-delete", onArchive);
    window.addEventListener("online", onOnline);
    window.addEventListener("knowverse:database-upgrade-blocked", onStorageUpgrade);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("knowverse:learning-events-appended", onEvents);
      window.removeEventListener("knowverse:learning-archive-capture", onArchive);
      window.removeEventListener("knowverse:learning-archive-delete", onArchive);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("knowverse:database-upgrade-blocked", onStorageUpgrade);
      document.removeEventListener("visibilitychange", onVisibility);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }

  return { initialize, sync, restoreFromCloud, start };
}
