import {
  acknowledgeArchiveDocuments,
  acknowledgeOutbox,
  acquireSyncLease,
  applyRemoteArchiveDocument,
  bindLocalAccount,
  commitLearningBatch,
  countLearningEvents,
  countOutbox,
  deleteArchiveDocument,
  getArchiveMeta,
  getArchiveStatus,
  getDocumentSyncCursor,
  getLearningDocument,
  getLearningEvents,
  getLocalAccountBinding,
  getLocalDatabaseDiagnostics,
  getLocalDevice,
  getSyncCursor,
  isIndexedDbAvailable,
  listArchiveConflicts,
  listArchiveDocuments,
  listOutbox,
  listPendingArchiveDocuments,
  mergeRemoteLearningEvents,
  releaseSyncLease,
  resolveArchiveConflict,
  setArchiveMeta,
  setDocumentSyncCursor,
  setSyncCursor,
} from "./local-event-store.mjs";
import { migratePhaseCLearningState } from "./phase-c-migration.mjs";
import { createSupabaseAuthClient } from "./auth.mjs";

function publishCommit(result) {
  if (typeof window === "undefined") return;
  if (result.addedEvents?.length) {
    window.dispatchEvent(new CustomEvent("knowverse:learning-events-appended", {
      detail: { events: result.addedEvents, remote: false },
    }));
  }
  for (const document of result.changedDocuments || []) {
    window.dispatchEvent(new CustomEvent("knowverse:learning-archive-capture", {
      detail: { type: document.type, key: document.key },
    }));
  }
}

export class LearningRepository {
  constructor(options = {}) {
    this.auth = options.auth || createSupabaseAuthClient();
  }

  get available() { return isIndexedDbAvailable(); }

  async assertAccountBoundary() {
    const session = this.auth.readStoredSession();
    let boundUserId = await getLocalAccountBinding();
    const activeUserId = session?.user?.id || null;
    if (activeUserId && boundUserId && activeUserId !== boundUserId) {
      throw new Error("此浏览器的本地学习档案属于另一个账户。为防止跨账户数据泄漏，已阻止读取或写入；请先使用原账户完成备份/恢复，或明确清理该设备的旧账户数据。");
    }
    const bindingTarget = activeUserId || boundUserId;
    if (bindingTarget) {
      // Promote a Phase C archive binding even while logged out, so its
      // existing offline event rows remain visible to the same local owner.
      await bindLocalAccount(bindingTarget);
      boundUserId = await getLocalAccountBinding();
    }
    return activeUserId || boundUserId || null;
  }

  async initialize() {
    const accountId = await this.assertAccountBoundary();
    const migration = await migratePhaseCLearningState();
    return { available: this.available, migration, accountId };
  }

  async commit(change = {}) {
    const activeAccountId = await this.assertAccountBoundary();
    if (change.accountId && activeAccountId && change.accountId !== activeAccountId) {
      throw new Error("当前登录账户与学习写入账户不匹配，已拒绝写入。");
    }
    const result = await commitLearningBatch({ ...change, accountId: change.accountId || activeAccountId });
    publishCommit(result);
    return result;
  }

  events = Object.freeze({
    list: async options => {
      const accountId = await this.assertAccountBoundary();
      if (options?.accountId && accountId && options.accountId !== accountId) {
        throw new Error("学习事件查询账户与本地数据库绑定账户不一致，已拒绝读取。");
      }
      return getLearningEvents({ ...options, accountId: options?.accountId || accountId });
    },
    count: async () => { await this.assertAccountBoundary(); return countLearningEvents(); },
    append: async (events, options = {}) => {
      const result = await this.commit({ events, accountId: options.accountId });
      return { inserted: result.addedEvents.length, events: result.addedEvents };
    },
    mergeRemote: async (rows, accountId) => {
      const active = await this.assertAccountBoundary();
      if (accountId && active && accountId !== active) throw new Error("禁止将其他账户的云端事件合并到本地学习数据库。");
      return mergeRemoteLearningEvents(rows, accountId || active);
    },
    pending: async limit => { await this.assertAccountBoundary(); return listOutbox(limit); },
    acknowledge: async rows => { await this.assertAccountBoundary(); return acknowledgeOutbox(rows); },
  });

