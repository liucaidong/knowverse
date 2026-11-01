const DB_NAME = "knowverse-learning-store";
const DB_VERSION = 2;
const STORE_EVENTS = "events";
const STORE_OUTBOX = "outbox";
const STORE_META = "meta";
const STORE_DOCUMENTS = "documents";
const STORE_MIGRATIONS = "migrations";
const STORE_CONFLICTS = "conflicts";

const randomId = () => globalThis.crypto?.randomUUID?.()
  || "device-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);

function ensureStores(db) {
  if (!db.objectStoreNames.contains(STORE_EVENTS)) db.createObjectStore(STORE_EVENTS, { keyPath: "id" });
  if (!db.objectStoreNames.contains(STORE_OUTBOX)) db.createObjectStore(STORE_OUTBOX, { keyPath: "id" });
  if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: "key" });
  if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) db.createObjectStore(STORE_DOCUMENTS, { keyPath: "id" });
  if (!db.objectStoreNames.contains(STORE_MIGRATIONS)) db.createObjectStore(STORE_MIGRATIONS, { keyPath: "id" });
  if (!db.objectStoreNames.contains(STORE_CONFLICTS)) db.createObjectStore(STORE_CONFLICTS, { keyPath: "id" });
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("当前浏览器不支持 IndexedDB。"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => ensureStores(request.result);
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error("IndexedDB 打开失败。"));
    request.onblocked = () => reject(new Error("IndexedDB 升级被其他标签页阻塞，请关闭其他 KNOWVERSE 标签页后重试。"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB 事务失败。"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB 事务已中止。"));
  });
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB 请求失败。"));
  });
}

export function isIndexedDbAvailable() {
  return Boolean(globalThis.indexedDB);
}

export async function getLocalDevice() {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_META, "readwrite");
    const store = transaction.objectStore(STORE_META);
    const request = store.get("device");
    let device;
    request.onsuccess = () => {
      device = request.result?.value || { id: randomId(), nextSeq: 1, createdAt: new Date().toISOString() };
      store.put({ key: "device", value: device });
    };
    await transactionDone(transaction);
    return device;
  } finally {
    db.close();
  }
}

/**
 * Maintains a durable IndexedDB event mirror and retryable Outbox.
 * queue:false mirrors local facts without treating an unsigned local-only
 * learner as a cloud-sync user. The first authenticated sync reconciles the
 * complete event snapshot into the Outbox.
 */
export async function persistLearningEvents(events, options = {}) {
  if (!Array.isArray(events) || !events.length) return true;
  const origin = options.origin === "cloud" ? "cloud" : "local";
  const queue = options.queue !== false && origin !== "cloud";
  const validEvents = events.filter(event => event && typeof event.id === "string" && event.id);
  if (!validEvents.length) return true;
  const db = await openDatabase();
  try {
    const transaction = db.transaction([STORE_EVENTS, STORE_OUTBOX, STORE_META], "readwrite");
    const eventStore = transaction.objectStore(STORE_EVENTS);
    const outbox = transaction.objectStore(STORE_OUTBOX);
    const meta = transaction.objectStore(STORE_META);
    let device = { id: randomId(), nextSeq: 1, createdAt: new Date().toISOString() };

    const deviceRequest = meta.get("device");
    deviceRequest.onsuccess = () => {
      device = deviceRequest.result?.value || device;
      let remaining = validEvents.length;
      const finishOne = () => {
        remaining -= 1;
        if (remaining === 0) meta.put({ key: "device", value: device });
      };

      for (const event of validEvents) {
        if (origin === "cloud") {
          eventStore.put({ id: event.id, event, origin: "cloud", synced: true });
          finishOne();
          continue;
        }

        const existingEvent = eventStore.get(event.id);
        existingEvent.onsuccess = () => {
          if (existingEvent.result?.origin === "cloud" || existingEvent.result?.synced === true) {
            finishOne();
            return;
          }
          const existingQueue = outbox.get(event.id);
          existingQueue.onsuccess = () => {
            if (existingQueue.result) {
              eventStore.put({ id: event.id, event, origin: "local", synced: false });
              finishOne();
              return;
            }
            if (!queue) {
              eventStore.put({ id: event.id, event, origin: "local", synced: false });
              finishOne();
              return;
            }
            const deviceSeq = device.nextSeq++;
            eventStore.put({ id: event.id, event, origin: "local", synced: false, deviceSeq });
            outbox.put({
              id: event.id,
              event,
              deviceId: device.id,
              deviceSeq,
              queuedAt: new Date().toISOString(),
            });
            finishOne();
          };
          existingQueue.onerror = () => transaction.abort();
        };
        existingEvent.onerror = () => transaction.abort();
      }
      if (!validEvents.length) meta.put({ key: "device", value: device });
    };
    deviceRequest.onerror = () => transaction.abort();
    await transactionDone(transaction);
    return true;
  } finally {
    db.close();
  }
}

