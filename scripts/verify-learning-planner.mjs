import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { beforeEach } from "node:test";
import { deleteLocalDatabaseForTests } from "../assets/js/backend/local-event-store.mjs";
import { resetLearningRepositoryForTests } from "../assets/js/backend/learning-repository.mjs";

beforeEach(async () => {
  resetLearningRepositoryForTests();
  await deleteLocalDatabaseForTests();
});
import {
  buildAdaptiveLearningPlan,
  createLearningPlanPreferencesStore,
  recordLearningPlanAction,
} from "../assets/js/learning-planner.mjs";
import { createLearningProgressStore, deriveLearningInsights } from "../assets/js/learning-progress.mjs";
import { mapPlanActionToTask } from "../assets/js/learning-agent/task-orchestrator.mjs";

const readJSON = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const NOW = new Date("2026-11-01T12:00:00.000Z");

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
    values,
  };
}
async function fixtures() {
  const [learningMap, challengeRegistry, worksManifest, checkpointRegistry] = await Promise.all([
    readJSON("../content/learning-map.json"),
    readJSON("../content/challenges.json"),
    readJSON("../content/works.json"),
    readJSON("../content/learning-checkpoints.json"),
  ]);
  return { learningMap, challengeRegistry, worksManifest, checkpointRegistry };
}
function plan(f, snapshot = { events: [] }, preferences = { dailyMinutes: 25, focusTopicId: "all" }, now = NOW) {
  return buildAdaptiveLearningPlan({ ...f, snapshot, preferences, now });
}
function evidence({ id, competencyId, at = "2026-10-20T10:00:00.000Z", scorePct = 90, variantId = "variant-a", challengeId = "sample", stepId = "step" } = {}) {
  return {
    id, type: "assessment_passed", at, topicId: competencyId.startsWith("build-") ? "monorepo" : competencyId.startsWith("rn-") ? "react-native" : "promise",
    challengeId, challengeTitle: challengeId, stepId, stepTitle: stepId,
    competencyIds: [competencyId], sessionId: "session-" + id, sessionType: "checkpoint",
    variantId, scorePct, hintsUsed: 0,
  };
}

test("an empty profile starts with prerequisite roots, not advanced topics", async () => {
  const f = await fixtures();
  const result = plan(f);
  assert.ok(result.actions.length > 0);
  assert.ok(result.plannedMinutes <= 25);
  const rootCompetencies = new Set(f.learningMap.topics.flatMap(topic =>
    topic.competencies.filter(item => !item.prerequisites?.length).map(item => item.id)));
  assert.equal(rootCompetencies.size, 16);
  assert.ok(rootCompetencies.has("agent-architecture-selection"));
  assert.ok(result.actions.every(item => rootCompetencies.has(item.competencyId)),
    "An empty profile must only schedule prerequisite roots");
  assert.ok(result.actions.every(item => item.type === "learn"));
  assert.ok(result.blockedCompetencies.some(item => item.competencyId === "integrated-execution-model"));
  assert.ok(result.blockedCompetencies.some(item => item.competencyId === "rn-integrated-architecture"));
  assert.match(result.headline, /基础/);
});

test("the daily time budget limits the plan and focus preferences change ordering", async () => {
  const f = await fixtures();
  const short = plan(f, { events: [] }, { dailyMinutes: 15, focusTopicId: "all" });
  const focused = plan(f, { events: [] }, { dailyMinutes: 25, focusTopicId: "monorepo" });
  assert.equal(short.actions.length, 1);
  assert.ok(short.plannedMinutes <= 15);
  assert.equal(focused.actions[0].topicId, "monorepo");
  assert.ok(focused.actions.every(item => item.estimatedMinutes > 0));
});

test("an unresolved gap outranks new learning and routes to that exact review", async () => {
  const f = await fixtures();
  const snapshot = { events: [{
    id: "wrong-get-call", type: "attempt", at: "2026-11-01T09:00:00.000Z",
    topicId: "promise", challengeId: "promise-mechanism-quest", challengeTitle: "时序裂隙",
    stepId: "thenable-adoption", stepTitle: "Thenable", competencyIds: ["thenable-adoption"],
    sessionId: "campaign-1", sessionType: "campaign", variantId: "promise-mechanism-quest:thenable-adoption",
    correct: false, gapId: "thenable-get-vs-call", hintsUsed: 0,
  }] };
  const result = plan(f, snapshot);
  assert.equal(result.actions[0].type, "repair");
  assert.equal(result.actions[0].competencyId, "thenable-adoption");
  assert.equal(result.actions[0].gapId, "thenable-get-vs-call");
  assert.match(result.actions[0].href, /gapId=thenable-get-vs-call/);
  assert.ok(result.actions[0].priorityReasons.some(reason => reason.includes("误区")));
});

