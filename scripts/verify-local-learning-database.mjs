import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  acknowledgeOutbox,
  bindLocalAccount,
  commitLearningBatch,
  countLearningEvents,
  countOutbox,
  deleteLocalDatabaseForTests,
  getLearningDocument,
  getLearningEvents,
  getLocalAccountBinding,
  getLocalDatabaseDiagnostics,
  getSyncCursor,
  listOutbox,
  mergeRemoteLearningEvents,
  acquireSyncLease,
  releaseSyncLease,
  setSyncCursor,
  setArchiveMeta,
} from "../assets/js/backend/local-event-store.mjs";
import { LearningRepository, resetLearningRepositoryForTests } from "../assets/js/backend/learning-repository.mjs";
import { migratePhaseCLearningState, PHASE_C_STORAGE_KEY } from "../assets/js/backend/phase-c-migration.mjs";

beforeEach(async () => {
  resetLearningRepositoryForTests();
  await deleteLocalDatabaseForTests();
  try { delete globalThis.localStorage; } catch {}
});

const event = (id, extra = {}) => ({
  id,
  type: "attempt",
  at: "2026-11-02T10:00:00.000Z",
  topicId: "promise",
  challengeId: "promise-quest",
  stepId: "thenable",
  competencyIds: ["thenable-adoption"],
  correct: false,
  gapId: "thenable-get-vs-call",
  ...extra,
});
const document = (key, payload, extra = {}) => ({
  type: "challenge_progress",
  key,
  payload,
  ...extra,
});

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(String(key)) ?? null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
  };
}

test("IndexedDB v4 exposes the complete local learning database schema", async () => {
  const info = await getLocalDatabaseDiagnostics();
  assert.equal(info.database, "knowverse-learning-archive");
  assert.equal(info.version, 4);
  assert.deepEqual(info.stores, [
    "learningEvents", "learningDocuments", "outbox", "syncMetadata",
    "devices", "conflicts", "migrationMetadata",
  ]);
});

test("one transaction commits immutable event facts, resumable document and Outbox row", async () => {
  const result = await commitLearningBatch({
    accountId: "user-a",
    events: [event("event-1")],
    documents: [document("promise-quest", { challengeId: "promise-quest", currentStep: "thenable" })],
  });
  assert.equal(result.addedEvents.length, 1);
  assert.equal(result.changedDocuments.length, 1);
  assert.equal(await countLearningEvents(), 1);
  assert.equal(await countOutbox(), 1);
  assert.deepEqual(await getLearningEvents({ accountId: "user-a" }), [result.addedEvents[0]]);
  const stored = await getLearningDocument("challenge_progress", "promise-quest");
  assert.equal(stored.accountId, "user-a");
  assert.equal(stored.localRevision, 1);
  assert.equal(stored.dirty, true);
  assert.equal((await listOutbox())[0].id, "event-1");
});

test("stable event IDs are idempotent and reject content mutation", async () => {
  await commitLearningBatch({ events: [event("event-stable")] });
  const duplicate = await commitLearningBatch({ events: [event("event-stable")] });
  assert.equal(duplicate.addedEvents.length, 0);
  assert.equal(await countLearningEvents(), 1);
  assert.equal(await countOutbox(), 1);
  await assert.rejects(
    commitLearningBatch({ events: [event("event-stable", { correct: true })] }),
    /内容不可变/
  );
  assert.equal(await countLearningEvents(), 1);
  assert.equal(await countOutbox(), 1);
});

test("document CAS failure rolls back accompanying event and Outbox writes", async () => {
  await commitLearningBatch({
    documents: [document("challenge-1", { currentStep: "first" })],
  });
  await assert.rejects(commitLearningBatch({
    events: [event("must-rollback")],
    documents: [document("challenge-1", { currentStep: "stale-write" }, { expectedLocalRevision: 0 })],
  }), /本地学习文档版本冲突/);
  assert.equal(await countLearningEvents(), 0);
  assert.equal(await countOutbox(), 0);
  assert.equal((await getLearningDocument("challenge_progress", "challenge-1")).payload.currentStep, "first");
});

test("remote events merge into the journal without re-entering the Outbox", async () => {
  const row = { event_id: "remote-event", user_seq: 17, device_id: "device-b", device_seq: 4, event_payload: event("remote-event") };
  assert.equal(await mergeRemoteLearningEvents([row], "user-a"), 1);
  assert.equal(await countLearningEvents(), 1);
  assert.equal(await countOutbox(), 0);
  await setSyncCursor("user-a", 17);
  assert.equal(await getSyncCursor("user-a"), 17);
  const merged = await getLearningEvents({ accountId: "user-a" });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "remote-event");
  assert.equal(merged[0].eventSchemaVersion, 3);
  assert.equal(merged[0].gapObservationId, "remote-event");
});

