/**
 * One synchronous, transactional persistence boundary for the learning domain.
 *
 * Existing learning engines deliberately keep their synchronous Storage API.
 * Their current keys are now records in one versioned envelope, so a multi-key
 * operation (for example an attempt event + challenge checkpoint) is committed
 * with one localStorage.setItem call. Supabase Auth keys are never included.
 */

export const LEARNING_STATE_STORAGE_KEY = "knowverse:learning-state";
export const LEARNING_STATE_SCHEMA_VERSION = 1;

const FORMAT = "knowverse-learning-state";
const EVENT_LOG_KEY = "knowverse:learning-progress";
const PREFERENCES_KEY = "knowverse:learning-plan:preferences";
const CHALLENGE_PREFIX = "knowverse:challenge/";
const REVIEW_PREFIX = "knowverse:review-session/";
const ADAPTER = Symbol.for("knowverse.learning-state-storage");
const adapters = new WeakMap();

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function isLearningKey(key) {
  return key === EVENT_LOG_KEY || key === PREFERENCES_KEY ||
    key.startsWith(CHALLENGE_PREFIX) || key.startsWith(REVIEW_PREFIX);
}

function enumerateKeys(storage) {
  const keys = new Set([EVENT_LOG_KEY, PREFERENCES_KEY]);
  if (Number.isSafeInteger(storage.length) && typeof storage.key === "function") {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && isLearningKey(key)) keys.add(key);
    }
  } else if (storage.values instanceof Map) {
    for (const key of storage.values.keys()) {
      if (typeof key === "string" && isLearningKey(key)) keys.add(key);
    }
  }
  return [...keys];
}

function parseEnvelope(raw) {
  let envelope;
  try { envelope = JSON.parse(raw); }
  catch { throw new Error("统一学习档案损坏，已停止写入以保护原始数据。请先导出或备份浏览器站点数据。"); }
  if (!envelope || envelope.format !== FORMAT ||
      envelope.schemaVersion !== LEARNING_STATE_SCHEMA_VERSION ||
      !Number.isSafeInteger(envelope.revision) || envelope.revision < 0 ||
      !envelope.records || typeof envelope.records !== "object" || Array.isArray(envelope.records)) {
    throw new Error("统一学习档案结构或版本无效，已停止写入以保护原始数据。");
  }
  for (const [key, value] of Object.entries(envelope.records)) {
    if (!isLearningKey(key) || typeof value !== "string") {
      throw new Error("统一学习档案包含未知或无效记录，已停止写入以保护原始数据。");
    }
  }
  return envelope;
}

function cloneRecords(records) {
  return Object.assign(Object.create(null), records);
}