export async function reconcileLocalSnapshot(snapshot) {
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  return persistLearningEvents(events, { origin: "local", queue: true });
}

export async function listOutbox(limit = 100) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_OUTBOX, "readonly");
    const request = transaction.objectStore(STORE_OUTBOX).getAll();
    const rows = await requestValue(request);
    await transactionDone(transaction);
    return rows.sort((a, b) => a.deviceSeq - b.deviceSeq)
      .slice(0, Math.max(1, Math.min(100, limit)));
  } finally {
    db.close();
  }
}

export async function acknowledgeOutbox(eventIds) {
  if (!Array.isArray(eventIds) || !eventIds.length) return 0;
  const db = await openDatabase();
  try {
    const transaction = db.transaction([STORE_EVENTS, STORE_OUTBOX], "readwrite");
    const events = transaction.objectStore(STORE_EVENTS);
    const outbox = transaction.objectStore(STORE_OUTBOX);
    for (const id of eventIds) {
      outbox.delete(id);
      const request = events.get(id);
      request.onsuccess = () => {
        if (request.result) events.put({ ...request.result, synced: true, syncedAt: new Date().toISOString() });
      };
    }
    await transactionDone(transaction);
    return eventIds.length;
  } finally {
    db.close();
  }
}

export async function countOutbox() {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_OUTBOX, "readonly");
    const count = await requestValue(transaction.objectStore(STORE_OUTBOX).count());
    await transactionDone(transaction);
    return count;
  } finally {
    db.close();
  }
}

export async function countEventRecords() {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_EVENTS, "readonly");
    const count = await requestValue(transaction.objectStore(STORE_EVENTS).count());
    await transactionDone(transaction);
    return count;
  } finally {
    db.close();
  }
}

export async function getSyncCursor(userId) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_META, "readonly");
    const row = await requestValue(transaction.objectStore(STORE_META).get("cursor:" + userId));
    await transactionDone(transaction);
    return Number(row?.value || 0);
  } finally {
    db.close();
  }
}

export async function setSyncCursor(userId, cursor) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_META, "readwrite");
    transaction.objectStore(STORE_META).put({
      key: "cursor:" + userId,
      value: Math.max(0, Math.floor(Number(cursor) || 0)),
    });
    await transactionDone(transaction);
    return true;
  } finally {
    db.close();
  }
}

export async function getDocumentSyncCursor(userId) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_META, "readonly");
    const row = await requestValue(transaction.objectStore(STORE_META).get("document-cursor:" + userId));
    await transactionDone(transaction);
    return Number(row?.value || 0);
  } finally {
    db.close();
  }
}

export async function setDocumentSyncCursor(userId, cursor) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_META, "readwrite");
    transaction.objectStore(STORE_META).put({
      key: "document-cursor:" + userId,
      value: Math.max(0, Math.floor(Number(cursor) || 0)),
    });
    await transactionDone(transaction);
    return true;
  } finally {
    db.close();
  }
}

export async function getArchiveMeta(key) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_META, "readonly");
    const row = await requestValue(transaction.objectStore(STORE_META).get("archive:" + key));
    await transactionDone(transaction);
    return row?.value ?? null;
  } finally {
    db.close();
  }
}

export async function setArchiveMeta(key, value) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_META, "readwrite");
    transaction.objectStore(STORE_META).put({ key: "archive:" + key, value });
    await transactionDone(transaction);
    return true;
  } finally {
    db.close();
  }
}

const allowedDocumentTypes = new Set(["challenge_progress", "review_session", "plan_preferences"]);
const documentId = (type, key) => type + ":" + encodeURIComponent(String(key));

