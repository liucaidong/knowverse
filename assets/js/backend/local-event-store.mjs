import { fingerprintLearningEvent, normalizeLearningEvent } from "../learning-event-schema.mjs";

const DB_NAME = "knowverse-learning-archive";
const DB_VERSION = 4;
const STORE_EVENTS = "learningEvents";
const STORE_OUTBOX = "outbox";
const STORE_SYNC = "syncMetadata";
const STORE_DEVICES = "devices";
const STORE_DOCUMENTS = "learningDocuments";
const STORE_CONFLICTS = "conflicts";
const STORE_MIGRATIONS = "migrationMetadata";
const LEGACY_META = "meta";
const LEGACY_DOCUMENTS = "documents";
const allowedDocumentTypes = new Set([
  "challenge_progress", "review_session", "plan_preferences",
  "learner_profile", "learning_goal", "learning_plan", "learning_plan_head",
  "learning_task", "learning_agent_session", "learning_agent_message",
  "proactive_learning_projection",
]);
const randomId = () => globalThis.crypto?.randomUUID?.()
  || "device-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
const documentId = (type, key) => type + ":" + encodeURIComponent(String(key));

// Proactive projections are disposable, deterministic caches rebuilt from the
// append-only event log on each device. They are intentionally never uploaded
// or pulled as archive documents; syncing them can race a cold event restore.
const isLocalOnlyArchiveDocument = (type, key) =>
  type === "proactive_learning_projection" && key === "current";

// Strategy profile evidence windows are recalculated at bootstrap. Ignore only
// their wall-clock window metadata during comparison; preferences, parameters,
// evidence, history, fingerprints, and decisions remain conflict-protected.
function comparableArchivePayload(type, key, payload) {
  const value = structuredClone(payload);
  const stripStrategyWindowMetadata = profile => {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return;
    delete profile.updatedAt;
    if (profile.observedWindow && typeof profile.observedWindow === "object") {
      delete profile.observedWindow.from;
      delete profile.observedWindow.to;
    }
  };

  if (type === "learner_profile" && key === "strategy") {
    stripStrategyWindowMetadata(value);
  }
  return value;
}
function areEquivalentArchiveDocuments(type, key, localPayload, remotePayload) {
  if (!localPayload || !remotePayload ||
      typeof localPayload !== "object" || typeof remotePayload !== "object" ||
      Array.isArray(localPayload) || Array.isArray(remotePayload)) return false;
  return fingerprintLearningEvent(comparableArchivePayload(type, key, localPayload)) ===
    fingerprintLearningEvent(comparableArchivePayload(type, key, remotePayload));
}
const nowIso = () => new Date().toISOString();

