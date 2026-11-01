import {
  deleteArchiveDocument,
  getLocalDevice,
  getMigrationRecord,
  listArchiveDocuments,
  persistLearningEvents,
  resolveArchiveConflict,
  setMigrationRecord,
  writeArchiveDocument,
  applyRemoteArchiveDocument,
} from "./local-event-store.mjs";

const EVENT_KEYS = ["knowverse:learning-progress:v2", "knowverse:learning-progress:v1"];
const CHALLENGE_PREFIX = "knowverse:challenge:v1:";
const REVIEW_PREFIX = "knowverse:review-session:v1:";
const PREFERENCES_KEY = "knowverse:learning-plan:preferences:v1";
const MIGRATION_KEY = "legacy-localstorage-v1";

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function getStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function legacyKey(type, key) {
  if (type === "challenge_progress") return CHALLENGE_PREFIX + encodeURIComponent(key);
  if (type === "review_session") return REVIEW_PREFIX + encodeURIComponent(key);
  if (type === "plan_preferences") return PREFERENCES_KEY;
  return null;
}

function parseLocalDocuments(storage) {
  const documents = [];
  const errors = [];
  if (!storage) return { documents, errors: ["浏览器未开放 LocalStorage。"] };
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    let type = null;
    let documentKey = null;
    if (key.startsWith(CHALLENGE_PREFIX)) {
      type = "challenge_progress";
      try { documentKey = decodeURIComponent(key.slice(CHALLENGE_PREFIX.length)); } catch { documentKey = key.slice(CHALLENGE_PREFIX.length); }
    } else if (key.startsWith(REVIEW_PREFIX)) {
      type = "review_session";
      try { documentKey = decodeURIComponent(key.slice(REVIEW_PREFIX.length)); } catch { documentKey = key.slice(REVIEW_PREFIX.length); }
    } else if (key === PREFERENCES_KEY) {
      type = "plan_preferences";
      documentKey = "preferences";
    }
    if (!type || !documentKey) continue;
    try {
      const payload = JSON.parse(storage.getItem(key) || "null");
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        errors.push("旧档案不是有效 JSON 对象：" + key);
        continue;
      }
      documents.push({ type, key: documentKey, payload });
    } catch {
      errors.push("旧档案无法解析，原始数据已保留：" + key);
    }
  }
  return { documents, errors };
}

function restoreRecordIfMissing(storage, record) {
  if (!storage || !record?.type || !record?.key) return false;
  const key = legacyKey(record.type, record.key);
  if (!key) return false;
  if (record.payload?._deleted === true) {
    try { storage.removeItem(key); return true; } catch { return false; }
  }
  try {
    if (storage.getItem(key) !== null) return false;
    storage.setItem(key, JSON.stringify(record.payload));
    return true;
  } catch {
    return false;
  }
}

export async function restoreMissingArchiveDocuments() {
  const storage = getStorage();
  if (!storage) return { restored: 0 };
  const records = await listArchiveDocuments(1000);
  let restored = 0;
  for (const record of records) {
    if (restoreRecordIfMissing(storage, record)) restored += 1;
  }
  return { restored };
}

export async function captureLocalLearningArchive(progressStore) {
  const storage = getStorage();
  if (!storage) throw new Error("LocalStorage 不可用，无法读取现有学习档案。");
  const device = await getLocalDevice();
  const snapshot = progressStore?.load?.() || { events: [] };
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  const currentV2 = storage.getItem("knowverse:learning-progress:v2");
  const legacyV1 = storage.getItem("knowverse:learning-progress:v1");
  const migrationErrors = [];
  if (currentV2) {
    let currentV2Valid = false;
    try {
      const parsed = JSON.parse(currentV2);
      currentV2Valid = Boolean(parsed && [1, 2].includes(parsed.schemaVersion) && Array.isArray(parsed.events));
    } catch { /* Preserve the damaged source and attempt the V1 compatibility copy. */ }
    if (!currentV2Valid) migrationErrors.push("V2 学习快照无法校验；原始键已保留，并尝试从 V1 兼容恢复。");
  }
  if (!currentV2 && legacyV1) {
    // Preserve V1 in place; write its normalized V2 representation only after
    // the compatibility store has successfully parsed and validated it.
    try {
      storage.setItem("knowverse:learning-progress:v2", JSON.stringify(snapshot));
    } catch {
      throw new Error("旧版学习事件已读取，但无法写入 V2 兼容快照；原始 V1 数据仍保留。");
    }
  }
  await persistLearningEvents(events, { origin: "local", queue: false });
  const parsed = parseLocalDocuments(storage);
  for (const document of parsed.documents) {
    await writeArchiveDocument(document);
  }
  return {
    deviceId: device.id,
    eventsMirrored: events.length,
    documentsCaptured: parsed.documents.length,
    errors: [...migrationErrors, ...parsed.errors],
    checksum: hashText(JSON.stringify({ events, documents: parsed.documents })),
  };
}

