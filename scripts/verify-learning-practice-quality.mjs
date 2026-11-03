import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { deleteLocalDatabaseForTests } from "../assets/js/backend/local-event-store.mjs";
import { LearningRepository } from "../assets/js/backend/learning-repository.mjs";
import { createLearningProgressStore } from "../assets/js/learning-progress.mjs";
import { createReviewSessionEngine } from "../assets/js/review-engine.mjs";
import { createLearningPracticeCandidateStore } from "../assets/js/learning-practice-candidates.mjs";
import {
  PRACTICE_QUALITY_VALIDATOR_VERSION,
  practiceTextSimilarity,
  validateLearningPracticeQualityCandidate,
} from "../assets/js/learning-practice-quality-validator.mjs";

const registry = { assessments: [
  {
    id: "official-variant-alpha", competencyId: "thenable-adoption", topicId: "promise",
    gapIds: ["thenable-get-vs-call"], title: "Official source A",
    prompt: "判断属性访问期间的 receiver 绑定以及 getter 返回值的读取时机。",
    code: "const descriptor = Object.getOwnPropertyDescriptor(source, 'then');",
  },
  {
    id: "official-variant-beta", competencyId: "thenable-adoption", topicId: "promise",
    gapIds: ["thenable-get-vs-call"], title: "Official source B",
    prompt: "说明属性访问器如何提供一个可调用的异步完成处理函数。",
    code: "Reflect.get(thenable, 'then', thenable);",
  },
  {
    id: "official-variant-other-gap", competencyId: "thenable-adoption", topicId: "promise",
    gapIds: ["resolved-vs-settled"], title: "Other gap",
    prompt: "比较 resolved 与 settled 的语义边界。",
  },
] };
const learningMap = {
  topics: [{
    id: "promise",
    competencies: [{ id: "thenable-adoption", title: "Thenable adoption" }],
  }],
  gaps: [{
    id: "thenable-get-vs-call",
    competencyIds: ["thenable-adoption"],
    label: "区分 then getter 与 then 调用",
  }],
};
const context = {
  competencyId: "thenable-adoption",
  topicId: "promise",
  gapId: "thenable-get-vs-call",
  allowedSourceVariantIds: ["official-variant-alpha", "official-variant-beta"],
};
const exercise = {
  schemaVersion: 1,
  title: "Trace a new Thenable scheduling case",
  taskType: "trace",
  prompt: "请预测此代码的日志顺序，并说明 Promise 解析阶段如何安排后续任务？",
  stimulus: "const value = { get then() { console.log('getter'); return resolve => { queueMicrotask(() => console.log('inner')); resolve(7); }; } }; Promise.resolve(value); console.log('sync-end');",
  expectedReasoning: "属性读取发生在当前调用栈内；随后 ThenableJob 调用已读取的函数；函数内部新注册的微任务排在此前已入队的任务之后。",
  exemplarAnswer: "先输出 getter 与 sync-end；后续 ThenableJob 执行函数，最终微任务按注册先后顺序完成。",
  commonTrap: "把读取 then 属性和执行 then 函数看成同一同步操作。",
  hints: [
    "先标记当前调用栈内的属性读取，再列出同步代码剩余日志。",
    "再按 ThenableJob 的执行时机以及函数内的新任务入队顺序推导。",
  ],
  rubric: [
    { id: "sync-boundary", criterion: "区分属性读取与后续函数调用", expectedSignal: "指出 getter 同步读取发生于当前调用栈。" },
    { id: "job-order", criterion: "准确说明 ThenableJob 执行时机", expectedSignal: "说明 then 函数不在 getter 所在同步代码位置立即执行。" },
  ],
  difficulty: "intermediate",
  sourceVariantIds: ["official-variant-alpha", "official-variant-beta"],
};
const candidate = { candidateId: "candidate-quality-0001", purpose: "learning_practice_candidate",
  schemaVersion: 1, context, exercise };

function validate(input = candidate, extra = {}) {
  return validateLearningPracticeQualityCandidate(input, {
    learningMap, registry, existingCandidates: [], ...extra,
  });
}