function ensureStore(db, name, options) {
  return db.objectStoreNames.contains(name) ? null : db.createObjectStore(name, options);
}
function ensureIndex(store, name, keyPath, options = {}) {
  if (store && !store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
}
function upgradeDatabase(db, transaction, oldVersion) {
  const events = ensureStore(db, STORE_EVENTS, { keyPath: "id" }) || transaction.objectStore(STORE_EVENTS);
  ensureIndex(events, "byOccurredAt", "occurredAt");
  ensureIndex(events, "byEventType", "eventType");
  ensureIndex(events, "byTopicId", "topicId");
  ensureIndex(events, "byAccountId", "accountId");
  ensureIndex(events, "byAccountOccurredAt", ["accountId", "occurredAt"]);
  ensureIndex(events, "byOrderedAt", ["occurredAt", "userSeq", "deviceId", "deviceSeq", "id"]);
  ensureIndex(events, "byAccountOrderedAt", ["accountId", "occurredAt", "userSeq", "deviceId", "deviceSeq", "id"]);

  const outbox = ensureStore(db, STORE_OUTBOX, { keyPath: "id" }) || transaction.objectStore(STORE_OUTBOX);
  ensureIndex(outbox, "byQueuedAt", "queuedAt");
  ensureIndex(outbox, "byAccountId", "accountId");

  const sync = ensureStore(db, STORE_SYNC, { keyPath: "key" }) || transaction.objectStore(STORE_SYNC);
  const devices = ensureStore(db, STORE_DEVICES, { keyPath: "id" }) || transaction.objectStore(STORE_DEVICES);
  const documents = ensureStore(db, STORE_DOCUMENTS, { keyPath: "id" }) || transaction.objectStore(STORE_DOCUMENTS);
  ensureIndex(documents, "byTypeKey", ["type", "key"]);
  ensureIndex(documents, "byDirty", "dirty");
  ensureIndex(documents, "byUpdatedAt", "updatedAt");
  ensureIndex(documents, "byAccountId", "accountId");
  ensureStore(db, STORE_CONFLICTS, { keyPath: "id" });
  ensureStore(db, STORE_MIGRATIONS, { keyPath: "key" });

  // Copy legacy records based on actual store existence, not assumptions about
  // an intermediate schema version. Existing canonical rows always win.
  const legacyNames = [LEGACY_DOCUMENTS, LEGACY_META]
    .filter(name => db.objectStoreNames.contains(name));
  let pendingLegacyStores = legacyNames.length;
  const finishLegacyStore = () => {
    pendingLegacyStores -= 1;
    if (pendingLegacyStores !== 0) return;
    for (const name of legacyNames) {
      if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
    }
  };

  if (db.objectStoreNames.contains(LEGACY_DOCUMENTS)) {
    const cursorRequest = transaction.objectStore(LEGACY_DOCUMENTS).openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) { finishLegacyStore(); return; }
      const row = cursor.value;
      const existingRequest = documents.get(row.id);
      existingRequest.onsuccess = () => {
        if (!existingRequest.result) documents.put(row);
        cursor.continue();
      };
    };
  }

  if (db.objectStoreNames.contains(LEGACY_META)) {
    const cursorRequest = transaction.objectStore(LEGACY_META).openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) { finishLegacyStore(); return; }
      const row = cursor.value;
      const syncKey = row?.key === "device" ? "device" : row?.key;
      if (!syncKey) { cursor.continue(); return; }
      const existingRequest = sync.get(syncKey);
      existingRequest.onsuccess = () => {
        if (existingRequest.result) { cursor.continue(); return; }
        if (row.key === "device" && row.value?.id) {
          const deviceRequest = devices.get(row.value.id);
          deviceRequest.onsuccess = () => {
            if (!deviceRequest.result) devices.put(row.value);
            sync.put({ key: "device", value: row.value.id });
            cursor.continue();
          };
        } else {
          sync.put(row);
          cursor.continue();
        }
      };
    };
  }

  if (oldVersion < 4) {
    const eventCursor = events.openCursor();
    eventCursor.onsuccess = () => {
      const cursor = eventCursor.result;
      if (!cursor) return;
      const row = cursor.value;
      let changed = false;
      if (row.userSeq === null || row.userSeq === undefined) { row.userSeq = 0; changed = true; }
      if (row.deviceId === null || row.deviceId === undefined) { row.deviceId = ""; changed = true; }
      if (row.deviceSeq === null || row.deviceSeq === undefined) { row.deviceSeq = 0; changed = true; }
      if (changed) cursor.update(row);
      cursor.continue();
    };
  }

  if (oldVersion < 4) {
    const outboxCursor = transaction.objectStore(STORE_OUTBOX).openCursor();
    outboxCursor.onsuccess = () => {
      const cursor = outboxCursor.result;
      if (!cursor) return;
      const queued = cursor.value;
      if (queued?.event && typeof queued.id === "string") {
        const getExisting = events.get(queued.id);
        getExisting.onsuccess = () => {
          if (!getExisting.result) {
            const event = queued.event;
            events.put({
              id: queued.id,
              event,
              accountId: queued.accountId || null,
              deviceId: queued.deviceId || "",
              deviceSeq: Number(queued.deviceSeq) || 0,
              userSeq: 0,
              occurredAt: event.at,
              eventType: event.type,
              topicId: event.topicId || null,
              createdAt: queued.queuedAt || nowIso(),
              syncedAt: null,
            });
          }
          cursor.continue();
        };
      } else {
        cursor.continue();
      }
    };
  }

}
function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
  });
}
function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

async function removeSupersededArchiveConflicts(conflictsStore, id, revision) {
  const rows = await requestValue(conflictsStore.getAll());
  for (const row of rows) {
    if (row.documentId === id && Number(row.remote?.revision || 0) <= revision) {
      conflictsStore.delete(row.id);
    }
  }
}
async function openDatabase() {
  if (!globalThis.indexedDB) throw new Error("This browser does not support IndexedDB.");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = event => {
      try { upgradeDatabase(request.result, request.transaction, event.oldVersion); }
      catch (error) { try { request.transaction.abort(); } catch {} reject(error); }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error("Unable to open the local learning database."));
    request.onblocked = () => {
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("knowverse:database-upgrade-blocked"));
    };
  });
}
async function withTransaction(storeNames, callback, mode = "readwrite") {
  const db = await openDatabase();
  const transaction = db.transaction(storeNames, mode);
  const done = transactionDone(transaction);
  try {
    const result = await callback(transaction);
    await done;
    return result;
  } catch (error) {
    try { transaction.abort(); } catch {}
    await done.catch(() => {});
    if (error?.name === "QuotaExceededError") {
      throw new Error("本地学习数据库空间不足。现有数据已保留；请导出学习档案并释放站点存储空间后重试。", { cause: error });
    }
    throw error;
  } finally { db.close(); }
}
async function getOrCreateDevice(transaction) {
  const sync = transaction.objectStore(STORE_SYNC);
  const devices = transaction.objectStore(STORE_DEVICES);
  const pointer = await requestValue(sync.get("device"));
  let device = pointer?.value ? await requestValue(devices.get(pointer.value)) : null;
  if (!device && pointer?.value && typeof pointer.value === "object") device = pointer.value;
  if (!device) device = { id: randomId(), nextSeq: 1, createdAt: nowIso(), lastSeenAt: nowIso() };
  device.nextSeq = Math.max(1, Number(device.nextSeq) || 1);
  device.lastSeenAt = nowIso();
  devices.put(device);
  sync.put({ key: "device", value: device.id });
  return device;
}
function assertAccount(record, accountId) {
  if (accountId && record?.accountId && record.accountId !== accountId) {
    throw new Error("本地学习记录已绑定另一个账户，拒绝跨账户读取或覆盖。");
  }
}