test("local account binding is atomic and every later local write inherits the account", async () => {
  assert.deepEqual(await bindLocalAccount("user-a"), { bound: true, changed: true });
  await commitLearningBatch({ events: [event("bound-event")] });
  assert.equal((await listOutbox())[0].accountId, "user-a");
  await assert.rejects(bindLocalAccount("user-b"), /拒绝跨账户混用/);
  await assert.rejects(commitLearningBatch({ accountId: "user-b", events: [event("wrong-account")] }), /账户不一致/);
  assert.equal(await countLearningEvents(), 1);
  assert.equal(await countOutbox(), 1);
});


test("logged-out repository initialization promotes Phase C account binding for offline history", async () => {
  await mergeRemoteLearningEvents([
    { event_id: "offline-legacy", event_payload: event("offline-legacy") },
  ], null);
  await setArchiveMeta("bound-user-id", "user-a");
  const repository = new LearningRepository({
    auth: { readStoredSession: () => null },
  });
  const initialized = await repository.initialize();
  assert.equal(initialized.accountId, "user-a");
  assert.equal((await repository.events.list()).length, 1);
  assert.equal((await getLocalAccountBinding()), "user-a");
});

test("repository blocks every read after an in-place account switch", async () => {
  let activeUserId = "user-a";
  const auth = { readStoredSession: () => ({ user: { id: activeUserId } }) };
  const repository = new LearningRepository({ auth });
  await repository.initialize();
  await repository.commit({
    events: [event("account-a-event")],
    documents: [document("private-progress", { currentStep: "account-a-only" })],
  });
  assert.equal((await repository.events.list()).length, 1);
  assert.equal((await repository.documents.get("challenge_progress", "private-progress")).payload.currentStep, "account-a-only");

  activeUserId = "user-b";
  await assert.rejects(repository.events.list(), /另一个账户/);
  await assert.rejects(repository.events.count(), /另一个账户/);
  await assert.rejects(repository.events.list({ accountId: "user-a" }), /另一个账户/);
  await assert.rejects(repository.sync.getEventCursor("user-a"), /另一个账户/);
  await assert.rejects(repository.documents.get("challenge_progress", "private-progress"), /另一个账户/);
  await assert.rejects(repository.documents.list(), /另一个账户/);
  await assert.rejects(repository.commit({ events: [event("account-b-event")] }), /另一个账户/);
});

test("sync lease excludes a competing tab and is released by its owner", async () => {
  assert.equal(await acquireSyncLease("learning-sync", "tab-a", 30000), true);
  assert.equal(await acquireSyncLease("learning-sync", "tab-b", 30000), false);
  await releaseSyncLease("learning-sync", "tab-a");
  assert.equal(await acquireSyncLease("learning-sync", "tab-b", 30000), true);
});

test("v1 Outbox, device metadata and resumable documents survive the v1-to-v4 upgrade", async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open("knowverse-learning-archive", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("outbox", { keyPath: "id" });
      db.createObjectStore("meta", { keyPath: "key" });
      db.createObjectStore("documents", { keyPath: "id" });
      db.createObjectStore("conflicts", { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["outbox", "meta", "documents"], "readwrite");
      tx.objectStore("outbox").put({
        id: "legacy-event", event: event("legacy-event"),
        deviceId: "legacy-device", deviceSeq: 6, queuedAt: "2026-11-01T10:00:00Z",
      });
      tx.objectStore("meta").put({
        key: "device",
        value: { id: "legacy-device", nextSeq: 7, createdAt: "2026-10-01T00:00:00Z" },
      });
      tx.objectStore("meta").put({ key: "archive:bound-user-id", value: "user-a" });
      tx.objectStore("documents").put({
        id: "challenge_progress:legacy-quest",
        type: "challenge_progress",
        key: "legacy-quest",
        payload: { challengeId: "legacy-quest", currentStep: "second" },
        hash: "{\"currentStep\":\"second\"}",
        localRevision: 2,
        cloudRevision: 1,
        baseRevision: 1,
        deviceId: "legacy-device",
        updatedAt: "2026-11-01T10:00:00Z",
        dirty: true,
        conflict: false,
      });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  });

  const info = await getLocalDatabaseDiagnostics();
  assert.equal(info.version, 4);
  assert.equal(info.outboxCount, 1);
  assert.equal(info.eventCount, 1);
  assert.equal(info.documentCount, 1);
  assert.equal((await listOutbox())[0].id, "legacy-event");
  assert.deepEqual(await bindLocalAccount("user-a"), { bound: true, changed: true });
  const recoveredLegacyEvents = await getLearningEvents({ accountId: "user-a" });
  assert.equal(recoveredLegacyEvents.length, 1);
  assert.equal(recoveredLegacyEvents[0].id, "legacy-event");
  const migrated = await getLearningDocument("challenge_progress", "legacy-quest");
  assert.equal(migrated.payload.currentStep, "second");
  assert.equal(migrated.localRevision, 2);
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("knowverse-learning-archive");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert.equal(db.objectStoreNames.contains("documents"), false);
  assert.equal(db.objectStoreNames.contains("meta"), false);
  db.close();
  await assert.rejects(bindLocalAccount("user-b"), /拒绝跨账户混用/);
  assert.deepEqual(await bindLocalAccount("user-a"), { bound: true, changed: false });
});

