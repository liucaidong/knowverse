const DB_NAME = "knowverse-learning-store";
const DB_VERSION = 1;
const STORE_EVENTS = "events";
const STORE_OUTBOX = "outbox";
const STORE_META = "meta";

const randomId = () => globalThis.crypto?.randomUUID?.()
  || "device-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("当前浏览器不支持 IndexedDB。"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_EVENTS)) db.createObjectStore(STORE_EVENTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) db.createObjectStore(STORE_OUTBOX, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: "key" });
    };
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
 * Maintains a transactional IndexedDB event mirror and retryable Outbox.
 * LocalStorage remains the compatibility source for the existing synchronous
 * challenge/review engines until their public APIs can be migrated atomically.
 */
export async function persistLearningEvents(events, options = {}) {
  if (!Array.isArray(events) || !events.length) return true;
  const origin = options.origin === "cloud" ? "cloud" : "local";
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
      for (const event of events) {
        if (!event || typeof event.id !== "string" || !event.id) continue;
        if (origin === "cloud") {
          eventStore.put({ id: event.id, event, origin: "cloud", synced: true });
          continue;
        }
        const existingEvent = eventStore.get(event.id);
        existingEvent.onsuccess = () => {
          if (existingEvent.result?.origin === "cloud" || existingEvent.result?.synced === true) return;
          const existingQueue = outbox.get(event.id);
          existingQueue.onsuccess = () => {
            if (existingQueue.result) {
              eventStore.put({ id: event.id, event, origin: "local", synced: false });
              return;
            }
            const deviceSeq = device.nextSeq++;
            eventStore.put({ id: event.id, event, origin: "local", synced: false });
            outbox.put({
              id: event.id,
              event,
              deviceId: device.id,
              deviceSeq,
              queuedAt: new Date().toISOString(),
            });
            meta.put({ key: "device", value: device });
          };
        };
      }
      meta.put({ key: "device", value: device });
    };
    await transactionDone(transaction);
    return true;
  } finally {
    db.close();
  }
}

export async function reconcileLocalSnapshot(snapshot) {
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  return persistLearningEvents(events, { origin: "local" });
}

export async function listOutbox(limit = 100) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_OUTBOX, "readonly");
    const request = transaction.objectStore(STORE_OUTBOX).getAll();
    const rows = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    await transactionDone(transaction);
    return rows.sort((a, b) => a.deviceSeq - b.deviceSeq).slice(0, Math.max(1, Math.min(100, limit)));
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
    const request = transaction.objectStore(STORE_OUTBOX).count();
    const count = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
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
    const request = transaction.objectStore(STORE_META).get("cursor:" + userId);
    const row = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
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
    transaction.objectStore(STORE_META).put({ key: "cursor:" + userId, value: Math.max(0, Number(cursor) || 0) });
    await transactionDone(transaction);
    return true;
  } finally {
    db.close();
  }
}