test("a prerequisite with initial evidence unlocks the next node; its descendants remain gated", async () => {
  const f = await fixtures();
  const snapshot = { events: [evidence({
    id: "workspace-pass", competencyId: "workspace-resolution",
    variantId: "monorepo-dependency-quest:workspace-protocol",
    challengeId: "monorepo-dependency-quest", stepId: "workspace-protocol",
  })] };
  const result = plan(f, snapshot, { dailyMinutes: 40, focusTopicId: "monorepo" });
  assert.ok(result.actions.some(item => item.competencyId === "build-topology" && item.type === "learn"));
  assert.ok(result.blockedCompetencies.some(item => item.competencyId === "affected-closure"));
  assert.ok(result.blockedCompetencies.some(item => item.competencyId === "build-cache-integrity"));
});

test("React Native prerequisite evidence unlocks JSI while TurboModules and Fabric remain gated", async () => {
  const f = await fixtures();
  const snapshot = { events: [evidence({
    id: "rn-build-pass",
    competencyId: "rn-build-artifacts",
    variantId: "rn-architecture-quest:build-artifacts",
    challengeId: "rn-architecture-quest",
    stepId: "build-artifacts",
  })] };
  const result = plan(f, snapshot, { dailyMinutes: 40, focusTopicId: "react-native" });
  assert.ok(result.actions.some(item => item.competencyId === "rn-jsi-boundaries" && item.type === "learn"));
  assert.ok(result.blockedCompetencies.some(item => item.competencyId === "rn-turbomodules-codegen"));
  assert.ok(result.blockedCompetencies.some(item => item.competencyId === "rn-fabric-render-pipeline"));
  assert.ok(result.blockedCompetencies.some(item => item.competencyId === "rn-integrated-architecture"));
});

test("prerequisite gating checks the entire ancestor chain, not only the direct parent", async () => {
  const f = await fixtures();
  const snapshot = { events: [
    evidence({ id: "microtask-pass", competencyId: "microtask-scheduling", variantId: "cp-microtask-queue" }),
    evidence({ id: "chain-pass", competencyId: "chain-error-propagation", variantId: "promise-mechanism-quest:chain-error-recovery" }),
  ] };
  const result = plan(f, snapshot);
  const blocked = result.blockedCompetencies.find(item => item.competencyId === "chain-error-propagation");
  assert.ok(blocked);
  assert.ok(blocked.blockedBy.includes("thenable 解析与 Promise 采用"));
  assert.ok(!result.actions.some(item => item.competencyId === "chain-error-propagation"));
});

test("a calibrated stretch strategy schedules a new independent transfer variant for stable knowledge", async () => {
  const f = await fixtures();
  const snapshot = { events: [40, 28, 16, 5].map((days, index) => evidence({
    id: "stretch-" + index,
    competencyId: "thenable-adoption",
    at: new Date(NOW.getTime() - days * 86_400_000).toISOString(),
    variantId: "previous-variant-" + index,
  })) };
  const result = buildAdaptiveLearningPlan({
    ...f, snapshot, preferences: { dailyMinutes: 60, focusTopicId: "all" }, now: NOW,
    strategyProfile: {
      mode: "adaptive", active: true, profileRevision: 2,
      recommendation: { difficulty: "stretch", intervention: "transfer-challenge" },
      lastDecision: {
        decisionId: "stretch-decision",
        evidenceRefs: ["stretch-0", "stretch-1", "stretch-2", "stretch-3"],
      },
    },
  });
  const action = result.actions.find(item => item.competencyId === "thenable-adoption");
  assert.ok(action, "a stable competency should receive an unused transfer action");
  assert.equal(action.type, "validate");
  assert.equal(action.difficultyLevel, "stretch");
  assert.equal(action.learningIntervention, "transfer-challenge");
  assert.equal(action.strategyDecisionId, "stretch-decision");
  assert.match(action.strategyInstruction, /未见过|迁移/);
  assert.ok(!snapshot.events.some(item => item.variantId === action.variantId));
});

