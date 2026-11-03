import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { deleteLocalDatabaseForTests } from "../assets/js/backend/local-event-store.mjs";
import { LearningRepository } from "../assets/js/backend/learning-repository.mjs";
import { createLearningProgressStore } from "../assets/js/learning-progress.mjs";
import {
  createLearningPracticeCandidateStore,
  parseLearningPracticeCandidateReply,
  validateLearningPracticeCandidate,
} from "../assets/js/learning-practice-candidates.mjs";

const registry = { assessments: [
  {
    id: "review-gap-a", competencyId: "thenable-adoption", topicId: "promise",
    gapIds: ["thenable-get-vs-call"], title: "正式变体 A",
    prompt: "读取 then 属性和调用函数的同步边界是什么？",
    code: "Promise.resolve(thenable); console.log('end');",
  },
  {
    id: "review-gap-b", competencyId: "thenable-adoption", topicId: "promise",
    gapIds: ["thenable-get-vs-call"], title: "正式变体 B",
    prompt: "then getter 与 ThenableJob 的先后顺序如何？",
    code: "Promise.resolve(value); queueMicrotask(callback);",
  },
  {
    id: "review-gap-c", competencyId: "thenable-adoption", topicId: "promise",
    gapIds: ["thenable-get-vs-call"], title: "正式变体 C",
    prompt: "如果 getter 返回一个函数，Promise 何时调用这个函数？",
  },
  {
    id: "review-other-gap", competencyId: "thenable-adoption", topicId: "promise",
    gapIds: ["resolved-vs-settled"], title: "其他 Gap",
    prompt: "outer Promise 为什么仍然 pending？",
  },
] };
const context = {
  competencyId: "thenable-adoption",
  competencyTitle: "Thenable 解析",
  topicId: "promise",
  topicTitle: "ES Promise",
  gapId: "thenable-get-vs-call",
  gapLabel: "then 属性读取与函数调用混淆",
};
const candidate = {
  title: "观察 getter 与 ThenableJob 的新场景",
  taskType: "trace",
  prompt: "假设 then getter 返回的函数内部又注册一个 queueMicrotask。请预测所有日志的先后顺序，并说明入队依据。",
  stimulus: "const t = { get then() { console.log('get'); return resolve => { console.log('call'); queueMicrotask(() => console.log('inner')); resolve(1); }; } }; Promise.resolve(t); queueMicrotask(() => console.log('outer'));",
  expectedReasoning: "先在同步执行阶段读取 getter；ThenableJob 在当前调用栈后执行；函数内部新注册的任务排在此前已入队的任务之后。",
  exemplarAnswer: "get → call → outer → inner（具体顺序需按 ThenableJob 开始前的队列状态和函数执行时新任务的入队位置逐项推导）。",
  commonTrap: "把 getter 读取、then 函数调用、函数内部注册的微任务看成同一个同步阶段。",
  hints: ["先把同步调用栈中的 getter 读取单独标出。", "再按微任务入队的先后顺序逐个处理任务。"],
  rubric: [
    { id: "sync-get", criterion: "区分 getter 同步读取", expectedSignal: "get 在同步日志中先出现" },
    { id: "job-order", criterion: "识别 ThenableJob", expectedSignal: "then 函数由后续 Job 调用" },
    { id: "fifo", criterion: "解释新增微任务入队位置", expectedSignal: "按真实入队先后推导 FIFO" },
  ],
  difficulty: "stretch",
  sourceVariantIds: ["review-gap-a", "review-gap-b"],
};

const auth = { readStoredSession: () => null };
let repository;
let store;
beforeEach(async () => {
  await deleteLocalDatabaseForTests();
  repository = new LearningRepository({ auth });
  store = createLearningPracticeCandidateStore({ repository, registry });
});

test("candidate schema binds to an exact competency and gap and requires two canonical source variants", () => {
  const valid = validateLearningPracticeCandidate(candidate, { ...context, registry });
  assert.equal(valid.taskType, "trace");
  assert.deepEqual(valid.sourceVariantIds, ["review-gap-a", "review-gap-b"]);
  assert.throws(() => validateLearningPracticeCandidate({
    ...candidate, sourceVariantIds: ["review-gap-a"],
  }, { ...context, registry }), /两个不同正式题目变体/);
  assert.throws(() => validateLearningPracticeCandidate({
    ...candidate, sourceVariantIds: ["review-gap-a", "review-other-gap"],
  }, { ...context, registry }), /不属于当前能力点/);
  assert.throws(() => validateLearningPracticeCandidate(candidate, {
    ...context, competencyId: "other-competency", registry,
  }), /不属于当前能力点/);
  assert.throws(() => validateLearningPracticeCandidate(candidate, {
    ...context,
    registry,
    allowedSourceVariantIds: ["review-gap-a", "review-gap-c"],
  }), /严格匹配本轮提供/);
});

