import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  applyRemoteArchiveDocument,
  commitLearningBatch,
  deleteLocalDatabaseForTests,
  getArchiveStatus,
  getLearningDocument,
  listArchiveConflicts,
  listPendingArchiveDocuments,
  mergeRemoteLearningEvents,
  resolveArchiveConflict,
} from "../assets/js/backend/local-event-store.mjs";

const USER_ID = "n2-conflict-resolution-test-user";
beforeEach(async () => {
  await deleteLocalDatabaseForTests();
});

function strategyProfile(updatedAt) {
  return {
    schemaVersion: 1,
    algorithmVersion: 1,
    profileRevision: 0,
    mode: "adaptive",
    active: false,
    personalizationLevel: "cold-start",
    confidence: { level: "low", score: 0, weightedSamples: 0 },
    parameters: {
      taskLoadMultiplier: 1,
      reviewIntervalMultiplier: 1,
      difficultyBias: 0,
      difficultyBiasByCompetency: {},
      interventionPreference: "active-recall",
      reviewIntervalsByCompetency: {},
    },
    recommendation: { difficulty: "maintain", intervention: "active-recall" },
    evidence: { sampleCounts: { independent: 0 }, source: "events" },
    observedWindow: {
      days: 180,
      from: updatedAt.replace("2026-11-04", "2026-05-08"),
      to: updatedAt,
    },
    sourceFingerprint: "same-learning-event-set",
    latestEvidenceAt: null,
    updatedAt,
    lastParameterChangeAt: null,
    lastDecision: null,
    history: [],
    limitations: ["test limitation"],
    effectiveness: { status: "observing" },
  };
}

function projection(updatedAt) {
  return {
    schemaVersion: 3,
    engineVersion: 3,
    algorithmVersions: { spacedRepetition: 2, risk: 1, nextBestAction: 1, learningStrategy: 1 },
    strategyProfile: strategyProfile(updatedAt),
    strategyEffectiveness: { status: "observing" },
    sourceFingerprint: "same-learning-event-set",
    sourceEventCount: 0,
    latestEvidenceAt: null,
    computedAt: updatedAt,
    summary: { dueCount: 0, overdueCount: 0 },
    schedules: [{ competencyId: "promise-thenable", status: "new" }],
    risks: [],
    trends: [],
    diagnostics: [],
    goalForecasts: [],
    nextBestActions: [],
    timeline: [],
  };
}

async function seedLocalDocument(type, key, payload) {
  await commitLearningBatch({
    accountId: USER_ID,
    documents: [{ type, key, payload }],
  });
}

function remoteDocument(type, key, payload, revision = 1) {
  return {
    document_id: type + ":" + encodeURIComponent(key),
    document_type: type,
    document_key: key,
    document_payload: payload,
    revision,
    document_seq: revision,
    device_id: "remote-device",
    updated_at: "2026-11-04T04:14:07.308Z",
  };
}

test("strategy snapshot timestamp drift is semantically identical and does not create a conflict", async () => {
  const local = strategyProfile("2026-11-04T04:31:04.073Z");
  const cloud = strategyProfile("2026-11-04T04:14:07.308Z");
  await seedLocalDocument("learner_profile", "strategy", local);

  const result = await applyRemoteArchiveDocument(
    remoteDocument("learner_profile", "strategy", cloud), USER_ID,
  );
  const stored = await getLearningDocument("learner_profile", "strategy");

  assert.equal(result.status, "applied");
  assert.equal(result.semanticIdentical, true);
  assert.deepEqual(stored.payload, local, "Keep the freshly computed local snapshot metadata.");
  assert.equal(stored.cloudRevision, 1);
  assert.equal(stored.baseRevision, 1);
  assert.equal(stored.dirty, false);
  assert.equal(stored.conflict, false);
  assert.equal((await listArchiveConflicts()).length, 0);
});