test("a scaffold strategy preserves urgent gap repair and adds a foundation companion action", async () => {
  const f = await fixtures();
  const snapshot = { events: [{
    id: "scaffold-gap",
    type: "attempt",
    at: "2026-11-01T09:00:00.000Z",
    topicId: "promise",
    challengeId: "promise-mechanism-quest",
    challengeTitle: "时序裂隙",
    stepId: "thenable-adoption",
    stepTitle: "Thenable",
    competencyIds: ["thenable-adoption"],
    sessionId: "scaffold-session",
    sessionType: "campaign",
    variantId: "failed-variant",
    correct: false,
    gapId: "thenable-get-vs-call",
    hintsUsed: 0,
  }] };
  const result = buildAdaptiveLearningPlan({
    ...f, snapshot, preferences: { dailyMinutes: 60, focusTopicId: "all" }, now: NOW,
    strategyProfile: {
      mode: "adaptive", active: true, profileRevision: 3,
      recommendation: { difficulty: "scaffold", intervention: "guided-retrieval" },
      lastDecision: { decisionId: "scaffold-decision", evidenceRefs: ["scaffold-gap"] },
    },
  });
  const sameCompetency = result.actions.filter(item => item.competencyId === "thenable-adoption");
  assert.equal(sameCompetency[0]?.type, "repair");
  assert.ok(sameCompetency.some(item => item.type === "learn" && item.strategyCompanion === true));
  assert.ok(sameCompetency.every(item => item.difficultyLevel === "scaffold"));
  assert.ok(sameCompetency.every(item => item.strategyDecisionId === "scaffold-decision"));
});

test("an overdue competency is scheduled for review before new learning", async () => {
  const f = await fixtures();
  const snapshot = { events: [evidence({
    id: "old-pass", competencyId: "thenable-adoption",
    at: "2026-09-01T10:00:00.000Z", variantId: "cp-promise-identity",
  })] };
  const result = plan(f, snapshot);
  assert.equal(result.actions[0].type, "review");
  assert.equal(result.actions[0].competencyId, "thenable-adoption");
  assert.match(result.actions[0].href, /review\/\?competencyId=thenable-adoption/);
});

test("finishing a foundation step advances to practice without creating mastery evidence", async () => {
  const f = await fixtures();
  const store = createLearningProgressStore();
  const initial = plan(f, await store.load(), { dailyMinutes: 40, focusTopicId: "all" });
  const lesson = initial.actions.find(item => item.competencyId === "thenable-adoption");
  assert.ok(lesson);
  assert.equal(lesson.type, "learn");
  await recordLearningPlanAction(store, lesson, "completed", { at: NOW });
  const next = plan(f, await store.load(), { dailyMinutes: 40, focusTopicId: "all" });
  const action = next.actions.find(item => item.competencyId === "thenable-adoption");
  assert.ok(action);
  assert.equal(action.type, "practice");
  assert.equal(action.resourceType, "checkpoint");
  const mastery = deriveLearningInsights(f.learningMap, f.challengeRegistry, await store.load(), NOW)
    .competencyInsights.find(item => item.id === "thenable-adoption");
  assert.equal(mastery.evidenceCount, 0);
  assert.equal(mastery.masteryScore, null);
});

test("foundation completion persists across days but never becomes mastery evidence", async () => {
  const f = await fixtures();
  const store = createLearningProgressStore();
  const initial = plan(f, await store.load());
  const lesson = initial.actions.find(item => item.competencyId === "thenable-adoption");
  await recordLearningPlanAction(store, lesson, "completed", { at: NOW });
  const tomorrow = plan(f, await store.load(), { dailyMinutes: 25, focusTopicId: "all" }, new Date("2026-11-02T12:00:00.000Z"));
  const nextStep = tomorrow.actions.find(item => item.competencyId === "thenable-adoption");
  assert.ok(nextStep);
  assert.equal(nextStep.type, "practice");
  const state = deriveLearningInsights(f.learningMap, f.challengeRegistry, await store.load(), NOW)
    .competencyInsights.find(item => item.id === "thenable-adoption");
  assert.equal(state.evidenceCount, 0);
});