export async function migrateLegacyLocalStorage(progressStore) {
  const previous = await getMigrationRecord(MIGRATION_KEY);
  try {
    const restore = await restoreMissingArchiveDocuments();
    const captured = await captureLocalLearningArchive(progressStore);
    const marker = {
      status: captured.errors.length ? "needs-attention" : "completed",
      schemaVersion: 1,
      strategy: "copy-and-verify; legacy keys are never removed",
      checksum: captured.checksum,
      eventCount: captured.eventsMirrored,
      documentCount: captured.documentsCaptured,
      restoredCount: restore.restored,
      errors: captured.errors,
      startedAt: previous?.startedAt || new Date().toISOString(),
      completedAt: captured.errors.length ? null : new Date().toISOString(),
    };
    await setMigrationRecord({ id: MIGRATION_KEY, ...marker });
    return marker;
  } catch (error) {
    const marker = {
      status: "failed",
      schemaVersion: 1,
      strategy: "copy-and-verify; legacy keys are never removed",
      errors: [error.message || "迁移失败"],
      startedAt: previous?.startedAt || new Date().toISOString(),
      completedAt: null,
    };
    await setMigrationRecord({ id: MIGRATION_KEY, ...marker });
    throw error;
  }
}

export async function applyRemoteLearningArchiveDocument(remote) {
  const result = await applyRemoteArchiveDocument(remote);
  if (result.status === "applied" && result.record) {
    const storage = getStorage();
    const key = legacyKey(result.record.type, result.record.key);
    if (storage && key) {
      try {
        if (result.record.payload?._deleted === true) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify(result.record.payload));
      } catch (error) {
        throw new Error("云端档案已写入 IndexedDB，但兼容引擎恢复失败：" + error.message);
      }
    }
  }
  return result;
}

export async function resolveLocalLearningArchiveConflict(conflictId, choice) {
  const record = await resolveArchiveConflict(conflictId, choice);
  if (record) {
    const storage = getStorage();
    const key = legacyKey(record.type, record.key);
    if (storage && key) {
      try {
        if (record.payload?._deleted === true) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify(record.payload));
      } catch (error) {
        throw new Error("冲突选择已保存，但同步到兼容存储失败：" + error.message);
      }
    }
  }
  return record;
}

export function startLocalLearningArchive(progressStore) {
  if (typeof window === "undefined") return Promise.resolve(() => {});
  return migrateLegacyLocalStorage(progressStore).then(() => {
    let scheduled = false;
    let stopped = false;
    const scheduleCapture = () => {
      if (scheduled || stopped) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        if (stopped) return;
        captureLocalLearningArchive(progressStore).catch(error => {
          window.dispatchEvent(new CustomEvent("knowverse:archive-state", {
            detail: { status: "error", message: error.message || "本地学习档案保存失败" },
          }));
        });
      }, 0);
    };
    const onDelete = event => {
      const type = event.detail?.type;
      const key = event.detail?.key;
      deleteArchiveDocument(type, key).then(() => {
        scheduleCapture();
        // Wake the shared sync runtime after the tombstone is durable.
        window.dispatchEvent(new CustomEvent("knowverse:learning-archive-capture", {
          detail: { type, key, deleted: true },
        }));
      }).catch(error => {
        window.dispatchEvent(new CustomEvent("knowverse:archive-state", {
          detail: { status: "error", message: error.message || "学习档案删除记录失败" },
        }));
      });
    };
    window.addEventListener("knowverse:learning-events-appended", scheduleCapture);
    window.addEventListener("knowverse:learning-archive-capture", scheduleCapture);
    window.addEventListener("knowverse:learning-archive-delete", onDelete);
    window.addEventListener("storage", scheduleCapture);
    window.addEventListener("online", scheduleCapture);
    window.addEventListener("pagehide", scheduleCapture);
    document.addEventListener("visibilitychange", scheduleCapture);
    window.dispatchEvent(new CustomEvent("knowverse:archive-state", { detail: { status: "ready" } }));
    const stop = () => {
      stopped = true;
      window.removeEventListener("knowverse:learning-events-appended", scheduleCapture);
      window.removeEventListener("knowverse:learning-archive-capture", scheduleCapture);
      window.removeEventListener("knowverse:learning-archive-delete", onDelete);
      window.removeEventListener("storage", scheduleCapture);
      window.removeEventListener("online", scheduleCapture);
      window.removeEventListener("pagehide", scheduleCapture);
      document.removeEventListener("visibilitychange", scheduleCapture);
    };
    return stop;
  });
}

export const LEARNING_ARCHIVE_SCHEMA_VERSION = 1;
export const LEARNING_ARCHIVE_MIGRATION_ID = MIGRATION_KEY;