export const isIndexedDbAvailable = () => Boolean(globalThis.indexedDB);
export async function getLocalDevice() {
  return withTransaction([STORE_SYNC, STORE_DEVICES], getOrCreateDevice);
}

export async function getLocalAccountBinding() {
  return withTransaction([STORE_SYNC], async transaction => {
    const store = transaction.objectStore(STORE_SYNC);
    const current = await requestValue(store.get("bound-user-id"));
    const phaseC = await requestValue(store.get("archive:bound-user-id"));
    return current?.value || phaseC?.value || null;
  }, "readonly");
}

/** Event facts, current documents and the outbound queue commit together. */
export async function commitLearningBatch(input = {}) {
  const incomingEvents = Array.isArray(input.events) ? input.events : [];
  const incomingDocuments = Array.isArray(input.documents) ? input.documents : [];
  const alreadySynced = new Set(input.alreadySyncedEventIds || []);
  const normalizedEvents = new Map();
  for (const raw of incomingEvents) {
    const event = normalizeLearningEvent(raw);
    if (!event) throw new TypeError("拒绝写入结构无效的学习事件。");
    const previous = normalizedEvents.get(event.id);
    if (previous && fingerprintLearningEvent(previous) !== fingerprintLearningEvent(event)) {
      throw new Error("同一批次包含相同事件 ID 的不同内容：" + event.id);
    }
    normalizedEvents.set(event.id, event);
  }
  for (const document of incomingDocuments) {
    if (!document || !allowedDocumentTypes.has(document.type) || typeof document.key !== "string" ||
        !document.key || !document.payload || typeof document.payload !== "object" || Array.isArray(document.payload)) {
      throw new TypeError("学习文档类型、键或 payload 无效。");
    }
    if (new TextEncoder().encode(JSON.stringify(document.payload)).byteLength > 65536) {
      throw new RangeError("学习文档超过本地数据库 64 KiB 限制。");
    }
  }
  return withTransaction(
    [STORE_EVENTS, STORE_OUTBOX, STORE_DEVICES, STORE_SYNC, STORE_DOCUMENTS, STORE_CONFLICTS, STORE_MIGRATIONS],
    async transaction => {
      const eventsStore = transaction.objectStore(STORE_EVENTS);
      const outboxStore = transaction.objectStore(STORE_OUTBOX);
      const documentsStore = transaction.objectStore(STORE_DOCUMENTS);
      const conflictsStore = transaction.objectStore(STORE_CONFLICTS);
      const migrationStore = transaction.objectStore(STORE_MIGRATIONS);
      const boundUser = await requestValue(transaction.objectStore(STORE_SYNC).get("bound-user-id"));
      const phaseCBinding = await requestValue(transaction.objectStore(STORE_SYNC).get("archive:bound-user-id"));
      const boundUserId = boundUser?.value || phaseCBinding?.value || null;
      if (input.accountId && boundUserId && input.accountId !== boundUserId) {
        throw new Error("学习写入账户与本地数据库绑定账户不一致，已拒绝写入。");
      }
      const accountId = input.accountId || boundUserId || null;
      const device = await getOrCreateDevice(transaction);
      const addedEvents = [];
      const changedDocuments = [];
      for (const event of normalizedEvents.values()) {
        const existing = await requestValue(eventsStore.get(event.id));
        const queued = await requestValue(outboxStore.get(event.id));
        assertAccount(existing || queued, accountId);
        if (existing && fingerprintLearningEvent(existing.event) !== fingerprintLearningEvent(event)) {
          throw new Error("稳定事件 ID 对应的内容不可变：" + event.id);
        }
        if (queued && fingerprintLearningEvent(queued.event) !== fingerprintLearningEvent(event)) {
          throw new Error("Outbox 中同一事件 ID 的内容不一致：" + event.id);
        }
        if (!existing) {
          const row = {
            id: event.id, event, accountId: accountId || queued?.accountId || null,
            deviceId: queued?.deviceId || device.id,
            deviceSeq: Number(queued?.deviceSeq) || device.nextSeq++,
            occurredAt: event.at, eventType: event.type, topicId: event.topicId || null,
            createdAt: queued?.queuedAt || nowIso(),
            syncedAt: alreadySynced.has(event.id) ? nowIso() : null, userSeq: 0,
          };
          eventsStore.put(row);
          if (!alreadySynced.has(event.id)) {
            outboxStore.put({
              id: event.id, event, accountId: row.accountId, deviceId: row.deviceId,
              deviceSeq: row.deviceSeq, queuedAt: row.createdAt,
            });
          } else outboxStore.delete(event.id);
          addedEvents.push(event);
        } else if (accountId && !existing.accountId) {
          eventsStore.put({ ...existing, accountId });
          if (queued) outboxStore.put({ ...queued, accountId });
        }
        if (alreadySynced.has(event.id) && existing) {
          outboxStore.delete(event.id);
          eventsStore.put({ ...existing, accountId: accountId || existing.accountId, syncedAt: existing.syncedAt || nowIso() });
        }
      }
      devicesPutNext(transaction, device);
      for (const item of incomingDocuments) {
        const id = documentId(item.type, item.key);
        const previous = await requestValue(documentsStore.get(id));
        assertAccount(previous, accountId);
        if (Number.isSafeInteger(item.expectedLocalRevision) &&
            (Number(previous?.localRevision) || 0) !== item.expectedLocalRevision) {
          throw new Error("本地学习文档版本冲突：" + item.type + "/" + item.key +
            "，请重新读取最新状态后再提交。");
        }
        const payload = structuredClone(item.payload);
        const hash = fingerprintLearningEvent(payload);
        if (previous?.hash === hash && !item.forceRevision) continue;
        const localOnly = isLocalOnlyArchiveDocument(item.type, item.key);
        const next = {
          id, type: item.type, key: item.key, payload, hash,
          accountId: accountId || previous?.accountId || null,
          localRevision: (Number(previous?.localRevision) || 0) + 1,
          cloudRevision: Number(previous?.cloudRevision) || 0,
          baseRevision: Number(previous?.baseRevision ?? previous?.cloudRevision) || 0,
          documentSeq: Number(previous?.documentSeq) || 0, deviceId: device.id,
          updatedAt: nowIso(), dirty: !localOnly, conflict: localOnly ? false : Boolean(previous?.conflict),
        };
        documentsStore.put(next);
        if (localOnly) {
          const oldConflicts = await requestValue(conflictsStore.getAll());
          for (const conflict of oldConflicts) {
            if (conflict.documentId === id) conflictsStore.delete(conflict.id);
          }
        }
        changedDocuments.push(next);
      }
      if (input.migrationMarker) migrationStore.put({ ...input.migrationMarker, completedAt: nowIso() });
      return { addedEvents, changedDocuments, device };
    }
  );
}
function devicesPutNext(transaction, device) {
  transaction.objectStore(STORE_DEVICES).put(device);
  transaction.objectStore(STORE_SYNC).put({ key: "device", value: device.id });
}

