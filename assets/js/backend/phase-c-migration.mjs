import {
  getLearningEvents,
  getLearningDocument,
  getMigrationMetadata,
  importPhaseCLearningState,
} from "./local-event-store.mjs";

export const PHASE_C_MIGRATION_KEY = "phase-c-localstorage-to-indexeddb-v1";
export const PHASE_C_STORAGE_KEY = "knowverse:learning-state";
const EVENT_KEY = "knowverse:learning-progress";
const PREF_KEY = "knowverse:learning-plan:preferences";
const CHALLENGE_PREFIX = "knowverse:challenge/";
const REVIEW_PREFIX = "knowverse:review-session/";
const PROMISE_REALM_KEY = "promise-realm-save-v1";
const allowedKeys = key => key === EVENT_KEY || key === PREF_KEY ||
  key.startsWith(CHALLENGE_PREFIX) || key.startsWith(REVIEW_PREFIX);

function sourceKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (typeof key === "string" &&
        (key === PHASE_C_STORAGE_KEY || key === PROMISE_REALM_KEY || allowedKeys(key))) keys.push(key);
  }
  return keys;
}
function parseSource(raw) {
  let envelope;
  try { envelope = JSON.parse(raw); }
  catch (error) { throw new Error("Phase C 学习状态无法解析；原始 LocalStorage 数据已保留。", { cause: error }); }
  if (!envelope || envelope.format !== "knowverse-learning-state" ||
      envelope.schemaVersion !== 1 || !Number.isSafeInteger(envelope.revision) ||
      envelope.revision < 0 || !envelope.records || typeof envelope.records !== "object" ||
      Array.isArray(envelope.records)) {
    throw new Error("Phase C 学习状态格式或版本不受支持；原始数据已保留。");
  }
  for (const [key, value] of Object.entries(envelope.records)) {
    if (!allowedKeys(key) || typeof value !== "string") {
      throw new Error("Phase C 学习状态包含未知键或无效值：" + key + "；原始数据已保留。");
    }
  }
  return envelope;
}

function mergeStandaloneGameSave(storage) {
  const raw = storage.getItem(PROMISE_REALM_KEY);
  if (raw === null) return null;
  const state = parseJsonRecord(raw, PROMISE_REALM_KEY);
  if (!Array.isArray(state.done) || state.done.length !== 3 ||
      !state.done.every(value => typeof value === "boolean") ||
      !Array.isArray(state.solutions) || state.solutions.length !== 3 ||
      !state.solutions.every(list => Array.isArray(list) &&
        list.every(value => typeof value === "string" && value.length <= 120)) ||
      !Number.isSafeInteger(state.stage) || state.stage < 0 || state.stage > 2) {
    throw new Error("Promise Realm 旧游戏进度结构无效；原始数据已保留。");
  }
  const rawEnvelope = storage.getItem(PHASE_C_STORAGE_KEY);
  const envelope = rawEnvelope === null ? {
    format: "knowverse-learning-state",
    schemaVersion: 1,
    revision: 0,
    records: {},
  } : parseSource(rawEnvelope);
  const legacyDocumentKey = CHALLENGE_PREFIX + encodeURIComponent("promise-realm");
  const payload = JSON.stringify({
    schemaVersion: 1,
    challengeId: "promise-realm",
    done: state.done,
    solutions: state.solutions,
    stage: state.stage,
  });
  const existing = envelope.records[legacyDocumentKey];
  if (existing && JSON.stringify(parseJsonRecord(existing, legacyDocumentKey)) !== JSON.stringify(JSON.parse(payload))) {
    throw new Error("Promise Realm 独立进度与 Phase C 挑战文档内容不一致；为防止覆盖，迁移已停止。");
  }
  if (!existing) {
    envelope.records[legacyDocumentKey] = payload;
    envelope.revision += 1;
  }
  const mergedRaw = JSON.stringify(envelope);
  // Keep the original standalone value until IndexedDB import and read-back
  // checks pass. If a subsequent stage fails, both copies remain recoverable.
  storage.setItem(PHASE_C_STORAGE_KEY, mergedRaw);
  return mergedRaw;
}

async function sha256(value) {
  if (!globalThis.crypto?.subtle) throw new Error("当前安全上下文不支持 SHA-256，无法验证迁移源数据。");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function parseJsonRecord(raw, label) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("not an object");
    return value;
  } catch (error) {
    throw new Error("Phase C 数据记录损坏：" + label + "；迁移已停止，原始数据未清理。", { cause: error });
  }
}
function extractRecords(envelope) {
  const records = envelope.records;
  const eventSnapshot = records[EVENT_KEY] ? parseJsonRecord(records[EVENT_KEY], EVENT_KEY) : null;
  if (eventSnapshot && (eventSnapshot.schemaVersion !== 1 || !Array.isArray(eventSnapshot.events))) {
    throw new Error("Phase C 学习事件快照结构或版本无效；原始数据已保留。");
  }
  const events = eventSnapshot ? eventSnapshot.events : [];
  const remoteEventIds = eventSnapshot && Array.isArray(eventSnapshot.remoteEventIds)
    ? eventSnapshot.remoteEventIds.filter(id => typeof id === "string")
    : [];
  const documents = [];
  for (const [key, raw] of Object.entries(records)) {
    if (key === EVENT_KEY) continue;
    if (key === PREF_KEY) {
      documents.push({ type: "plan_preferences", key: "preferences", payload: parseJsonRecord(raw, key) });
      continue;
    }
    if (key.startsWith(CHALLENGE_PREFIX)) {
      let documentKey;
      try { documentKey = decodeURIComponent(key.slice(CHALLENGE_PREFIX.length)); }
      catch (error) { throw new Error("挑战文档键编码损坏：" + key, { cause: error }); }
      if (!documentKey) throw new Error("挑战文档键为空：" + key);
      documents.push({ type: "challenge_progress", key: documentKey, payload: parseJsonRecord(raw, key) });
      continue;
    }
    if (key.startsWith(REVIEW_PREFIX)) {
      const documentKey = key.slice(REVIEW_PREFIX.length);
      if (!documentKey) throw new Error("复习会话键为空：" + key);
      documents.push({ type: "review_session", key: documentKey, payload: parseJsonRecord(raw, key) });
    }
  }
  if (events.some(event => !event || typeof event.id !== "string" || !event.id)) {
    throw new Error("Phase C 事件日志包含缺少稳定 ID 的事件；原始数据已保留。");
  }
  return { events, remoteEventIds, documents };
}