test("candidate content cannot be an exact copy or repeat a previously generated draft", () => {
  assert.throws(() => validateLearningPracticeCandidate({
    ...candidate,
    prompt: registry.assessments[0].prompt,
  }, { ...context, registry }), /与引用的正式题目重复/);
  assert.throws(() => validateLearningPracticeCandidate({
    ...candidate,
    prompt: "读取then属性和调用函数的同步边界是什么",
  }, { ...context, registry }), /与引用的正式题目重复/);
  assert.throws(() => validateLearningPracticeCandidate({
    ...candidate,
    stimulus: registry.assessments[0].code,
  }, { ...context, registry }), /与引用的正式题目重复/);
  assert.throws(() => validateLearningPracticeCandidate({
    ...candidate,
    stimulus: registry.assessments[0].code,
  }, { ...context, registry }), /与引用的正式题目重复/);
  assert.throws(() => validateLearningPracticeCandidate(candidate, {
    ...context,
    registry,
    existingCandidates: [{ context, exercise: candidate }],
  }), /已有草案重复/);
});

test("recent official variant usage requires at least one fresh canonical anchor when available", () => {
  assert.throws(() => validateLearningPracticeCandidate(candidate, {
    ...context,
    registry,
    recentlyUsedVariantIds: ["review-gap-a", "review-gap-b"],
  }), /至少应包含一个未近期使用的正式题目锚点/);
});

test("AI response must be strict JSON and reject extra fields or malformed rubric", () => {
  const fence = String.fromCharCode(96).repeat(3);
  assert.throws(() => parseLearningPracticeCandidateReply(fence + "json\\n" +
    JSON.stringify(candidate) + "\\n" + fence, { ...context, registry }), /纯 JSON/);
  assert.throws(() => parseLearningPracticeCandidateReply(JSON.stringify({
    ...candidate, masteryScore: 100,
  }), { ...context, registry }), /未允许字段/);
  assert.throws(() => parseLearningPracticeCandidateReply(JSON.stringify({
    ...candidate,
    rubric: [
      { id: "same", criterion: "检查同步 getter 读取顺序", expectedSignal: "能说明 getter 是同步属性访问" },
      { id: "same", criterion: "检查同步 getter 读取顺序", expectedSignal: "能说明 getter 是同步属性访问" },
    ],
  }), { ...context, registry }), /无效或重复/);
});

test("private candidate documents save, list, and preserve learner responses without writing learning events", async () => {
  const saved = await store.saveDraft({ exercise: candidate, context });
  assert.equal(saved.status, "draft");
  assert.equal(saved.purpose, "learning_practice_candidate");
  assert.equal("variantId" in saved, false);
  const before = await createLearningProgressStore({ repository }).load();
  const updated = await store.markAttempted(saved.candidateId, "我认为 getter 同步执行，then 函数随后由 ThenableJob 执行。");
  const after = await createLearningProgressStore({ repository }).load();
  assert.equal(updated.status, "attempted");
  assert.equal(updated.learnerResponse.length > 0, true);
  assert.equal(after.events.length, before.events.length);
  assert.equal((await store.list({ ...context })).length, 1);
  await assert.rejects(() => store.markAttempted(saved.candidateId, "覆盖首次答案"), /不会覆盖第一次作答/);
});

test("candidate soft-delete is isolated from official learner preferences", async () => {
  const saved = await store.saveDraft({ exercise: candidate, context });
  await repository.documents.put({
    type: "learner_profile", key: "preferences", payload: { dailyMinutes: 30 },
  });
  assert.equal(await store.remove(saved.candidateId), true);
  assert.equal(await store.remove(saved.candidateId), false);
  assert.equal((await store.list(context)).length, 0);
  assert.equal((await repository.documents.get("learner_profile", "preferences")).payload.dailyMinutes, 30);
});