export async function persistLearningEvents(events, options = {}) {
  if (options.queue !== true || !Array.isArray(events) || !events.length) return true;
  await commitLearningBatch({ events, accountId: options.accountId });
  return true;
}
export async function getLearningEvents(options = {}) {
  const accountId = options.accountId || null;
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.floor(requestedLimit)
    : Number.POSITIVE_INFINITY;
  const direction = options.order === "desc" ? "prev" : "next";

  return withTransaction([STORE_EVENTS], transaction => new Promise((resolve, reject) => {
    const store = transaction.objectStore(STORE_EVENTS);
    const index = accountId ? store.index("byAccountOrderedAt") : store.index("byOrderedAt");
    const range = accountId && globalThis.IDBKeyRange
      ? IDBKeyRange.bound(
          [accountId, "", 0, "", 0, ""],
          [accountId, "\uffff", Number.MAX_SAFE_INTEGER, "\uffff", Number.MAX_SAFE_INTEGER, "\uffff"]
        )
      : undefined;
    const request = index.openCursor(range, direction);
    const result = [];
    let skipped = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || result.length >= limit) { resolve(result); return; }
      if (skipped < offset) skipped += 1;
      else result.push(structuredClone(cursor.value.event));
      if (result.length >= limit) resolve(result);
      else cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error("读取本地学习事件页失败。"));
  }), "readonly");
}