  documents = Object.freeze({
    get: async (type, key) => { await this.assertAccountBoundary(); return getLearningDocument(type, key); },
    list: async limit => { await this.assertAccountBoundary(); return listArchiveDocuments(limit); },
    pending: async limit => { await this.assertAccountBoundary(); return listPendingArchiveDocuments(limit); },
    put: async (document, options = {}) => this.commit({ documents: [document], accountId: options.accountId }),
    remove: async (type, key, accountId) => {
      const active = await this.assertAccountBoundary();
      return deleteArchiveDocument(type, key, accountId || active);
    },
    applyRemote: async (document, accountId) => {
      const active = await this.assertAccountBoundary();
      if (accountId && active && accountId !== active) throw new Error("禁止应用其他账户的云端学习文档。");
      return applyRemoteArchiveDocument(document, accountId || active);
    },
    acknowledge: async rows => { await this.assertAccountBoundary(); return acknowledgeArchiveDocuments(rows); },
    conflicts: async () => { await this.assertAccountBoundary(); return listArchiveConflicts(); },
    resolveConflict: async (id, choice) => { await this.assertAccountBoundary(); return resolveArchiveConflict(id, choice); },
  });

  devices = Object.freeze({
    current: async () => { await this.assertAccountBoundary(); return getLocalDevice(); },
    bindAccount: async userId => {
      const active = await this.assertAccountBoundary();
      if (active && active !== userId) throw new Error("当前登录账户与本地账户绑定目标不一致。");
      return bindLocalAccount(userId);
    },
  });

  sync = Object.freeze({
    getEventCursor: async userId => {
      const accountId = await this.assertAccountBoundary();
      if (accountId && userId !== accountId) throw new Error("禁止读取其他账户的学习事件游标。");
      return getSyncCursor(userId);
    },
    setEventCursor: async (userId, cursor) => {
      const accountId = await this.assertAccountBoundary();
      if (accountId && userId !== accountId) throw new Error("禁止修改其他账户的学习事件游标。");
      return setSyncCursor(userId, cursor);
    },
    getDocumentCursor: async userId => {
      const accountId = await this.assertAccountBoundary();
      if (accountId && userId !== accountId) throw new Error("禁止读取其他账户的学习文档游标。");
      return getDocumentSyncCursor(userId);
    },
    setDocumentCursor: async (userId, cursor) => {
      const accountId = await this.assertAccountBoundary();
      if (accountId && userId !== accountId) throw new Error("禁止修改其他账户的学习文档游标。");
      return setDocumentSyncCursor(userId, cursor);
    },
    getMeta: async key => { await this.assertAccountBoundary(); return getArchiveMeta(key); },
    setMeta: async (key, value) => { await this.assertAccountBoundary(); return setArchiveMeta(key, value); },
    acquireLease: async (name, owner, leaseMs) => { await this.assertAccountBoundary(); return acquireSyncLease(name, owner, leaseMs); },
    releaseLease: async (name, owner) => { await this.assertAccountBoundary(); return releaseSyncLease(name, owner); },
    status: async () => { await this.assertAccountBoundary(); return getArchiveStatus(); },
    diagnostics: async () => { await this.assertAccountBoundary(); return getLocalDatabaseDiagnostics(); },
  });
}

let singletonPromise;
export function getLearningRepository() {
  if (!singletonPromise) {
    singletonPromise = (async () => {
      const repository = new LearningRepository();
      await repository.initialize();
      return repository;
    })().catch(error => {
      singletonPromise = null;
      throw error;
    });
  }
  return singletonPromise;
}

export function resetLearningRepositoryForTests() {
  singletonPromise = null;
}

export function isLearningRepositoryAvailable() {
  return isIndexedDbAvailable();
}