export async function writeArchiveDocument(input) {
  if (!input || !allowedDocumentTypes.has(input.type) || typeof input.key !== "string" || !input.key) {
    throw new TypeError("学习档案文档类型或键无效。");
  }
  const payload = input.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("学习档案文档必须是 JSON 对象。");
  }
  const id = documentId(input.type, input.key);
  const hash = JSON.stringify(payload);
  const device = await getLocalDevice();
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_DOCUMENTS, "readwrite");
    const store = transaction.objectStore(STORE_DOCUMENTS);
    const request = store.get(id);
    let changed = false;
    request.onsuccess = () => {
      const previous = request.result;
      if (previous?.hash === hash) return;
      const record = {
        id,
        type: input.type,
        key: input.key,
        payload,
        hash,
        localRevision: (previous?.localRevision || 0) + 1,
        cloudRevision: previous?.cloudRevision || 0,
        baseRevision: previous?.cloudRevision || previous?.baseRevision || 0,
        deviceId: device.id,
        updatedAt: new Date().toISOString(),
        dirty: true,
        conflict: Boolean(previous?.conflict),
      };
      store.put(record);
      changed = true;
    };
    await transactionDone(transaction);
    return { id, changed };
  } finally {
    db.close();
  }
}

export async function deleteArchiveDocument(type, key) {
  return writeArchiveDocument({ type, key, payload: { _deleted: true } });
}

export async function listArchiveDocuments(limit = 500) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_DOCUMENTS, "readonly");
    const rows = await requestValue(transaction.objectStore(STORE_DOCUMENTS).getAll());
    await transactionDone(transaction);
    return rows.slice(0, Math.max(1, Math.min(1000, limit)));
  } finally {
    db.close();
  }
}

export async function listPendingArchiveDocuments(limit = 50) {
  const rows = await listArchiveDocuments(1000);
  return rows.filter(row => row.dirty && !row.conflict)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, Math.max(1, Math.min(50, limit)));
}

export async function acknowledgeArchiveDocuments(confirmed) {
  if (!Array.isArray(confirmed) || !confirmed.length) return 0;
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_DOCUMENTS, "readwrite");
    const store = transaction.objectStore(STORE_DOCUMENTS);
    for (const item of confirmed) {
      if (!item?.document_id) continue;
      const request = store.get(item.document_id);
      request.onsuccess = () => {
        const row = request.result;
        if (!row) return;
        const acknowledgedRevision = Number(item.revision) || row.cloudRevision;
        const unchangedSincePush = row.localRevision === Number(item.local_revision);
        store.put({
          ...row,
          cloudRevision: acknowledgedRevision,
          baseRevision: acknowledgedRevision,
          documentSeq: Number(item.document_seq) || row.documentSeq || 0,
          dirty: !unchangedSincePush,
          conflict: false,
          syncedAt: new Date().toISOString(),
        });
      };
    }
    await transactionDone(transaction);
    return confirmed.length;
  } finally {
    db.close();
  }
}

export async function applyRemoteArchiveDocument(remote) {
  if (!remote || !allowedDocumentTypes.has(remote.document_type) || !remote.document_key ||
      !remote.document_id || !remote.document_payload || typeof remote.document_payload !== "object") {
    throw new Error("云端学习档案文档格式无效。");
  }
  const db = await openDatabase();
  try {
    const transaction = db.transaction([STORE_DOCUMENTS, STORE_CONFLICTS], "readwrite");
    const store = transaction.objectStore(STORE_DOCUMENTS);
    const conflicts = transaction.objectStore(STORE_CONFLICTS);
    const request = store.get(remote.document_id);
    let result = { status: "ignored", record: null };
    request.onsuccess = () => {
      const previous = request.result;
      const revision = Number(remote.revision) || 0;
      if (previous && revision <= Number(previous.cloudRevision || 0)) return;
      const remoteHash = JSON.stringify(remote.document_payload);
      if (previous?.dirty && previous.hash === remoteHash) {
        const record = {
          ...previous,
          cloudRevision: revision,
          baseRevision: revision,
          documentSeq: Number(remote.document_seq) || 0,
          deviceId: remote.device_id || previous.deviceId || null,
          updatedAt: remote.updated_at || new Date().toISOString(),
          dirty: false,
          conflict: false,
          syncedAt: new Date().toISOString(),
        };
        store.put(record);
        result = { status: "applied", record, identical: true };
        return;
      }
      if (previous?.dirty && Number(previous.baseRevision || 0) < revision) {
        const conflictId = remote.document_id + ":" + revision;
        previous.conflict = true;
        store.put(previous);
        conflicts.put({
          id: conflictId,
          documentId: remote.document_id,
          remote,
          createdAt: new Date().toISOString(),
        });
        result = { status: "conflict", record: previous, conflictId };
        return;
      }
      if (previous?.dirty && Number(previous.baseRevision || 0) === revision) return;
      const record = {
        id: remote.document_id,
        type: remote.document_type,
        key: remote.document_key,
        payload: remote.document_payload,
        hash: JSON.stringify(remote.document_payload),
        localRevision: (previous?.localRevision || 0) + 1,
        cloudRevision: revision,
        baseRevision: revision,
        documentSeq: Number(remote.document_seq) || 0,
        deviceId: remote.device_id || null,
        updatedAt: remote.updated_at || new Date().toISOString(),
        dirty: false,
        conflict: false,
      };
      store.put(record);
      result = { status: "applied", record };
    };
    await transactionDone(transaction);
    return result;
  } finally {
    db.close();
  }
}

