import {
  deleteArchiveDocument,
  getLocalDevice,
  listArchiveDocuments,
  resolveArchiveConflict,
  writeArchiveDocument,
  applyRemoteArchiveDocument,
} from "./local-event-store.mjs";

const CHALLENGE_PREFIX = "knowverse:challenge/";
const REVIEW_PREFIX = "knowverse:review-session/";
const PREFERENCES_KEY = "knowverse:learning-plan:preferences";

function getStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function storageKey(type, key) {
  if (type === "challenge_progress") return CHALLENGE_PREFIX + encodeURIComponent(key);
  if (type === "review_session") return REVIEW_PREFIX + encodeURIComponent(key);
  if (type === "plan_preferences") return PREFERENCES_KEY;
  return null;
}

function parseCurrentDocuments(storage) {
  const documents = [];
  if (!storage) throw new Error("浏览器本地存储不可用。");
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    let type = null;
    let documentKey = null;
    if (key.startsWith(CHALLENGE_PREFIX)) {
      type = "challenge_progress";
      documentKey = decodeURIComponent(key.slice(CHALLENGE_PREFIX.length));
    } else if (key.startsWith(REVIEW_PREFIX)) {
      type = "review_session";
      documentKey = decodeURIComponent(key.slice(REVIEW_PREFIX.length));
    } else if (key === PREFERENCES_KEY) {
      type = "plan_preferences";
      documentKey = "preferences";
    }
    if (!type || !documentKey) continue;
    const payload = JSON.parse(storage.getItem(key) || "null");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("学习档案必须是 JSON 对象：" + key);
    }
    documents.push({ type, key: documentKey, payload });
  }
  return documents;
}

function writeCurrentDocument(storage, record) {
  if (!storage || !record?.type || !record?.key) return false;
  const key = storageKey(record.type, record.key);
  if (!key) return false;
  if (record.payload?._deleted === true) {
    storage.removeItem(key);
    return true;
  }
  storage.setItem(key, JSON.stringify(record.payload));
  return true;
}

export async function hydrateLearningArchiveDocuments() {
  const storage = getStorage();
  if (!storage) return { restored: 0 };
  const records = await listArchiveDocuments(1000);
  let restored = 0;
  for (const record of records) {
    const key = storageKey(record.type, record.key);
    if (!key) continue;
    if (record.payload?._deleted === true) {
      storage.removeItem(key);
      continue;
    }
    if (storage.getItem(key) === null) {
      storage.setItem(key, JSON.stringify(record.payload));
      restored += 1;
    }
  }
  return { restored };
}

export async function captureLocalLearningArchive(progressStore) {
  const storage = getStorage();
  if (!storage) throw new Error("浏览器本地存储不可用，无法保存学习档案。");
  const device = await getLocalDevice();
  const snapshot = progressStore?.load?.() || { events: [] };
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  const documents = parseCurrentDocuments(storage);
  for (const document of documents) await writeArchiveDocument(document);
  return { deviceId: device.id, eventCount: events.length, documentCount: documents.length };
}

export async function applyRemoteLearningArchiveDocument(remote) {
  const result = await applyRemoteArchiveDocument(remote);
  if (result.status === "applied" && result.record) {
    try { writeCurrentDocument(getStorage(), result.record); }
    catch (error) { throw new Error("云端档案已保存，但更新本机学习现场失败：" + error.message); }
  }
  return result;
}

export async function resolveLocalLearningArchiveConflict(conflictId, choice) {
  const record = await resolveArchiveConflict(conflictId, choice);
  if (record) {
    try { writeCurrentDocument(getStorage(), record); }
    catch (error) { throw new Error("冲突选择已保存，但更新本机学习现场失败：" + error.message); }
  }
  return record;
}

export function startLocalLearningArchive(progressStore) {
  if (typeof window === "undefined") return Promise.resolve(() => {});
  return hydrateLearningArchiveDocuments().then(() => captureLocalLearningArchive(progressStore)).then(() => {
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
    return () => {
      stopped = true;
      window.removeEventListener("knowverse:learning-events-appended", scheduleCapture);
      window.removeEventListener("knowverse:learning-archive-capture", scheduleCapture);
      window.removeEventListener("knowverse:learning-archive-delete", onDelete);
      window.removeEventListener("storage", scheduleCapture);
      window.removeEventListener("online", scheduleCapture);
      window.removeEventListener("pagehide", scheduleCapture);
      document.removeEventListener("visibilitychange", scheduleCapture);
    };
  });
}