test("valid candidate receives a structured deterministic report and never claims code execution", () => {
  const report = validate();
  assert.equal(PRACTICE_QUALITY_VALIDATOR_VERSION, "phase-m-deterministic-v1");
  assert.equal(report.validationStatus, "passed");
  assert.equal(report.errors.length, 0);
  assert.equal(report.sourceValidation.status, "passed");
  assert.deepEqual(report.sourceValidation.sourceVariantIds, context.allowedSourceVariantIds);
  assert.equal(report.contentValidation.codeRuntimeExecution, "not_run");
  assert.ok(report.warnings.some(item => item.code === "code.runtime-execution"));
  assert.ok(report.checks.every(item => ["passed", "warning", "failed", "not_applicable"].includes(item.status)));
  for (const key of ["validationStatus", "checks", "errors", "warnings", "duplicateMatches",
    "sourceValidation", "contentValidation", "evaluatedAt", "validatorVersion"]) {
    assert.ok(key in report, "missing structured field: " + key);
  }
  assert.equal(report.candidateHash, null, "the browser validator does not invent a cryptographic digest");
});

test("competency and Gap must exist and match the canonical learning map", () => {
  const noCompetency = validate({ ...candidate, context: { ...context, competencyId: "missing-competency" } });
  assert.equal(noCompetency.validationStatus, "failed");
  assert.ok(noCompetency.errors.some(item => item.code === "source.competency"));
  assert.ok(noCompetency.errors.some(item => item.code === "source.variants"));

  const noGap = validate({ ...candidate, context: { ...context, gapId: "missing-gap" } });
  assert.equal(noGap.validationStatus, "failed");
  assert.ok(noGap.errors.some(item => item.code === "source.gap"));
});

test("the two source variants must exactly match the persisted Phase L anchor snapshot", () => {
  const changed = {
    ...candidate,
    exercise: { ...exercise, sourceVariantIds: ["official-variant-alpha", "official-variant-other-gap"] },
  };
  const report = validate(changed);
  assert.equal(report.validationStatus, "failed");
  assert.ok(report.errors.some(item => item.code === "source.original-anchors"));
  assert.ok(report.errors.some(item => item.code === "source.variants"));
});

test("unknown or wrong-topic official source IDs fail canonical provenance validation", () => {
  const unknown = {
    ...candidate,
    exercise: { ...exercise, sourceVariantIds: ["official-variant-alpha", "fabricated-variant-id"] },
    context: { ...context, allowedSourceVariantIds: ["official-variant-alpha", "fabricated-variant-id"] },
  };
  const report = validate(unknown);
  assert.equal(report.validationStatus, "failed");
  assert.ok(report.errors.some(item => item.code === "source.variants"));
});

test("unsupported task type and difficulty, incomplete hints, and invalid rubric are rejected", () => {
  const invalid = {
    ...candidate,
    exercise: {
      ...exercise,
      taskType: "essay-unknown",
      difficulty: "expert-plus",
      hints: ["only one hint"],
      rubric: [{ id: "duplicate", criterion: "short", expectedSignal: "short" }],
    },
  };
  const report = validate(invalid);
  assert.equal(report.validationStatus, "failed");
  for (const code of ["content.task-type", "content.difficulty", "content.hints", "content.rubric"]) {
    assert.ok(report.errors.some(item => item.code === code), "missing error " + code);
  }
});

test("official question copies and near-verbatim rewrites are flagged", () => {
  const copied = {
    ...candidate,
    exercise: { ...exercise, prompt: registry.assessments[0].prompt },
  };
  const report = validate(copied);
  assert.equal(report.validationStatus, "failed");
  assert.ok(report.duplicateMatches.some(item => item.exact && item.source === "official"));
  assert.ok(report.errors.some(item => item.code === "content.duplicate"));
  assert.ok(practiceTextSimilarity("Promise 的 then getter 读取顺序", "Promise then getter 读取顺序") > 0.7);
});