/**
 * Idempotent Phase C -> D migration. IndexedDB receives one atomic batch;
 * LocalStorage is cleaned only after the imported records have been read back.
 */
export async function migratePhaseCLearningState() {
  let storage;
  try { storage = globalThis.localStorage; }
  catch (error) { throw new Error("无法读取 Phase C LocalStorage；迁移未运行。", { cause: error }); }
  if (!storage || typeof storage.getItem !== "function" || typeof storage.removeItem !== "function") {
    return { status: "no-legacy-storage", events: 0, documents: 0 };
  }

  let rootRaw = storage.getItem(PHASE_C_STORAGE_KEY);
  const candidateKeys = sourceKeys(storage);
  if (candidateKeys.includes(PROMISE_REALM_KEY)) {
    rootRaw = mergeStandaloneGameSave(storage);
  }
  const existingMarker = await getMigrationMetadata(PHASE_C_MIGRATION_KEY);
  if (rootRaw === null && !candidateKeys.length) {
    return { status: existingMarker?.status === "completed" ? "already-migrated" : "not-required", events: 0, documents: 0 };
  }
  if (rootRaw === null) {
    throw new Error("检测到散落的 Phase C 学习键，但缺少统一 envelope；为避免猜测数据关系，已停止清理。");
  }

  const envelope = parseSource(rootRaw);
  const sourceFingerprint = await sha256(rootRaw);
  if (existingMarker?.status === "completed") {
    if (existingMarker.sourceFingerprint !== sourceFingerprint) {
      throw new Error("Phase C 源数据在迁移完成后发生变化；原始数据保留，请先核查，不会重复导入。");
    }
    const expected = extractRecords(envelope);
    const eventIds = new Set((await getLearningEvents()).map(event => event.id));
    const missingEvent = expected.events.find(event => !eventIds.has(event.id));
    if (missingEvent) throw new Error("已完成迁移标记与本地事件日志不一致：" + missingEvent.id);
    for (const item of expected.documents) {
      if (!await getLearningDocument(item.type, item.key)) {
        throw new Error("已完成迁移标记与本地学习文档不一致：" + item.type + "/" + item.key);
      }
    }
    cleanupSource(storage, envelope, candidateKeys);
    return { status: "already-migrated", events: expected.events.length, documents: expected.documents.length };
  }

  const source = extractRecords(envelope);
  await importPhaseCLearningState({
    ...source,
    markerKey: PHASE_C_MIGRATION_KEY,
    sourceFingerprint,
    sourceRevision: envelope.revision,
  });

  const actualEvents = new Set((await getLearningEvents()).map(event => event.id));
  const missingEvent = source.events.find(event => !actualEvents.has(event.id));
  if (missingEvent) throw new Error("Phase C 迁移后事件核验失败：" + missingEvent.id + "；原始数据仍保留。");
  const verifiedDocuments = await Promise.all(source.documents.map(item => getLearningDocument(item.type, item.key)));
  if (verifiedDocuments.some((item, index) => !item || item.hash !== undefined && JSON.stringify(item.payload) !== JSON.stringify(source.documents[index].payload))) {
    throw new Error("Phase C 迁移后学习文档核验失败；原始数据仍保留。");
  }
  const marker = await getMigrationMetadata(PHASE_C_MIGRATION_KEY);
  if (marker?.status !== "completed" || marker.sourceFingerprint !== sourceFingerprint ||
      marker.eventCount !== source.events.length || marker.documentCount !== source.documents.length) {
    throw new Error("Phase C 迁移标记核验失败；原始数据仍保留。");
  }
  cleanupSource(storage, envelope, candidateKeys);
  return { status: "migrated", events: source.events.length, documents: source.documents.length, revision: envelope.revision };
}

function cleanupSource(storage, envelope, candidateKeys = []) {
  // This only removes explicitly allowlisted learning keys. Supabase Auth,
  // PKCE, callback state and unrelated application settings are untouched.
  for (const key of Object.keys(envelope.records)) storage.removeItem(key);
  for (const key of candidateKeys) {
    if (key === PHASE_C_STORAGE_KEY || allowedKeys(key) || key === PROMISE_REALM_KEY) {
      storage.removeItem(key);
    }
  }
  storage.removeItem(PHASE_C_STORAGE_KEY);
}