export async function countLearningEvents() {
  return withTransaction([STORE_EVENTS], tx => requestValue(tx.objectStore(STORE_EVENTS).count()), "readonly");
}
export async function mergeRemoteLearningEvents(rows, accountId) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const result = await withTransaction([STORE_EVENTS, STORE_OUTBOX], async tx => {
    const events = tx.objectStore(STORE_EVENTS);
    const outbox = tx.objectStore(STORE_OUTBOX);
    const addedEvents = [];
    for (const remote of rows) {
      const event = normalizeLearningEvent(remote?.event_payload || remote?.event);
      if (!event || (remote.event_id && remote.event_id !== event.id)) throw new Error("云端返回了无效或 ID 不匹配的学习事件。");
      const existing = await requestValue(events.get(event.id));
      assertAccount(existing, accountId);
      if (existing && fingerprintLearningEvent(existing.event) !== fingerprintLearningEvent(event)) {
        throw new Error("云端事件与本机同 ID 事件内容不一致：" + event.id);
      }
      events.put({
        id: event.id, event, accountId: accountId || existing?.accountId || null,
        deviceId: remote.device_id || existing?.deviceId || "",
        deviceSeq: Number(remote.device_seq) || existing?.deviceSeq || 0,
        userSeq: Number(remote.user_seq) || existing?.userSeq || 0,
        occurredAt: event.at, eventType: event.type, topicId: event.topicId || null,
        createdAt: existing?.createdAt || nowIso(), syncedAt: nowIso(),
      });
      outbox.delete(event.id);
      if (!existing) addedEvents.push(event);
    }
    return { merged: addedEvents.length, addedEvents };
  });
  if (result.addedEvents.length && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("knowverse:learning-events-appended", {
      detail: { events: result.addedEvents, remote: true },
    }));
  }
  return result.merged;
}
export async function acknowledgeOutbox(confirmed) {
  if (!Array.isArray(confirmed) || !confirmed.length) return 0;
  const rows = confirmed.map(item => typeof item === "string" ? { event_id: item } : item)
    .filter(item => typeof item?.event_id === "string");
  if (!rows.length) return 0;
  return withTransaction([STORE_EVENTS, STORE_OUTBOX], async tx => {
    const events = tx.objectStore(STORE_EVENTS);
    const outbox = tx.objectStore(STORE_OUTBOX);
    for (const item of rows) {
      const row = await requestValue(events.get(item.event_id));
      if (row) events.put({ ...row, userSeq: Number(item.user_seq) || row.userSeq || null, syncedAt: nowIso() });
      outbox.delete(item.event_id);
    }
    return rows.length;
  });
}
export async function listOutbox(limit = 100) {
  const rows = await withTransaction([STORE_OUTBOX], tx => requestValue(tx.objectStore(STORE_OUTBOX).getAll()), "readonly");
  return rows.sort((a, b) => Number(a.deviceSeq) - Number(b.deviceSeq))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 100)))
    .map(row => ({ ...row, event: structuredClone(row.event) }));
}
export async function countOutbox() {
  return withTransaction([STORE_OUTBOX], tx => requestValue(tx.objectStore(STORE_OUTBOX).count()), "readonly");
}
async function getSyncValue(key, fallback = 0) {
  return withTransaction([STORE_SYNC], async tx => (await requestValue(tx.objectStore(STORE_SYNC).get(key)))?.value ?? fallback, "readonly");
}
async function setSyncValue(key, value) {
  await withTransaction([STORE_SYNC], async tx => { tx.objectStore(STORE_SYNC).put({ key, value }); });
  return true;
}
export const getSyncCursor = userId => getSyncValue("cursor:" + userId);
export const setSyncCursor = (userId, cursor) => setSyncValue("cursor:" + userId, Math.max(0, Math.floor(Number(cursor) || 0)));
export const getDocumentSyncCursor = userId => getSyncValue("document-cursor:" + userId);
export const setDocumentSyncCursor = (userId, cursor) => setSyncValue("document-cursor:" + userId, Math.max(0, Math.floor(Number(cursor) || 0)));
export const getArchiveMeta = key => getSyncValue("archive:" + key, null);
export const setArchiveMeta = (key, value) => setSyncValue("archive:" + key, value);

