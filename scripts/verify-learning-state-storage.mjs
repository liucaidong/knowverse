import assert from "node:assert/strict";
import test from "node:test";
import {
  createLearningStateStorage,
  LEARNING_STATE_SCHEMA_VERSION,
  LEARNING_STATE_STORAGE_KEY,
} from "../assets/js/learning-state-storage.mjs";

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(String(key)) ?? null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
  };
}

test("consolidates the current learning keys into one envelope without touching Auth", () => {
  const raw = memoryStorage({
    "knowverse:learning-progress": JSON.stringify({ schemaVersion: 1, events: [] }),
    "knowverse:challenge/promise": JSON.stringify({ challengeId: "promise", currentStep: "thenable" }),
    "knowverse:review-session/review-1": JSON.stringify({ sessionId: "review-1", status: "active" }),
    "knowverse:learning-plan:preferences": JSON.stringify({ dailyMinutes: 40, focusTopicId: "promise" }),
    "knowverse:supabase-session": "auth-session-must-stay-outside-learning-state",
  });

  const state = createLearningStateStorage(raw);
  const envelope = JSON.parse(raw.getItem(LEARNING_STATE_STORAGE_KEY));
  assert.equal(envelope.format, "knowverse-learning-state");
  assert.equal(envelope.schemaVersion, LEARNING_STATE_SCHEMA_VERSION);
  assert.equal(Object.keys(envelope.records).length, 4);
  assert.equal(state.length, 4);
  assert.equal(JSON.parse(state.getItem("knowverse:challenge/promise")).currentStep, "thenable");
  assert.equal(JSON.parse(state.getItem("knowverse:review-session/review-1")).status, "active");
  assert.equal(state.getItem("knowverse:learning-progress"), raw.getItem(LEARNING_STATE_STORAGE_KEY) ? envelope.records["knowverse:learning-progress"] : null);
  for (const key of [
    "knowverse:learning-progress",
    "knowverse:challenge/promise",
    "knowverse:review-session/review-1",
    "knowverse:learning-plan:preferences",
  ]) assert.equal(raw.getItem(key), null, key + " must be consolidated only after the envelope exists");
  assert.equal(raw.getItem("knowverse:supabase-session"), "auth-session-must-stay-outside-learning-state");
  assert.equal(raw.length, 2, "only the learning envelope and the untouched Auth record remain");
});

test("nested learning mutations commit once through one synchronous transaction", () => {
  const raw = memoryStorage();
  const state = createLearningStateStorage(raw);
  let writes = 0;
  const originalSetItem = raw.setItem.bind(raw);
  raw.setItem = (key, value) => { writes += 1; originalSetItem(key, value); };
  const before = JSON.parse(raw.getItem(LEARNING_STATE_STORAGE_KEY));

  state.transaction(tx => {
    tx.setItem("knowverse:learning-progress", JSON.stringify({ schemaVersion: 1, events: [{ id: "e1" }] }));
    state.transaction(nested => {
      nested.setItem("knowverse:challenge/promise", JSON.stringify({ currentStep: "microtask" }));
    });
    tx.setItem("knowverse:learning-plan:preferences", JSON.stringify({ dailyMinutes: 40, focusTopicId: "promise" }));
  });

  const after = JSON.parse(raw.getItem(LEARNING_STATE_STORAGE_KEY));
  assert.equal(writes, 1, "a multi-record transaction must use exactly one storage commit");
  assert.equal(after.revision, before.revision + 1);
  assert.equal(JSON.parse(state.getItem("knowverse:challenge/promise")).currentStep, "microtask");
  assert.equal(state.length, 3);
});