test("proactive projection is local-only even when its source fingerprint differs across devices", async () => {
  const local = projection("2026-11-04T04:31:04.073Z");
  const cloud = projection("2026-11-04T04:14:07.308Z");
  cloud.sourceFingerprint = "different-cloud-event-set";
  await seedLocalDocument("proactive_learning_projection", "current", local);

  const result = await applyRemoteArchiveDocument(
    remoteDocument("proactive_learning_projection", "current", cloud), USER_ID,
  );
  const stored = await getLearningDocument("proactive_learning_projection", "current");

  assert.equal(result.status, "ignored");
  assert.equal(result.reason, "derived-cache-local-only");
  assert.deepEqual(stored.payload, local, "Keep the local derived cache until it is rebuilt from merged events.");
  assert.equal(stored.dirty, false);
  assert.equal(stored.conflict, false);
  assert.equal((await listArchiveConflicts()).length, 0);
});

test("real learner strategy changes remain visible and can be resolved without dropping the local copy", async () => {
  const local = strategyProfile("2026-11-04T04:31:04.073Z");
  const cloud = strategyProfile("2026-11-04T04:14:07.308Z");
  cloud.parameters.taskLoadMultiplier = 1.25;
  await seedLocalDocument("learner_profile", "strategy", local);

  const result = await applyRemoteArchiveDocument(
    remoteDocument("learner_profile", "strategy", cloud), USER_ID,
  );
  assert.equal(result.status, "conflict");
  const [conflict] = await listArchiveConflicts();
  assert.equal(conflict.remote.document_type, "learner_profile");
  assert.equal(conflict.remote.document_key, "strategy");
  assert.equal(conflict.remote.revision, 1);

  const resolved = await resolveArchiveConflict(conflict.id, "local");
  assert.equal(resolved.dirty, true);
  assert.equal(resolved.cloudRevision, 1);
  assert.equal(resolved.baseRevision, 1);
  assert.equal(resolved.payload.parameters.taskLoadMultiplier, 1);
  assert.equal((await listArchiveConflicts()).length, 0);
});