test("v2 database with leftover legacy stores completes all copy cursors before deleting sources", async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open("knowverse-learning-archive", 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("outbox", { keyPath: "id" });
      db.createObjectStore("meta", { keyPath: "key" });
      db.createObjectStore("documents", { keyPath: "id" });
      db.createObjectStore("conflicts", { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["meta", "documents"], "readwrite");
      tx.objectStore("meta").put({
        key: "device",
        value: { id: "v2-device", nextSeq: 12, createdAt: "2026-10-01T00:00:00Z" },
      });
      tx.objectStore("meta").put({ key: "archive:bound-user-id", value: "user-v2" });
      tx.objectStore("documents").put({
        id: "challenge_progress:v2-challenge",
        type: "challenge_progress",
        key: "v2-challenge",
        payload: { challengeId: "v2-challenge", currentStep: "runtime" },
        localRevision: 3,
        cloudRevision: 2,
        baseRevision: 2,
        deviceId: "v2-device",
        updatedAt: "2026-11-01T10:00:00Z",
        dirty: true,
        conflict: false,
      });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  });

  const diagnostics = await getLocalDatabaseDiagnostics();
  assert.equal(diagnostics.version, 4);
  assert.equal(diagnostics.documentCount, 1);
  const document = await getLearningDocument("challenge_progress", "v2-challenge");
  assert.equal(document.payload.currentStep, "runtime");
  assert.equal(document.localRevision, 3);
  assert.deepEqual(await bindLocalAccount("user-v2"), { bound: true, changed: true });
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("knowverse-learning-archive");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert.equal(db.objectStoreNames.contains("documents"), false);
  assert.equal(db.objectStoreNames.contains("meta"), false);
  db.close();
});

test("Phase C migration converts all learning domains, verifies, then removes only learning keys", async () => {
  const eventSnapshot = {
    schemaVersion: 1,
    events: [event("phase-c-event")],
    remoteEventIds: [],
  };
  const records = {
    "knowverse:learning-progress": JSON.stringify(eventSnapshot),
    "knowverse:challenge/promise-quest": JSON.stringify({ challengeId: "promise-quest", currentStep: "thenable" }),
    "knowverse:review-session/review-1": JSON.stringify({ sessionId: "review-1", status: "active" }),
    "knowverse:learning-plan:preferences": JSON.stringify({ dailyMinutes: 40, focusTopicId: "promise" }),
  };
  const storage = memoryStorage({
    [PHASE_C_STORAGE_KEY]: JSON.stringify({
      format: "knowverse-learning-state",
      schemaVersion: 1,
      revision: 9,
      records,
    }),
    "sb-project-auth-token": "auth-session",
    "code-verifier": "pkce-verifier",
  });
  globalThis.localStorage = storage;
  const first = await migratePhaseCLearningState();
  assert.equal(first.status, "migrated");
  assert.equal(first.events, 1);
  assert.equal(first.documents, 3);
  assert.equal(await countLearningEvents(), 1);
  assert.equal(await countOutbox(), 1);
  assert.equal((await getLearningDocument("challenge_progress", "promise-quest")).payload.currentStep, "thenable");
  assert.equal((await getLearningDocument("review_session", "review-1")).payload.status, "active");
  assert.equal((await getLearningDocument("plan_preferences", "preferences")).payload.dailyMinutes, 40);
  assert.equal(storage.getItem(PHASE_C_STORAGE_KEY), null);
  for (const key of Object.keys(records)) assert.equal(storage.getItem(key), null);
  assert.equal(storage.getItem("sb-project-auth-token"), "auth-session");
  assert.equal(storage.getItem("code-verifier"), "pkce-verifier");
  const second = await migratePhaseCLearningState();
  assert.equal(second.status, "already-migrated");
  assert.equal(await countLearningEvents(), 1);
});

test("standalone Promise Realm save is imported as a challenge document before the legacy key is removed", async () => {
  const storage = memoryStorage({
    "promise-realm-save-v1": JSON.stringify({
      done: [true, false, true],
      solutions: [["promise-any"], [], ["filter", "promise-race"]],
      stage: 2,
    }),
    "sb-project-auth-token": "untouched",
  });
  globalThis.localStorage = storage;
  const result = await migratePhaseCLearningState();
  assert.equal(result.status, "migrated");
  assert.equal(result.documents, 1);
  const realm = await getLearningDocument("challenge_progress", "promise-realm");
  assert.deepEqual(realm.payload.done, [true, false, true]);
  assert.equal(realm.payload.stage, 2);
  assert.equal(storage.getItem("promise-realm-save-v1"), null);
  assert.equal(storage.getItem("sb-project-auth-token"), "untouched");
});

test("corrupt Phase C input is never silently ignored or deleted", async () => {
  const storage = memoryStorage({ [PHASE_C_STORAGE_KEY]: "{broken", "knowverse:learning-progress": "still-there" });
  globalThis.localStorage = storage;
  await assert.rejects(migratePhaseCLearningState(), /无法解析/);
  assert.equal(storage.getItem(PHASE_C_STORAGE_KEY), "{broken");
  assert.equal(storage.getItem("knowverse:learning-progress"), "still-there");
});