test("completed action time is deducted from the same day's budget", async () => {
  const f = await fixtures();
  const store = createLearningProgressStore();
  const preferences = { dailyMinutes: 15, focusTopicId: "all" };
  const initial = plan(f, await store.load(), preferences);
  const lesson = initial.actions[0];
  assert.equal(lesson.estimatedMinutes, 12);
  await recordLearningPlanAction(store, lesson, "completed", { at: NOW });
  const after = plan(f, await store.load(), preferences);
  assert.equal(after.completedMinutesToday, 12);
  assert.equal(after.remainingMinutes, 3);
  assert.equal(after.actions.length, 0, "a 15-minute plan must not schedule another 12-minute task after 12 minutes were used");
  assert.ok(after.plannedMinutes + after.completedMinutesToday <= 15);
});

test("started and completed plan steps are idempotent and do not count as assessment evidence", async () => {
  const f = await fixtures();
  const store = createLearningProgressStore();
  const action = plan(f, await store.load()).actions[0];
  await recordLearningPlanAction(store, action, "started", { at: NOW });
  await recordLearningPlanAction(store, action, "started", { at: NOW });
  await recordLearningPlanAction(store, action, "completed", { at: NOW });
  await recordLearningPlanAction(store, action, "completed", { at: NOW });
  const events = (await store.load()).events;
  assert.equal(events.filter(item => item.type === "plan_action_started").length, 1);
  assert.equal(events.filter(item => item.type === "plan_action_completed").length, 1);
  const result = plan(f, await store.load());
  assert.equal(result.completedTodayCount, 1);
  assert.ok(!result.actions.some(item => item.actionId === action.actionId));
  const insights = deriveLearningInsights(f.learningMap, f.challengeRegistry, await store.load(), NOW);
  assert.equal(insights.summary.testedCount, 0);
});

test("preferences are validated and persisted independently of the learning event log", async () => {
  const preferences = createLearningPlanPreferencesStore();
  assert.deepEqual(await preferences.load(), { dailyMinutes: 25, focusTopicId: "all" });
  assert.equal(await preferences.save({ dailyMinutes: 40, focusTopicId: "promise" }), true);
  assert.deepEqual(await preferences.load(), { dailyMinutes: 40, focusTopicId: "promise" });
  assert.deepEqual(
    await createLearningPlanPreferencesStore().load(),
    { dailyMinutes: 40, focusTopicId: "promise" }
  );
});

test("a used challenge step is not recommended again as a fake independent variant", async () => {
  const f = await fixtures();
  const snapshot = { events: [
    evidence({ id: "adoption-pass", competencyId: "thenable-adoption", variantId: "cp-promise-identity" }),
    evidence({ id: "microtask-pass", competencyId: "microtask-scheduling", variantId: "cp-microtask-queue" }),
    evidence({
      id: "chain-pass", competencyId: "chain-error-propagation",
      variantId: "promise-mechanism-quest:chain-error-recovery",
      challengeId: "promise-mechanism-quest", stepId: "chain-error-recovery",
    }),
  ] };
  const result = plan(f, snapshot);
  assert.ok(!result.actions.some(item => item.competencyId === "chain-error-propagation" && item.type === "validate"));
});


test("new content-only topics now progress from reading to a real independent assessment task", async () => {
  const f = await fixtures();
  const topic = f.learningMap.topics.find(item => item.id === "ai-education");
  assert.ok(topic?.competencies?.length >= 2);
  const competency = topic.competencies.find(item => item.id === "multimodal-learning-architecture");
  assert.ok(competency?.assessmentHref);
  const store = createLearningProgressStore();
  const prefs = { dailyMinutes: 60, focusTopicId: "ai-education" };
  const first = plan(f, await store.load(), prefs);
  const lesson = first.actions.find(item => item.competencyId === competency.id);
  assert.equal(lesson?.type, "learn");
  await recordLearningPlanAction(store, lesson, "completed", { at: NOW });
  const next = plan(f, await store.load(), prefs);
  const assessment = next.actions.find(item => item.competencyId === competency.id);
  assert.equal(assessment?.type, "practice");
  assert.equal(assessment?.resourceType, "assessment");
  assert.match(assessment.href, /review\/\?competencyId=multimodal-learning-architecture/);
  const task = mapPlanActionToTask(assessment, "plan-ai-education");
  assert.equal(task.taskType, "assessment");
  assert.equal(task.evidencePolicy, "required_assessment");
  assert.match(task.href, /taskId=/);
  assert.match(task.href, /competencyId=multimodal-learning-architecture/);
});