export async function bindLocalAccount(userId) {
  if (typeof userId !== "string" || !userId.trim()) throw new TypeError("账户 ID 无效。");
  return withTransaction([STORE_SYNC, STORE_EVENTS, STORE_OUTBOX, STORE_DOCUMENTS, STORE_DEVICES], async tx => {
    const sync = tx.objectStore(STORE_SYNC);
    const existing = await requestValue(sync.get("bound-user-id"));
    const phaseCBinding = await requestValue(sync.get("archive:bound-user-id"));
    const existingUserId = existing?.value || phaseCBinding?.value || null;
    if (existingUserId && existingUserId !== userId) {
      throw new Error("该浏览器的本地学习数据库已绑定另一个账户，拒绝跨账户混用。请先在原账户完成备份和退出。");
    }
    if (existing?.value === userId) return { bound: true, changed: false };
    if (phaseCBinding?.value === userId) {
      sync.put({ key: "bound-user-id", value: userId });
    }
    const events = tx.objectStore(STORE_EVENTS);
    for (const row of await requestValue(events.getAll())) {
      if (row.accountId && row.accountId !== userId) throw new Error("发现属于其他账户的本地学习事件，停止绑定。");
      events.put({ ...row, accountId: userId });
    }
    const outbox = tx.objectStore(STORE_OUTBOX);
    for (const row of await requestValue(outbox.getAll())) {
      if (row.accountId && row.accountId !== userId) throw new Error("发现属于其他账户的待同步事件，停止绑定。");
      outbox.put({ ...row, accountId: userId });
    }
    const documents = tx.objectStore(STORE_DOCUMENTS);
    for (const row of await requestValue(documents.getAll())) {
      if (row.accountId && row.accountId !== userId) throw new Error("发现属于其他账户的学习文档，停止绑定。");
      documents.put({ ...row, accountId: userId });
    }
    const device = await getOrCreateDevice(tx);
    tx.objectStore(STORE_DEVICES).put({ ...device, accountId: userId });
    sync.put({ key: "bound-user-id", value: userId });
    return { bound: true, changed: true };
  });
}
export async function writeArchiveDocument(input) {
  const result = await commitLearningBatch({ documents: [input], accountId: input.accountId });
  return { id: documentId(input.type, input.key), changed: result.changedDocuments.length > 0 };
}
export async function deleteArchiveDocument(type, key, accountId) {
  return writeArchiveDocument({ type, key, accountId, payload: { _deleted: true, deletedAt: nowIso() } });
}
export async function getLearningDocument(type, key) {
  if (!allowedDocumentTypes.has(type)) throw new TypeError("学习文档类型无效。");
  return withTransaction([STORE_DOCUMENTS], async tx => {
    const row = await requestValue(tx.objectStore(STORE_DOCUMENTS).get(documentId(type, key)));
    return row ? structuredClone(row) : null;
  }, "readonly");
}
export async function listArchiveDocuments(limit = 500) {
  const rows = await withTransaction([STORE_DOCUMENTS], tx => requestValue(tx.objectStore(STORE_DOCUMENTS).getAll()), "readonly");
  return rows.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)))
    .slice(0, Math.max(1, Math.min(1000, Number(limit) || 500)));
}
export async function listPendingArchiveDocuments(limit = 50) {
  return (await listArchiveDocuments()).filter(row =>
    row.dirty && !row.conflict && !isLocalOnlyArchiveDocument(row.type, row.key))
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 50)));
}
export async function acknowledgeArchiveDocuments(confirmed) {
  if (!Array.isArray(confirmed) || !confirmed.length) return 0;
  return withTransaction([STORE_DOCUMENTS], async tx => {
    const store = tx.objectStore(STORE_DOCUMENTS);
    for (const item of confirmed) {
      if (!item?.document_id) continue;
      const row = await requestValue(store.get(item.document_id));
      if (!row) continue;
      const unchanged = row.localRevision === Number(item.local_revision);
      const revision = Number(item.revision) || row.cloudRevision;
      store.put({
        ...row, cloudRevision: revision, baseRevision: revision,
        documentSeq: Number(item.document_seq) || row.documentSeq || 0,
        dirty: !unchanged, conflict: false, syncedAt: nowIso(),
      });
    }
    return confirmed.length;
  });
}
export async function applyRemoteArchiveDocument(remote, accountId) {
  if (!remote || !allowedDocumentTypes.has(remote.document_type) ||
      typeof remote.document_key !== "string" || !remote.document_id ||
      !remote.document_payload || typeof remote.document_payload !== "object" || Array.isArray(remote.document_payload)) {
    throw new Error("云端学习文档格式无效。");
  }
  return withTransaction([STORE_DOCUMENTS, STORE_CONFLICTS], async tx => {
    const store = tx.objectStore(STORE_DOCUMENTS);
    const conflicts = tx.objectStore(STORE_CONFLICTS);
    const previous = await requestValue(store.get(remote.document_id));
    assertAccount(previous, accountId);
    if (isLocalOnlyArchiveDocument(remote.document_type, remote.document_key)) {
      if (previous) store.put({ ...previous, dirty: false, conflict: false });
      const oldConflicts = await requestValue(conflicts.getAll());
      for (const conflict of oldConflicts) {
        if (conflict.documentId === remote.document_id) conflicts.delete(conflict.id);
      }
      return { status: "ignored", record: previous || null, reason: "derived-cache-local-only" };
    }
    const revision = Number(remote.revision) || 0;
    if (previous && revision <= Number(previous.cloudRevision || 0)) return { status: "ignored", record: previous };
    const remoteHash = fingerprintLearningEvent(remote.document_payload);
    const exactMatch = previous?.hash === remoteHash;
    const semanticMatch = previous?.dirty && areEquivalentArchiveDocuments(
      remote.document_type, remote.document_key, previous.payload, remote.document_payload,
    );
    if (previous?.dirty && (exactMatch || semanticMatch)) {
      const record = {
        ...previous, accountId: accountId || previous.accountId || null,
        cloudRevision: revision, baseRevision: revision, documentSeq: Number(remote.document_seq) || 0,
        deviceId: remote.device_id || previous.deviceId || null,
        updatedAt: remote.updated_at || previous.updatedAt || nowIso(),
        dirty: false, conflict: false, syncedAt: nowIso(),
      };
      store.put(record);
      await removeSupersededArchiveConflicts(conflicts, remote.document_id, revision);
      return { status: "applied", record, identical: exactMatch, semanticIdentical: semanticMatch };
    }
    if (previous?.dirty && Number(previous.baseRevision || 0) < revision) {
      const conflictId = remote.document_id + ":" + revision;
      store.put({ ...previous, conflict: true });
      conflicts.put({ id: conflictId, documentId: remote.document_id, remote, createdAt: nowIso() });
      return { status: "conflict", record: previous, conflictId };
    }
    if (previous?.dirty && Number(previous.baseRevision || 0) === revision) return { status: "ignored", record: previous };
    const record = {
      id: remote.document_id, type: remote.document_type, key: remote.document_key,
      payload: structuredClone(remote.document_payload), hash: remoteHash,
      accountId: accountId || previous?.accountId || null,
      localRevision: (Number(previous?.localRevision) || 0) + 1,
      cloudRevision: revision, baseRevision: revision, documentSeq: Number(remote.document_seq) || 0,
      deviceId: remote.device_id || null, updatedAt: remote.updated_at || nowIso(),
      dirty: false, conflict: false, syncedAt: nowIso(),
    };
    store.put(record);
    return { status: "applied", record };
  });
}
export async function listArchiveConflicts() {
  // Reconcile legacy timestamp-only conflicts and retire rows for local-only
  // rebuildable caches. True user-owned document differences remain explicit.
  return withTransaction([STORE_DOCUMENTS, STORE_CONFLICTS], async tx => {
    const documents = tx.objectStore(STORE_DOCUMENTS);
    const conflicts = tx.objectStore(STORE_CONFLICTS);
    const [documentRows, conflictRows] = await Promise.all([
      requestValue(documents.getAll()),
      requestValue(conflicts.getAll()),
    ]);
    const resolvedRevisionByDocument = new Map();

    for (const local of documentRows) {
      if (isLocalOnlyArchiveDocument(local.type, local.key)) {
        if (local.dirty || local.conflict) documents.put({ ...local, dirty: false, conflict: false });
        // This cache has no authoritative cloud revision; retire every legacy
        // conflict row for it, regardless of the stale server-side revision.
        resolvedRevisionByDocument.set(local.id, Number.MAX_SAFE_INTEGER);
        continue;
      }
      const candidates = conflictRows.filter(row => row.documentId === local.id && row.remote);
      if (!candidates.length) continue;
      const matching = candidates.filter(row => {
        const remote = row.remote;
        const type = remote.document_type || local.type;
        const key = remote.document_key || local.key;
        return type === local.type && key === local.key &&
          areEquivalentArchiveDocuments(type, key, local.payload, remote.document_payload);
      });
      if (!matching.length) continue;

      const latest = matching.reduce((best, row) =>
        Number(row.remote.revision || 0) > Number(best.remote.revision || 0) ? row : best);
      const remote = latest.remote;
      const revision = Number(remote.revision) || 0;
      if (revision < Number(local.cloudRevision || 0)) continue;

      documents.put({
        ...local,
        cloudRevision: revision,
        baseRevision: revision,
        documentSeq: Number(remote.document_seq) || local.documentSeq || 0,
        deviceId: remote.device_id || local.deviceId || null,
        dirty: false,
        conflict: false,
        syncedAt: nowIso(),
      });
      resolvedRevisionByDocument.set(local.id, revision);
    }

    const unresolved = [];
    for (const row of conflictRows) {
      const resolvedRevision = resolvedRevisionByDocument.get(row.documentId);
      const remoteRevision = Number(row.remote?.revision) || 0;
      if (resolvedRevision !== undefined && remoteRevision <= resolvedRevision) {
        conflicts.delete(row.id);
      } else {
        unresolved.push(row);
      }
    }
    return unresolved.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  });
}
export async function resolveArchiveConflict(conflictId, choice) {
  if (!["local", "remote"].includes(choice)) throw new TypeError("冲突解决方式无效。");
  return withTransaction([STORE_DOCUMENTS, STORE_CONFLICTS], async tx => {
    const conflicts = tx.objectStore(STORE_CONFLICTS);
    const documents = tx.objectStore(STORE_DOCUMENTS);
    const conflict = await requestValue(conflicts.get(conflictId));
    if (!conflict) return null;
    const current = await requestValue(documents.get(conflict.documentId));
    if (!current) throw new Error("冲突对应的本地学习文档已不存在，未删除冲突记录。");
    const remote = conflict.remote;
    const revision = Number(remote.revision) || 0;
    const resolved = choice === "remote" ? {
      ...current, payload: structuredClone(remote.document_payload),
      hash: fingerprintLearningEvent(remote.document_payload), cloudRevision: revision, baseRevision: revision,
      documentSeq: Number(remote.document_seq) || 0, deviceId: remote.device_id || null,
      updatedAt: remote.updated_at || nowIso(), dirty: false, conflict: false, syncedAt: nowIso(),
    } : {
      ...current, cloudRevision: revision, baseRevision: revision,
      dirty: true, conflict: false, updatedAt: nowIso(),
    };
    documents.put(resolved);
    conflicts.delete(conflictId);
    return resolved;
  });
}
export async function getMigrationMetadata(key) {
  return withTransaction([STORE_MIGRATIONS], tx => requestValue(tx.objectStore(STORE_MIGRATIONS).get(key)), "readonly");
}
export async function importPhaseCLearningState(input) {
  const result = await commitLearningBatch({
    events: input.events, documents: input.documents,
    alreadySyncedEventIds: input.remoteEventIds,
    migrationMarker: {
      key: input.markerKey, status: "completed", sourceFingerprint: input.sourceFingerprint,
      sourceRevision: input.sourceRevision, eventCount: input.events.length,
      documentCount: input.documents.length, importedAt: nowIso(),
    },
  });
  return { events: result.addedEvents.length, documents: result.changedDocuments.length };
}
export async function getArchiveStatus() {
  const [pendingEvents, eventRecords, documents, conflicts, lastSyncAt, lastSyncError, lastRestoreAt] = await Promise.all([
    countOutbox(), countLearningEvents(), listArchiveDocuments(), listArchiveConflicts(),
    getArchiveMeta("last-successful-sync"), getArchiveMeta("last-sync-error"), getArchiveMeta("last-cloud-restore-at"),
  ]);
  let device = null;
  try { device = await getLocalDevice(); } catch {}
  return {
    indexedDbAvailable: isIndexedDbAvailable(), deviceId: device?.id || null,
    documents: documents.length, pendingEvents, eventRecords,
    pendingDocuments: documents.filter(item =>
      item.dirty && !item.conflict && !isLocalOnlyArchiveDocument(item.type, item.key)).length,
    conflicts: conflicts.length, lastSyncAt: lastSyncAt || null,
    lastRestoreAt: lastRestoreAt || null, lastSyncError: lastSyncError || null,
  };
}
export async function acquireSyncLease(name, owner, leaseMs = 300000) {
  return withTransaction([STORE_SYNC], async tx => {
    const store = tx.objectStore(STORE_SYNC);
    const key = "lease:" + name;
    const current = await requestValue(store.get(key));
    const now = Date.now();
    if (current?.owner && current.owner !== owner && Number(current.expiresAt) > now) return false;
    store.put({ key, owner, expiresAt: now + Math.max(30000, leaseMs), updatedAt: nowIso() });
    return true;
  });
}
export async function releaseSyncLease(name, owner) {
  return withTransaction([STORE_SYNC], async tx => {
    const store = tx.objectStore(STORE_SYNC);
    const key = "lease:" + name;
    const current = await requestValue(store.get(key));
    if (current?.owner === owner) store.delete(key);
    return true;
  });
}
export async function deleteLocalDatabaseForTests() {
  if (!globalThis.indexedDB) return false;
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error || new Error("Unable to reset test database."));
    request.onblocked = () => reject(new Error("Test database reset was blocked by an open connection."));
  });
  return true;
}

export async function getLocalDatabaseDiagnostics() {
  const [eventCount, outboxCount, documents, conflicts, migrations] = await Promise.all([
    countLearningEvents(), countOutbox(), listArchiveDocuments(), listArchiveConflicts(),
    withTransaction([STORE_MIGRATIONS], tx => requestValue(tx.objectStore(STORE_MIGRATIONS).getAll()), "readonly"),
  ]);
  return {
    database: DB_NAME, version: DB_VERSION,
    stores: [STORE_EVENTS, STORE_DOCUMENTS, STORE_OUTBOX, STORE_SYNC, STORE_DEVICES, STORE_CONFLICTS, STORE_MIGRATIONS],
    eventCount, outboxCount, documentCount: documents.length, conflictCount: conflicts.length, migrations,
  };
}
