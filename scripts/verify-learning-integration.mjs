import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test, { beforeEach } from "node:test";
import { deleteLocalDatabaseForTests } from "../assets/js/backend/local-event-store.mjs";
import { resetLearningRepositoryForTests } from "../assets/js/backend/learning-repository.mjs";

beforeEach(async () => {
  resetLearningRepositoryForTests();
  await deleteLocalDatabaseForTests();
});
import { createLearningCheckpointEngine } from "../assets/js/learning-checkpoint-engine.mjs";
import { createChallengeLearningEvents, createLearningProgressStore, deriveLearningInsights } from "../assets/js/learning-progress.mjs";
import { completeStep, createChallengeProgress, recordAttempt, setStepData } from "../assets/js/challenge-engine.mjs";
import { createReviewSessionEngine } from "../assets/js/review-engine.mjs";

const readJSON = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

test("all live works declare a learning contract and use the shared integration entry", async () => {
  const works = await readJSON("../content/works.json");
  const knowledge = await readJSON("../content/knowledge.json");
  const map = await readJSON("../content/learning-map.json");
  const challenges = await readJSON("../content/challenges.json");
  const checkpoints = await readJSON("../content/learning-checkpoints.json");
  const topicIds = new Set(knowledge.topics.map(item => item.id));
  const competencyIds = new Set(map.topics.flatMap(topic => topic.competencies.map(item => item.id)));
  const challengeMap = new Map(challenges.challenges.map(item => [item.id, item]));
  const checkpointMap = new Map(checkpoints.checkpoints.map(item => [item.id, item]));
  assert.equal(works.pillars.length, 3);
  assert.equal(works.works.length, 17);
  assert.equal(checkpoints.checkpoints.length, 14);
  for (const work of works.works.filter(item => item.status === "live")) {
    assert.equal(work.learning.activityTracking, true, work.id);
    assert.ok(work.knowledge_ids.every(id => topicIds.has(id)), work.id);
    assert.ok(work.learning.competencyIds.length > 0, work.id);
    assert.ok(work.learning.competencyIds.every(id => competencyIds.has(id)), work.id);
    const assessment = work.learning.assessment;
    if (assessment.type === "challenge") {
      const challenge = challengeMap.get(assessment.challengeId);
      assert.ok(challenge, work.id);
      assert.equal(challenge.workId, work.id);
      const mapped = new Set(challenge.steps.flatMap(step => step.competencyIds || []));
      assert.ok(work.learning.competencyIds.every(id => mapped.has(id)), work.id);
    } else {
      const checkpoint = checkpointMap.get(assessment.checkpointId);
      assert.ok(checkpoint, work.id);
      assert.equal(checkpoint.workId, work.id);
      assert.ok(work.learning.competencyIds.includes(checkpoint.competencyId), work.id);
      const route = work.href.replace(/^\.\//, "") + "index.html";
      const html = await readFile(new URL("../" + route, import.meta.url), "utf8");
      assert.match(html, /learning-integration\.mjs/, work.id);
    }
  }
});

test("checkpoint errors create precise gaps but only independent Review can resolve them", async () => {
  const [map, challenges, checkpointRegistry, reviewRegistry] = await Promise.all([
    readJSON("../content/learning-map.json"),
    readJSON("../content/challenges.json"),
    readJSON("../content/learning-checkpoints.json"),
    readJSON("../content/review-assessments.json"),
  ]);
  const checkpoint = checkpointRegistry.checkpoints.find(item => item.id === "cp-monorepo-cache");
  const store = createLearningProgressStore();
  const engine = createLearningCheckpointEngine({ store, registry: [checkpoint] });
  const session = await engine.start(checkpoint.id);
  const wrong = checkpoint.options.find(item => item.gapId);
  const result = await engine.submit(session.sessionId, wrong.id);
  assert.equal(result.correct, false);
  let insight = deriveLearningInsights(map, challenges, await store.load(), new Date("2026-11-01T12:00:00.000Z"));
  let node = insight.competencyInsights.find(item => item.id === checkpoint.competencyId);
  assert.equal(node.evidenceCount, 0);
  assert.equal(node.status, "weak");
  assert.equal(node.activeGaps[0].id, "build-cache-input-coverage");

  const second = await engine.start(checkpoint.id);
  await engine.submit(second.sessionId, checkpoint.answer);
  insight = deriveLearningInsights(map, challenges, await store.load(), new Date("2026-11-01T12:00:00.000Z"));
  node = insight.competencyInsights.find(item => item.id === checkpoint.competencyId);
  assert.equal(node.evidenceCount, 1);
  assert.equal(insight.gaps.length, 1, "checkpoint success must not clear a diagnosed gap");

  const review = createReviewSessionEngine({ progressStore: store, registry: reviewRegistry });
  const reviewA = await review.start({ competencyId: checkpoint.competencyId, gapId: "build-cache-input-coverage" });
  assert.equal(reviewA.hintsUsed, 0);
  const wrongReviewOption = reviewA.options.find(option => option.gapId === "build-cache-input-coverage");
  assert.equal((await review.submit(reviewA.sessionId, wrongReviewOption.id)).correct, false);
  const reviewB = await review.start({ competencyId: checkpoint.competencyId, gapId: "build-cache-input-coverage" });
  assert.notEqual(reviewB.variantId, reviewA.variantId);
  assert.equal((await review.submit(reviewB.sessionId, reviewB.answer)).correct, true);
  insight = deriveLearningInsights(map, challenges, await store.load(), new Date("2026-11-01T12:00:00.000Z"));
  assert.ok(insight.resolvedGaps.some(item => item.id === "build-cache-input-coverage"));
});

test("campaign challenge completion events carry strategy provenance and distinguish hint-assisted results", async () => {
  const registry = await readJSON("../content/challenges.json");
  const challenge = registry.challenges.find(item => item.id === "promise-mechanism-quest");
  const step = challenge.steps[0];
  let progress = createChallengeProgress(challenge);
  const previous = progress;
  progress = recordAttempt(progress, step.id);
  progress = setStepData(progress, step.id, {
    lastOptionId: step.answer, correctOptionId: step.answer,
  });
  progress = completeStep(progress, challenge, step.id);
  const events = createChallengeLearningEvents(challenge, previous, progress, {
    strategyContext: {
      taskId: "campaign-task", strategyDecisionId: "campaign-decision",
      strategyProfileRevision: 3, learningIntervention: "transfer-challenge",
      strategyInstruction: "尝试新题型", difficultyLevel: "stretch",
    },
  });
  const attempt = events.find(item => item.type === "attempt");
  const completed = events.find(item => item.type === "completed");
  assert.equal(attempt.taskId, "campaign-task");
  assert.equal(completed.strategyDecisionId, "campaign-decision");
  assert.equal(completed.strategyProfileRevision, 3);
  assert.equal(completed.learningIntervention, "transfer-challenge");
  assert.equal(completed.difficultyLevel, "stretch");
  assert.equal(completed.independent, true);
});

test("checkpoint learning evidence retains the strategy decision attached to its task", async () => {
  const registry = await readJSON("../content/learning-checkpoints.json");
  const checkpoint = registry.checkpoints.find(item => item.id === "cp-promise-identity");
  const store = createLearningProgressStore();
  const engine = createLearningCheckpointEngine({ store, registry: [checkpoint] });
  const session = await engine.start(checkpoint.id, {
    strategyDecisionId: "checkpoint-strategy-decision",
    strategyProfileRevision: 7,
    learningIntervention: "transfer-challenge",
    strategyInstruction: "使用新的检查点验证知识迁移。",
    difficultyLevel: "stretch",
  });
  assert.equal(session.strategyDecisionId, "checkpoint-strategy-decision");
  assert.equal((await engine.submit(session.sessionId, checkpoint.answer)).correct, true);
  const events = (await store.load()).events;
  const started = events.find(item => item.type === "checkpoint_started");
  const passed = events.find(item => item.type === "assessment_passed");
  assert.equal(started.strategyDecisionId, "checkpoint-strategy-decision");
  assert.equal(passed.strategyDecisionId, "checkpoint-strategy-decision");
  assert.equal(passed.strategyProfileRevision, 7);
  assert.equal(passed.learningIntervention, "transfer-challenge");
  assert.equal(passed.difficultyLevel, "stretch");
});

test("a correct checkpoint creates one independent no-hint evidence variant", async () => {
  const registry = await readJSON("../content/learning-checkpoints.json");
  const checkpoint = registry.checkpoints.find(item => item.id === "cp-promise-identity");
  const store = createLearningProgressStore();
  const engine = createLearningCheckpointEngine({ store, registry: [checkpoint] });
  const session = await engine.start(checkpoint.id);
  assert.equal((await engine.submit(session.sessionId, checkpoint.answer)).correct, true);
  const events = (await store.load()).events;
  assert.equal(events.filter(item => item.type === "assessment_passed").length, 1);
  const passed = events.find(item => item.type === "assessment_passed");
  assert.equal(passed.sessionType, "checkpoint");
  assert.equal(passed.variantId, checkpoint.id);
  assert.equal(passed.hintsUsed, 0);
  assert.equal(passed.workId, checkpoint.workId);
});

test("the assessment catalog covers 15 competencies, 31 gaps and 72 targeted variants", async () => {
  const map = await readJSON("../content/learning-map.json");
  const registry = await readJSON("../content/review-assessments.json");
  const ids = new Set(map.topics.flatMap(topic => topic.competencies.map(item => item.id)));
  const gaps = new Set(map.gaps.map(item => item.id));
  assert.equal(ids.size, 15);
  assert.equal(gaps.size, 31);
  assert.equal(registry.assessments.length, 72);
  const promiseAssessments = registry.assessments.filter(item => item.topicId === "promise");
  assert.equal(promiseAssessments.length, 30);
  const difficultyBands = new Set(["foundation", "intermediate", "stretch"]);
  for (const item of promiseAssessments) {
    assert.ok(difficultyBands.has(item.difficulty), item.id + " difficulty");
    assert.match(item.lessonId, /^lesson-\d{2}$/);
    const source = await readFile(new URL("../knowledge/promise/" + item.lessonId + "/index.md", import.meta.url), "utf8");
    assert.ok(source.length > 500, item.id + " source lesson");
  }
  for (const item of registry.assessments) {
    assert.ok(ids.has(item.competencyId), item.id);
    assert.ok(item.gapIds.length > 0, item.id);
    assert.ok(item.gapIds.every(id => gaps.has(id)), item.id);
    assert.ok(difficultyBands.has(item.difficulty), item.id + " difficulty");
    assert.ok(item.sourceHref?.startsWith("./knowledge/"), item.id + " sourceHref");
    assert.ok(item.sourceLabel?.trim(), item.id + " sourceLabel");
    const sourceRoute = item.sourceHref.replace(/^\.\//, "") + "index.html";
    await readFile(new URL("../" + sourceRoute, import.meta.url), "utf8");
  }
});

test("Promise review examples produce the documented runtime outcomes", async () => {
  const registry = await readJSON("../content/review-assessments.json");
  const byId = new Map(registry.assessments.map(item => [item.id, item]));
  const run = id => execFileSync(process.execPath, ["--input-type=module", "-e", byId.get(id).code], {
    encoding: "utf8", timeout: 3000,
  }).trim().split(/\r?\n/);
  assert.deepEqual(run("review-getter-sync-a"), ["get", "after", "rejected"]);
  assert.deepEqual(run("review-all-race-order-a"), ["race fast", "all [ 'slow', 'fast' ]"]);
  assert.deepEqual(run("review-all-waits-all-b"), ["all rejected bad", "slow settled"]);
  assert.deepEqual(run("review-all-no-cancel-a"), ["combined rejected fast failure", "slow still running"]);
  assert.deepEqual(run("review-then-new-promise-b"), ["false"]);
  assert.deepEqual(run("review-adoption-timeline-a"), ["sync end", "outer"]);
  const explicitCancel = byId.get("review-all-no-cancel-b").code;
  assert.match(explicitCancel, /signal: controller\.signal/);
  assert.match(explicitCancel, /controller\.abort\(\)/);
});

test("Promise Review sessions retain official difficulty and lesson provenance", async () => {
  const registry = await readJSON("../content/review-assessments.json");
  const engine = createReviewSessionEngine({ progressStore: createLearningProgressStore(), registry });
  const session = await engine.start({
    competencyId: "thenable-adoption",
    variantId: "review-thenable-get-vs-call-a",
  });
  assert.equal(session.difficulty, "foundation");
  assert.equal(session.lessonId, "lesson-03");
  const assessment = await engine.getAssessment(session.sessionId);
  assert.equal(assessment.difficulty, session.difficulty);
  assert.equal(assessment.lessonId, session.lessonId);
  assert.equal(session.sourceHref, "./knowledge/promise/lesson-03/");
  assert.equal(session.sourceLabel, "课程来源 · 第 03 单元");

  const monorepo = await engine.start({ competencyId: "workspace-resolution", variantId: "review-workspace-protocol-a" });
  assert.equal(monorepo.difficulty, "foundation");
  assert.equal(monorepo.sourceHref, "./knowledge/monorepo/chapter-01/");
  const reactNative = await engine.start({ competencyId: "rn-jsi-boundaries", variantId: "review-rn-jsi-bridge-myth-a" });
  assert.equal(reactNative.difficulty, "foundation");
  assert.equal(reactNative.sourceHref, "./knowledge/react-native/chapter-03/");
});

test("Promise course lessons use the shared learning integration and mapped reader routes are real pages", async () => {
  const map = await readJSON("../content/learning-map.json");
  const topic = map.topics.find(item => item.id === "promise");
  assert.ok(topic, "Promise topic must reuse its existing learning-map node");
  const lessons = await import("node:fs/promises").then(module =>
    module.readdir(new URL("../knowledge/promise", import.meta.url))
  );
  const lessonDirectories = lessons.filter(name => /^lesson-\d{2}$/.test(name));
  assert.equal(lessonDirectories.length, 20);
  for (const directory of lessonDirectories) {
    const html = await readFile(new URL("../knowledge/promise/" + directory + "/index.html", import.meta.url), "utf8");
    assert.match(html, /learning-integration\.mjs/, directory);
    assert.match(html, /id="course-references"/, directory + " reference section");
    const markdown = await readFile(new URL("../knowledge/promise/" + directory + "/index.md", import.meta.url), "utf8");
    assert.match(markdown, /^## 延伸参考$/m, directory + " markdown references");
  }
  const lesson18Markdown = await readFile(new URL("../knowledge/promise/lesson-18/index.md", import.meta.url), "utf8");
  const lesson18Html = await readFile(new URL("../knowledge/promise/lesson-18/index.html", import.meta.url), "utf8");
  for (const marker of ["source reaction", "nested microtask", "await downstream"]) {
    assert.ok(lesson18Markdown.includes(marker), "lesson 18 markdown: " + marker);
    assert.ok(lesson18Html.includes(marker), "lesson 18 HTML: " + marker);
  }
  for (const competency of topic.competencies) {
    const route = (competency.lessonHref.startsWith("./") ? competency.lessonHref.slice(2) : competency.lessonHref) + "index.html";
    const html = await readFile(new URL("../" + route, import.meta.url), "utf8");
    assert.match(html, /learning-integration\.mjs/, competency.id);
  }
});

test("review workspace explains local-first storage and authorized cloud sync", async () => {
  const html = await readFile(new URL("../review/index.html", import.meta.url), "utf8");
  assert.match(html, /本地优先/);
  assert.match(html, /本机 IndexedDB/);
  assert.match(html, /同步到云端档案/);
  assert.doesNotMatch(html, /仅本机/);
});