test("failed and asynchronous transactions roll back without replacing the last valid state", async () => {
  const raw = memoryStorage();
  const state = createLearningStateStorage(raw);
  state.setItem("knowverse:learning-progress", JSON.stringify({ schemaVersion: 1, events: [] }));
  const before = raw.getItem(LEARNING_STATE_STORAGE_KEY);

  assert.throws(() => state.transaction(tx => {
    tx.setItem("knowverse:challenge/promise", JSON.stringify({ currentStep: "unsafe" }));
    throw new Error("abort-me");
  }), /abort-me/);
  let lateWrite;
  assert.throws(() => state.transaction(tx => {
    lateWrite = (async () => {
      await Promise.resolve();
      tx.setItem("knowverse:challenge/promise", JSON.stringify({ currentStep: "async" }));
    })();
    return lateWrite;
  }), /必须同步完成/);
  await assert.rejects(lateWrite, /事务已经结束/);

  assert.equal(raw.getItem(LEARNING_STATE_STORAGE_KEY), before);
  assert.equal(state.getItem("knowverse:challenge/promise"), null);
});

test("storage facade remains scoped to learning keys and rejects a corrupt envelope", () => {
  const raw = memoryStorage({ "knowverse:supabase-session": "keep" });
  const state = createLearningStateStorage(raw);
  assert.throws(() => state.setItem("knowverse:supabase-session", "not-learning-state"), /只能通过统一存储/);
  state.clear();
  assert.equal(state.length, 0);
  assert.equal(raw.getItem("knowverse:supabase-session"), "keep");

  const corrupted = memoryStorage({ [LEARNING_STATE_STORAGE_KEY]: "{not-json" });
  assert.throws(() => createLearningStateStorage(corrupted), /统一学习档案损坏/);
  assert.equal(corrupted.getItem(LEARNING_STATE_STORAGE_KEY), "{not-json");
});

test("a failed first migration leaves every original learning key intact", () => {
  const raw = memoryStorage({ "knowverse:learning-progress": JSON.stringify({ schemaVersion: 1, events: [] }) });
  raw.setItem = () => { throw new Error("quota exceeded"); };
  assert.throws(() => createLearningStateStorage(raw), /quota exceeded/);
  assert.ok(raw.getItem("knowverse:learning-progress"));
});


test("external notifications run only after commit and are discarded on rollback", () => {
  const raw = memoryStorage();
  const state = createLearningStateStorage(raw);
  let notifications = 0;
  let observedCommittedValue = null;

  state.transaction(tx => {
    tx.setItem("knowverse:learning-progress", JSON.stringify({ schemaVersion: 1, events: [{ id: "committed" }] }));
    state.afterCommit(() => {
      notifications += 1;
      observedCommittedValue = JSON.parse(state.getItem("knowverse:learning-progress")).events[0].id;
    });
    assert.equal(notifications, 0, "notification must not run inside the uncommitted transaction");
  });
  assert.equal(notifications, 1);
  assert.equal(observedCommittedValue, "committed");

  assert.throws(() => state.transaction(tx => {
    tx.setItem("knowverse:challenge/promise", JSON.stringify({ currentStep: "rolled-back" }));
    state.afterCommit(() => { notifications += 1; });
    throw new Error("rollback");
  }), /rollback/);
  assert.equal(notifications, 1, "rolled-back writes must not enqueue Outbox or archive notifications");
  assert.equal(state.getItem("knowverse:challenge/promise"), null);

  const committedEnvelope = raw.getItem(LEARNING_STATE_STORAGE_KEY);
  raw.setItem = (key, value) => {
    if (key === LEARNING_STATE_STORAGE_KEY) throw new Error("quota exceeded");
    raw.values.set(String(key), String(value));
  };
  assert.throws(() => state.transaction(tx => {
    tx.setItem("knowverse:challenge/promise", JSON.stringify({ currentStep: "quota-failed" }));
    state.afterCommit(() => { notifications += 1; });
  }), /quota exceeded/);
  assert.equal(notifications, 1, "failed root-envelope commit must not enqueue an event absent from local state");
  assert.equal(raw.values.get(LEARNING_STATE_STORAGE_KEY), committedEnvelope);
});