export function createLearningStateStorage(candidate) {
  const storage = typeof candidate === "undefined" ? defaultStorage() : candidate;
  if (!storage || typeof storage.getItem !== "function" ||
      typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") return null;
  if (storage[ADAPTER] === true) return storage;
  const cached = adapters.get(storage);
  if (cached) return cached;

  let activeTransaction = null;
  let cachedRaw = null;
  let cachedEnvelope = null;

  function cacheEnvelope(raw, envelope) {
    cachedRaw = raw;
    cachedEnvelope = envelope;
    return envelope;
  }

  function readEnvelope() {
    const raw = storage.getItem(LEARNING_STATE_STORAGE_KEY);
    if (raw !== null) {
      if (raw === cachedRaw && cachedEnvelope) return cachedEnvelope;
      return cacheEnvelope(raw, parseEnvelope(raw));
    }
    cachedRaw = null;
    cachedEnvelope = null;

    // One-time consolidation of the currently supported keys only. No V1/V2
    // event-schema fallback or auth-key migration is performed here.
    const records = Object.create(null);
    for (const key of enumerateKeys(storage)) {
      const value = storage.getItem(key);
      if (value !== null) records[key] = value;
    }
    const envelope = {
      format: FORMAT,
      schemaVersion: LEARNING_STATE_SCHEMA_VERSION,
      revision: 0,
      records,
    };
    const serialized = JSON.stringify(envelope);
    storage.setItem(LEARNING_STATE_STORAGE_KEY, serialized);
    cacheEnvelope(serialized, envelope);
    for (const key of Object.keys(records)) storage.removeItem(key);
    return envelope;
  }

  function commit(records, revision) {
    const envelope = {
      format: FORMAT,
      schemaVersion: LEARNING_STATE_SCHEMA_VERSION,
      revision: revision + 1,
      records,
    };
    // localStorage.setItem is the sole commit point. A quota/security error
    // leaves the previous envelope intact and is allowed to reach the caller.
    const serialized = JSON.stringify(envelope);
    storage.setItem(LEARNING_STATE_STORAGE_KEY, serialized);
    cacheEnvelope(serialized, envelope);
    return envelope.revision;
  }

  function currentRecords() {
    return activeTransaction ? activeTransaction.records : readEnvelope().records;
  }

  function assertTransactionActive(transaction) {
    if (!transaction.active || activeTransaction !== transaction) {
      throw new Error("学习状态事务已经结束，不能再使用事务视图。");
    }
  }

  function createTransactionView(transaction) {
    const scoped = {
      get length() {
        assertTransactionActive(transaction);
        return Object.keys(transaction.records).length;
      },
      key(index) {
        assertTransactionActive(transaction);
        const keys = Object.keys(transaction.records);
        return Number.isInteger(index) && index >= 0 ? keys[index] ?? null : null;
      },
      getItem(key) {
        assertTransactionActive(transaction);
        const value = transaction.records[String(key)];
        return value === undefined ? null : value;
      },
      setItem(key, value) {
        assertTransactionActive(transaction);
        view.setItem(key, value);
      },
      removeItem(key) {
        assertTransactionActive(transaction);
        view.removeItem(key);
      },
      clear() {
        assertTransactionActive(transaction);
        view.clear();
      },
      transaction(callback) {
        assertTransactionActive(transaction);
        if (typeof callback !== "function") throw new TypeError("transaction 需要同步回调函数。");
        return callback(scoped);
      },
      afterCommit(callback) {
        assertTransactionActive(transaction);
        return view.afterCommit(callback);
      },
    };
    return scoped;
  }

  const view = {
    get length() { return Object.keys(currentRecords()).length; },
    key(index) {
      const keys = Object.keys(currentRecords());
      return Number.isInteger(index) && index >= 0 ? keys[index] ?? null : null;
    },
    getItem(key) {
      const value = currentRecords()[String(key)];
      return value === undefined ? null : value;
    },
    setItem(key, value) {
      const normalizedKey = String(key);
      if (!isLearningKey(normalizedKey)) throw new TypeError("只能通过统一存储写入 KNOWVERSE 学习状态。");
      const normalizedValue = String(value);
      const records = currentRecords();
      if (records[normalizedKey] === normalizedValue) return;
      if (activeTransaction) {
        activeTransaction.records[normalizedKey] = normalizedValue;
        activeTransaction.dirty = true;
        return;
      }
      const envelope = readEnvelope();
      const next = cloneRecords(envelope.records);
      next[normalizedKey] = normalizedValue;
      commit(next, envelope.revision);
    },
    removeItem(key) {
      const normalizedKey = String(key);
      if (!isLearningKey(normalizedKey)) return;
      const records = currentRecords();
      if (!Object.hasOwn(records, normalizedKey)) return;
      if (activeTransaction) {
        delete activeTransaction.records[normalizedKey];
        activeTransaction.dirty = true;
        return;
      }
      const envelope = readEnvelope();
      const next = cloneRecords(envelope.records);
      delete next[normalizedKey];
      commit(next, envelope.revision);
    },
    clear() {
      const records = currentRecords();
      if (!Object.keys(records).length) return;
      if (activeTransaction) {
        for (const key of Object.keys(activeTransaction.records)) delete activeTransaction.records[key];
        activeTransaction.dirty = true;
        return;
      }
      const envelope = readEnvelope();
      commit(Object.create(null), envelope.revision);
    },
    transaction(callback) {
      if (typeof callback !== "function") throw new TypeError("transaction 需要同步回调函数。");
      if (activeTransaction) return callback(createTransactionView(activeTransaction));
      const envelope = readEnvelope();
      const transaction = {
        records: cloneRecords(envelope.records),
        revision: envelope.revision,
        dirty: false,
        active: true,
        afterCommit: [],
      };
      activeTransaction = transaction;
      const scoped = createTransactionView(transaction);
      let result;
      let callbacks = [];
      try {
        result = callback(scoped);
        if (result && typeof result.then === "function") {
          throw new TypeError("学习状态事务必须同步完成，不能在事务中 await。");
        }
        if (transaction.dirty) commit(transaction.records, transaction.revision);
        callbacks = transaction.afterCommit.slice();
      } finally {
        transaction.active = false;
        activeTransaction = null;
      }
      // External effects (Outbox enqueue, archive capture/deletion and UI events)
      // must only observe records that have crossed the root-envelope commit.
      for (const notify of callbacks) {
        try { notify(); }
        catch (error) {
          if (typeof console !== "undefined" && typeof console.error === "function") {
            console.error("[KNOWVERSE] learning-state post-commit notification failed:", error);
          }
        }
      }
      return result;
    },
    afterCommit(callback) {
      if (typeof callback !== "function") throw new TypeError("afterCommit 需要回调函数。");
      if (activeTransaction) {
        activeTransaction.afterCommit.push(callback);
        return true;
      }
      callback();
      return false;
    },
    [ADAPTER]: true,
  };

  // Establish the envelope before exposing the adapter. Migration removes the
  // individual keys only after the envelope has been written successfully.
  readEnvelope();
  adapters.set(storage, view);
  return view;
}
