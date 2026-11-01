import { BACKEND_CONFIG } from "./config.mjs";
import {
  acknowledgeOutbox,
  countOutbox,
  getLocalDevice,
  getSyncCursor,
  listOutbox,
  persistLearningEvents,
  reconcileLocalSnapshot,
  setSyncCursor,
} from "./local-event-store.mjs";

const cleanEvent = event => Object.fromEntries(Object.entries(event || {}).filter(([key]) => !key.startsWith("_")));
const dispatchStatus = detail => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("knowverse:sync-state", { detail }));
  }
};

export function createLearningSyncService(auth, progressStore, config = BACKEND_CONFIG) {
  let running = false;
  let scheduled = false;
  let rerunRequested = false;

  async function profile() {
    return auth.request("/rest/v1/rpc/get_learning_sync_profile", { method: "POST", body: {} });
  }

  async function sync() {
    if (running) {
      rerunRequested = true;
      return { status: "syncing" };
    }
    if (!config.enabled) return { status: "local-only", reason: "backend-not-configured" };
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

      const device = await getLocalDevice();
      await auth.request("/rest/v1/rpc/register_device", {
        method: "POST",
        body: {
          p_device_id: device.id,
          p_label: "KNOWVERSE 浏览器设备",
          p_platform: "web",
        },
      });

      await reconcileLocalSnapshot(progressStore.load());
      let pushed = 0;
      for (;;) {
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

      const cursorKey = session.user?.id || account.user_id || "current";
      let cursor = await getSyncCursor(cursorKey);
      let pulled = 0;
      for (let page = 0; page < 20; page += 1) {
        const previousCursor = cursor;
        const result = await auth.request("/rest/v1/rpc/sync_pull_learning_events", {
          method: "POST",
          body: { p_after_user_seq: cursor, p_page_size: 100 },
        });
        const rows = Array.isArray(result?.events) ? result.events : [];
        const remoteEvents = rows
          .filter(row => row.event_payload && typeof row.event_payload.id === "string")
          .map(row => row.event_payload);
        if (remoteEvents.length) {
          if (!progressStore.appendMany(remoteEvents, { remote: true })) {
            throw new Error("云端事件已读取，但合并到本地学习档案失败；同步游标未推进。");
          }
          await persistLearningEvents(remoteEvents, { origin: "cloud" });
          pulled += remoteEvents.length;
        }
        const nextCursor = Number(result?.next_cursor ?? cursor);
        if (nextCursor > cursor) {
          cursor = nextCursor;
          await setSyncCursor(cursorKey, cursor);
        }
        if (!result?.has_more || !rows.length || nextCursor <= previousCursor) break;
      }

      const pending = await countOutbox();
      const outcome = { status: "synced", pushed, pulled, pending, cursor };
      dispatchStatus(outcome);
      return outcome;
    } catch (error) {
      const result = { status: "error", message: error.message || "同步失败" };
      dispatchStatus(result);
      throw error;
    } finally {
      running = false;
      if (rerunRequested) {
        rerunRequested = false;
        scheduleSync();
      }
    }
  }

  async function initialize() {
    if (!config.enabled) {
      const result = { status: "local-only", reason: "backend-not-configured" };
      dispatchStatus(result);
      return result;
    }
    await reconcileLocalSnapshot(progressStore.load());
    return sync();
  }

  function scheduleSync() {
    if (scheduled || !config.enabled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      sync().catch(() => {});
    }, 1200);
  }

  function start() {
    if (typeof window === "undefined") return () => {};
    const onEvents = event => {
      if (event.detail?.remote) return;
      persistLearningEvents(event.detail?.events || []).then(scheduleSync).catch(error => {
        dispatchStatus({ status: "local-only", message: "IndexedDB Outbox 写入失败：" + error.message });
      });
    };
    window.addEventListener("knowverse:learning-events-appended", onEvents);
    return () => window.removeEventListener("knowverse:learning-events-appended", onEvents);
  }

  return { initialize, sync, start };
}
