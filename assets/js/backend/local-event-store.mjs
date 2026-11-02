import {
  fingerprintLearningEvent,
  normalizeLearningEvent,
} from "../learning-progress.mjs";

const DB_NAME = "knowverse-learning-archive";
const DB_VERSION = 1;
const STORE_OUTBOX = "outbox";
const STORE_META = "meta";
const STORE_DOCUMENTS = "documents";
const STORE_CONFLICTS = "conflicts";

const randomId = () => globalThis.crypto?.randomUUID?.()
  || "device-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);

function ensureStores(db) {
  if (!db.objectStoreNames.contains(STORE_OUTBOX)) db.createObjectStore(STORE_OUTBOX, { keyPath: "id" });
  if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: "key" });
  if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) db.createObjectStore(STORE_DOCUMENTS, { keyPath: "id" });
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
 * The versioned LearningStateStorage envelope is the single local domain-state source.
 * IndexedDB stores only the durable upload queue, device sequence and archive documents.
 */
export async function persistLearningEvents(events, options = {}) {
  if (options.queue !== true || !Array.isArray(events) || !events.length) return true;
  const validEvents = events.map(normalizeLearningEvent).filter(Boolean);
  if (!validEvents.length) return true;
  const db = await openDatabase();
  try {
    const transaction = db.transaction([STORE_OUTBOX, STORE_META], "readwrite");
    const outbox = transaction.objectStore(STORE_OUTBOX);
    const meta = transaction.objectStore(STORE_META);
    const deviceRequest = meta.get("device");
    deviceRequest.onsuccess = () => {
      const device = deviceRequest.result?.value || {
        id: randomId(), nextSeq: 1, createdAt: new Date().toISOString(),
      };
      let remaining = validEvents.length;
      const finish = () => {
        remaining -= 1;
        if (remaining === 0) meta.put({ key: "device", value: device });
      };
      for (const event of validEvents) {
        const existing = outbox.get(event.id);
        existing.onsuccess = () => {
          if (!existing.result) {
            const deviceSeq = device.nextSeq++;
            outbox.put({
              id: event.id,
              event,
              deviceId: device.id,
              deviceSeq,
              queuedAt: new Date().toISOString(),
            });
          } else {
            const previous = normalizeLearningEvent(existing.result.event);
            if (!previous || fingerprintLearningEvent(previous) !== fingerprintLearningEvent(event)) {
              transaction.abort();
              return;
            }
            if (fingerprintLearningEvent(existing.result.event) !== fingerprintLearningEvent(event)) {
              outbox.put({ ...existing.result, event });
            }
          }
          finish();
        };
        existing.onerror = () => transaction.abort();
      }
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
  const remoteIds = new Set(Array.isArray(snapshot?.remoteEventIds) ? snapshot.remoteEventIds : []);
  return persistLearningEvents(events.filter(event => !remoteIds.has(event.id)), { queue: true });
}

export async function listOutbox(limit = 100) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_OUTBOX, "readwrite");
    const store = transaction.objectStore(STORE_OUTBOX);
    const request = store.getAll();
    const rows = await requestValue(request);
    const rowById = new Map(rows.map(row => [row.id, row]));
    const normalized = rows.map(row => ({
      ...row,
      event: normalizeLearningEvent(row.event),
    }));
    if (normalized.some(row => !row.event)) {
      await transactionDone(transaction);
      throw new Error("本地 Outbox 含无效学习事件，已保留原记录，未继续上传。");
    }
    for (const row of normalized) {
      const original = rowById.get(row.id);
      if (fingerprintLearningEvent(original?.event) !== fingerprintLearningEvent(row.event)) store.put(row);
    }
    await transactionDone(transaction);
    return normalized.sort((a, b) => a.deviceSeq - b.deviceSeq)
      .slice(0, Math.max(1, Math.min(100, limit)));
  } finally {
    db.close();
  }
}

export async function acknowledgeOutbox(eventIds) {
  if (!Array.isArray(eventIds) || !eventIds.length) return 0;
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_OUTBOX, "readwrite");
    const outbox = transaction.objectStore(STORE_OUTBOX);
    for (const id of eventIds) outbox.delete(id);
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

export async function getArchiveStatus(eventCount = 0) {
  const [pendingEvents, documents, conflicts, lastSyncAt, lastSyncError, lastRestoreAt] = await Promise.all([
    countOutbox(),
    listArchiveDocuments(1000),
    listArchiveConflicts(),
    getArchiveMeta("last-successful-sync"),
    getArchiveMeta("last-sync-error"),
    getArchiveMeta("last-cloud-restore-at"),
  ]);
  let device = null;
  try { device = await getLocalDevice(); } catch { /* IndexedDB availability is reported below. */ }
  return {
    indexedDbAvailable: isIndexedDbAvailable(),
    deviceId: device?.id || null,
    documents: documents.length,
    pendingEvents,
    eventRecords: Math.max(0, Number(eventCount) || 0),
    pendingDocuments: documents.filter(item => item.dirty && !item.conflict).length,
    conflicts: conflicts.length,
    lastSyncAt: lastSyncAt || null,
    lastRestoreAt: lastRestoreAt || null,
    lastSyncError: lastSyncError || null,
  };
}