test("legacy timestamp-only conflict records are reconciled when the archive panel reads them", async () => {
  const local = strategyProfile("2026-11-04T04:31:04.073Z");
  const cloud = strategyProfile("2026-11-04T04:14:07.308Z");
  await seedLocalDocument("learner_profile", "strategy", local);

  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("knowverse-learning-archive");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = db.transaction(["learningDocuments", "conflicts"], "readwrite");
  const id = "learner_profile:strategy";
  const row = await new Promise((resolve, reject) => {
    const request = tx.objectStore("learningDocuments").get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  tx.objectStore("learningDocuments").put({ ...row, conflict: true });
  tx.objectStore("conflicts").put({
    id: id + ":1",
    documentId: id,
    remote: remoteDocument("learner_profile", "strategy", cloud),
    createdAt: "2026-11-04T04:14:07.308Z",
  });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();

  assert.equal((await listArchiveConflicts()).length, 0);
  const reconciled = await getLearningDocument("learner_profile", "strategy");
  assert.equal(reconciled.dirty, false);
  assert.equal(reconciled.conflict, false);
  assert.equal(reconciled.cloudRevision, 1);
});

test("account panel renders document type and key from the nested remote conflict record", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../assets/js/backend/account-panel.mjs", import.meta.url), "utf8",
  );
  assert.match(source, /remote\.document_type/);
  assert.match(source, /remote\.document_key/);
  assert.match(source, /archiveDocumentLabels/);
  assert.doesNotMatch(source, /conflict\.document_type\s*\+\s*["']\s*·/);
});


test("proactive projection is a local-only rebuildable cache and never enters the cloud Outbox", async () => {
  const cache = projection("2026-11-04T04:31:04.073Z");
  await seedLocalDocument("proactive_learning_projection", "current", cache);
  const stored = await getLearningDocument("proactive_learning_projection", "current");
  const pending = await listPendingArchiveDocuments();
  const status = await getArchiveStatus();

  assert.equal(stored.dirty, false);
  assert.equal(stored.conflict, false);
  assert.equal(pending.some(row => row.type === "proactive_learning_projection"), false);
  assert.equal(status.pendingDocuments, 0);
  assert.equal(status.conflicts, 0);
});

test("a remote proactive projection is ignored and legacy cache conflicts are silently retired", async () => {
  const local = projection("2026-11-04T04:31:04.073Z");
  const remote = projection("2026-11-04T04:14:07.308Z");
  remote.sourceFingerprint = "cloud-has-restored-events";
  await seedLocalDocument("proactive_learning_projection", "current", local);

  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("knowverse-learning-archive");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const id = "proactive_learning_projection:current";
  const row = await new Promise((resolve, reject) => {
    const request = db.transaction("learningDocuments").objectStore("learningDocuments").get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = db.transaction(["learningDocuments", "conflicts"], "readwrite");
  tx.objectStore("learningDocuments").put({ ...row, dirty: true, conflict: true });
  tx.objectStore("conflicts").put({
    id: id + ":2", documentId: id,
    remote: remoteDocument("proactive_learning_projection", "current", remote, 2),
    createdAt: "2026-11-04T04:14:07.308Z",
  });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();

  const result = await applyRemoteArchiveDocument(
    remoteDocument("proactive_learning_projection", "current", remote, 2), USER_ID,
  );
  assert.equal(result.status, "ignored");
  assert.equal(result.reason, "derived-cache-local-only");
  assert.equal((await listArchiveConflicts()).length, 0);
  const kept = await getLearningDocument("proactive_learning_projection", "current");
  assert.deepEqual(kept.payload, local, "A cloud projection must never overwrite the local derived cache.");
  assert.equal(kept.dirty, false);
  assert.equal(kept.conflict, false);
});

test("remote event merge announces new source events so derived projections can rebuild", async () => {
  const received = [];
  const priorWindow = globalThis.window;
  globalThis.window = new EventTarget();
  globalThis.window.addEventListener("knowverse:learning-events-appended", event => received.push(event.detail));
  try {
    const event = {
      id: "remote-event-for-rebuild",
      type: "attempt",
      at: "2026-11-04T04:45:00.000Z",
      topicId: "promise",
      challengeId: "n2-remote",
      stepId: "remote-step",
    };
    const merged = await mergeRemoteLearningEvents([{
      event_id: event.id,
      event_payload: event,
      user_seq: 88,
      device_id: "remote-device",
      device_seq: 4,
    }], USER_ID);
    assert.equal(merged, 1);
    assert.equal(received.length, 1);
    assert.equal(received[0].remote, true);
    assert.deepEqual(received[0].events.map(item => item.id), [event.id]);
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});


test("learning progress waits for initial authenticated sync before deriving strategy projections", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../assets/js/learning-progress-page.mjs", import.meta.url), "utf8",
  );
  const waitIndex = source.indexOf("await archiveRuntime.initialSyncPromise");
  const profileIndex = source.indexOf("profileStore = createLearnerProfileStore");
  const engineIndex = source.indexOf("proactiveEngine = createProactiveLearningEngine");
  assert.ok(waitIndex >= 0, "The progress page must await the bootstrap sync promise.");
  assert.ok(profileIndex > waitIndex, "Profile derivation must start after cloud state restoration.");
  assert.ok(engineIndex > waitIndex, "Projection derivation must start after cloud state restoration.");
});


test("conflict panel listing retires legacy conflicts for a local-only projection cache", async () => {
  const cache = projection("2026-11-04T04:31:04.073Z");
  await seedLocalDocument("proactive_learning_projection", "current", cache);
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("knowverse-learning-archive");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const id = "proactive_learning_projection:current";
  const tx = db.transaction(["learningDocuments", "conflicts"], "readwrite");
  const row = await new Promise((resolve, reject) => {
    const request = tx.objectStore("learningDocuments").get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  tx.objectStore("learningDocuments").put({ ...row, dirty: true, conflict: true });
  tx.objectStore("conflicts").put({
    id: id + ":8", documentId: id,
    remote: remoteDocument("proactive_learning_projection", "current", {
      ...cache, sourceFingerprint: "newer-cloud-events",
    }, 8),
    createdAt: "2026-11-04T04:50:00.000Z",
  });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();

  assert.equal((await listArchiveConflicts()).length, 0);
  const kept = await getLearningDocument("proactive_learning_projection", "current");
  assert.deepEqual(kept.payload, cache);
  assert.equal(kept.dirty, false);
  assert.equal(kept.conflict, false);
});