export async function listArchiveConflicts() {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_CONFLICTS, "readonly");
    const rows = await requestValue(transaction.objectStore(STORE_CONFLICTS).getAll());
    await transactionDone(transaction);
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } finally {
    db.close();
  }
}

export async function resolveArchiveConflict(conflictId, choice) {
  if (!["local", "remote"].includes(choice)) throw new TypeError("冲突解决方式无效。");
  const db = await openDatabase();
  try {
    const transaction = db.transaction([STORE_DOCUMENTS, STORE_CONFLICTS], "readwrite");
    const conflicts = transaction.objectStore(STORE_CONFLICTS);
    const documents = transaction.objectStore(STORE_DOCUMENTS);
    const conflictRequest = conflicts.get(conflictId);
    let resolved = null;
    conflictRequest.onsuccess = () => {
      const conflict = conflictRequest.result;
      if (!conflict) return;
      const documentRequest = documents.get(conflict.documentId);
      documentRequest.onsuccess = () => {
        const current = documentRequest.result;
        if (!current) return;
        const remote = conflict.remote;
        const remoteRevision = Number(remote.revision) || 0;
        if (choice === "remote") {
          resolved = {
            ...current,
            payload: remote.document_payload,
            hash: JSON.stringify(remote.document_payload),
            cloudRevision: remoteRevision,
            baseRevision: remoteRevision,
            documentSeq: Number(remote.document_seq) || 0,
            deviceId: remote.device_id || null,
            updatedAt: remote.updated_at || new Date().toISOString(),
            dirty: false,
            conflict: false,
          };
        } else {
          resolved = {
            ...current,
            cloudRevision: remoteRevision,
            baseRevision: remoteRevision,
            dirty: true,
            conflict: false,
            updatedAt: new Date().toISOString(),
          };
        }
        documents.put(resolved);
        conflicts.delete(conflictId);
      };
    };
    await transactionDone(transaction);
    return resolved;
  } finally {
    db.close();
  }
}

export async function getArchiveStatus() {
  const [pendingEvents, documents, conflicts, migration, lastSyncAt, lastSyncError] = await Promise.all([
    countOutbox(),
    listArchiveDocuments(1000),
    listArchiveConflicts(),
    getArchiveMeta("legacy-localstorage-v1"),
    getArchiveMeta("last-successful-sync"),
    getArchiveMeta("last-sync-error"),
  ]);
  let device = null;
  try { device = await getLocalDevice(); } catch { /* IndexedDB availability is reported below. */ }
  return {
    indexedDbAvailable: isIndexedDbAvailable(),
    deviceId: device?.id || null,
    documents: documents.length,
    pendingEvents,
    eventRecords: await countEventRecords(),
    pendingDocuments: documents.filter(item => item.dirty && !item.conflict).length,
    conflicts: conflicts.length,
    migration: migration?.status || "not-started",
    migrationAt: migration?.completedAt || null,
    lastSyncAt: lastSyncAt || null,
    lastSyncError: lastSyncError || null,
  };
}
