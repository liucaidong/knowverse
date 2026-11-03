import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { deleteLocalDatabaseForTests } from "../assets/js/backend/local-event-store.mjs";
import { LearningRepository } from "../assets/js/backend/learning-repository.mjs";
import { createLearningProgressStore } from "../assets/js/learning-progress.mjs";
import { createLearningReflectionStore, normalizeLearningReflection } from "../assets/js/learning-reflections.mjs";

const auth = { readStoredSession: () => null };
let repository;
let store;
beforeEach(async () => {
  await deleteLocalDatabaseForTests();
  repository = new LearningRepository({ auth });
  store = createLearningReflectionStore({
    repository,
    clock: (() => {
      let value = Date.parse("2026-11-03T09:00:00.000Z");
      return () => new Date(value += 1000);
    })(),
  });
});

test("a structured reflection round-trips through private learner-profile documents, never learning events", async () => {
  const before = await createLearningProgressStore().load();
  const saved = await store.save({
    context: {
      pageTitle: "Promise 调试工作台",
      pagePath: "/lab/experiments/promise-debugger/",
      topicId: "promise",
      competencyIds: ["thenable-adoption"],
      taskId: "task-promise-01",
      taskTitle: "推演 thenable 解析过程",
      ignoredSecret: "must not persist",
    },
    initialThinking: "我原来认为读取 then 属性会立刻调用它。",
    insightChanged: "读取 getter 与调用 thenable 是两个独立步骤。",
    remainingQuestions: "为什么调用被安排到微任务？",
    transferPlan: "用带 getter 的自定义 thenable 预测日志顺序。",
  });
  const after = await createLearningProgressStore().load();
  const listed = await store.list({ competencyIds: ["thenable-adoption"] });

  assert.equal(saved.schemaVersion, 1);
  assert.equal(saved.purpose, "learning_reflection");
  assert.equal(saved.context.taskId, "task-promise-01");
  assert.equal("ignoredSecret" in saved.context, false);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].reflectionId, saved.reflectionId);
  await store.save({
    context: { topicId: "typescript", pageTitle: "TypeScript" },
    initialThinking: "另一个专题的私有反思",
  });
  assert.equal((await store.list({ topicId: "promise" })).length, 1,
    "a mapped topic should only show reflections from that topic");
  assert.deepEqual(after.events, before.events, "reflection must not append mastery or activity events");
});

test("reflection validation requires actual learner input and bounds every field", async () => {
  assert.throws(() => normalizeLearningReflection({}), /至少填写一项/);
  assert.equal(normalizeLearningReflection({ initialThinking: "x".repeat(2001) }).initialThinking.length, 2000);
  const saved = await store.save({ initialThinking: "  " + "a".repeat(2100) });
  assert.equal(saved.initialThinking.length, 2000);
  await assert.rejects(() => store.save({ initialThinking: " " }), /至少填写一项/);
});

test("reflection updates use local revision checks and preserve their original creation time", async () => {
  const first = await store.save({ initialThinking: "初始理解" });
  const second = await store.save({
    reflectionId: first.reflectionId,
    initialThinking: "修订后的初始理解",
    insightChanged: "新的理解",
  });
  assert.equal(second.createdAt, first.createdAt);
  assert.notEqual(second.updatedAt, first.updatedAt);
  assert.equal(second.initialThinking, "修订后的初始理解");

  const stale = await repository.documents.get("learner_profile", "learning-reflection:" + first.reflectionId);
  await repository.commit({
    documents: [{
      type: "learner_profile",
      key: "learning-reflection:" + first.reflectionId,
      payload: { ...stale.payload, updatedAt: "2026-11-03T09:10:00.000Z" },
      expectedLocalRevision: stale.localRevision,
    }],
  });
  const staleClient = createLearningReflectionStore({
    repository: {
      documents: { get: async () => stale },
      commit: change => repository.commit(change),
    },
  });
  await assert.rejects(() => staleClient.save({
    reflectionId: first.reflectionId,
    initialThinking: "基于旧版本覆盖",
  }), /版本冲突/);
});

test("reflection journal can soft-delete one item without touching unrelated learner profile documents", async () => {
  const first = await store.save({ initialThinking: "要删除的记录" });
  const second = await store.save({ initialThinking: "保留的记录" });
  const preferences = {
    type: "learner_profile",
    key: "preferences",
    payload: { dailyMinutes: 25 },
  };
  await repository.documents.put(preferences);
  assert.equal(await store.remove(first.reflectionId), true);
  assert.equal(await store.remove(first.reflectionId), false);
  const remaining = await store.list();
  assert.deepEqual(remaining.map(item => item.reflectionId), [second.reflectionId]);
  assert.equal((await repository.documents.get("learner_profile", "preferences")).payload.dailyMinutes, 25);
});