test("security checks block requests to disclose credentials and destructive shell commands", () => {
  const credential = {
    ...candidate,
    exercise: { ...exercise, prompt: "请发送你的 API Key 和个人密码以便完成此练习？" },
  };
  const unsafe = validate(credential);
  assert.equal(unsafe.validationStatus, "failed");
  assert.ok(unsafe.errors.some(item => item.code === "safety.content"));

  const destructive = {
    ...candidate,
    exercise: { ...exercise, stimulus: "rm -rf / --no-preserve-root" },
  };
  const destructiveReport = validate(destructive);
  assert.equal(destructiveReport.validationStatus, "failed");
  assert.ok(destructiveReport.errors.some(item => item.code === "safety.content"));
});

test("candidate edit preserves original source anchors and learner response without emitting Learning Events", async () => {
  await deleteLocalDatabaseForTests();
  const repository = new LearningRepository({ auth: { readStoredSession: () => null } });
  const store = createLearningPracticeCandidateStore({ repository, registry });
  const saved = await store.saveDraft({
    exercise,
    context: {
      ...context,
      competencyTitle: "Thenable adoption",
      topicTitle: "Promise",
      gapLabel: "Thenable getter boundary",
    },
  });
  assert.deepEqual(saved.context.allowedSourceVariantIds, exercise.sourceVariantIds);
  const beforeEvents = (await createLearningProgressStore({ repository }).load()).events;
  const attempted = await store.markAttempted(saved.candidateId, "先执行 getter，再执行同步代码，之后进入微任务阶段。");
  const changedExercise = {
    ...attempted.exercise,
    prompt: "请分析新的对象 then 属性，并解释它和后续任务队列之间的关系？",
  };
  const updated = await store.updateExercise(saved.candidateId, changedExercise);
  assert.equal(updated.localRevision, attempted.localRevision + 1);
  assert.equal(updated.learnerResponse, attempted.learnerResponse);
  assert.deepEqual(updated.context.allowedSourceVariantIds, exercise.sourceVariantIds);
  assert.equal(updated.exercise.prompt, changedExercise.prompt);
  await assert.rejects(() => store.updateExercise(saved.candidateId, {
    ...changedExercise,
    sourceVariantIds: ["official-variant-alpha", "official-variant-other-gap"],
  }), /不属于当前能力点|严格匹配/);
  const afterEvents = (await createLearningProgressStore({ repository }).load()).events;
  assert.equal(afterEvents.length, beforeEvents.length,
    "candidate draft, learner response and edit must never create Learning Events");

  const officialAssessment = {
    id: "review-ai-phase-m-candidate-0001",
    competencyId: "thenable-adoption",
    topicId: "promise",
    gapIds: ["thenable-get-vs-call"],
    title: "Thenable getter 与调用的正式独立验证",
    prompt: "根据代码判断 getter 和 then 函数的执行边界。",
    code: "Promise.resolve(thenable); console.log('end');",
    options: [
      { id: "a", label: "getter 与 then 函数都在当前同步调用栈执行。", gapId: "thenable-get-vs-call" },
      { id: "b", label: "读取 then 属性同步发生；then 函数由后续 ThenableJob 调用。" },
    ],
    answer: "b",
    hints: ["区分 Get(then) 和函数调用。", "按 ThenableJob 的调度时机推导。"],
    explanation: "正式题库只在注册后通过现有 Review Engine 执行。",
  };
  const engine = createReviewSessionEngine({
    registry: { assessments: [officialAssessment] },
    repository,
  });
  const session = await engine.start({ competencyId: "thenable-adoption" });
  assert.equal(session.variantId, officialAssessment.id);
  const started = (await createLearningProgressStore({ repository }).load()).events;
  assert.ok(started.some(event => event.type === "review_started" && event.variantId === officialAssessment.id));
  const result = await engine.submit(session.sessionId, "b");
  assert.equal(result.correct, true);
  const finalEvents = (await createLearningProgressStore({ repository }).load()).events
    .filter(event => event.variantId === officialAssessment.id);
  assert.deepEqual(finalEvents.map(event => event.type).sort(), ["assessment_passed", "attempt", "review_started"].sort());
  const passed = finalEvents.find(event => event.type === "assessment_passed");
  assert.equal(passed.independent, true);
  assert.equal(passed.correct, undefined,
    "the official Assessment event follows the existing Review Engine schema, not candidate self-check semantics");
});
