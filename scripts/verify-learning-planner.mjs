import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildAdaptiveLearningPlan,
  createLearningPlanPreferencesStore,
  recordLearningPlanAction,
} from "../assets/js/learning-planner.mjs";
import { createLearningProgressStore, deriveLearningInsights } from "../assets/js/learning-progress.mjs";

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
    id, type: "assessment_passed", at, topicId: competencyId.startsWith("build-") ? "monorepo" : "promise",
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
  assert.deepEqual(new Set(result.actions.map(item => item.competencyId)),
    new Set(["thenable-adoption", "workspace-resolution"]));
  assert.ok(result.actions.every(item => item.type === "learn"));
  assert.ok(result.blockedCompetencies.some(item => item.competencyId === "integrated-execution-model"));
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
  const result = plan(f, snapshot);
  assert.ok(result.actions.some(item => item.competencyId === "build-topology" && item.type === "learn"));
  assert.ok(result.blockedCompetencies.some(item => item.competencyId === "affected-closure"));
  assert.ok(result.blockedCompetencies.some(item => item.competencyId === "build-cache-integrity"));
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
  const storage = memoryStorage();
  const store = createLearningProgressStore({ storage });
  const initial = plan(f, store.load(), { dailyMinutes: 40, focusTopicId: "all" });
  const lesson = initial.actions.find(item => item.competencyId === "thenable-adoption");
  assert.ok(lesson);
  assert.equal(lesson.type, "learn");
  recordLearningPlanAction(store, lesson, "completed", { at: NOW });
  const next = plan(f, store.load(), { dailyMinutes: 40, focusTopicId: "all" });
  const action = next.actions.find(item => item.competencyId === "thenable-adoption");
  assert.ok(action);
  assert.equal(action.type, "practice");
  assert.equal(action.resourceType, "checkpoint");
  const mastery = deriveLearningInsights(f.learningMap, f.challengeRegistry, store.load(), NOW)
    .competencyInsights.find(item => item.id === "thenable-adoption");
  assert.equal(mastery.evidenceCount, 0);
  assert.equal(mastery.masteryScore, null);
});

test("foundation completion persists across days but never becomes mastery evidence", async () => {
  const f = await fixtures();
  const store = createLearningProgressStore({ storage: memoryStorage() });
  const initial = plan(f, store.load());
  const lesson = initial.actions.find(item => item.competencyId === "thenable-adoption");
  recordLearningPlanAction(store, lesson, "completed", { at: NOW });
  const tomorrow = plan(f, store.load(), { dailyMinutes: 25, focusTopicId: "all" }, new Date("2026-11-02T12:00:00.000Z"));
  const nextStep = tomorrow.actions.find(item => item.competencyId === "thenable-adoption");
  assert.ok(nextStep);
  assert.equal(nextStep.type, "practice");
  const state = deriveLearningInsights(f.learningMap, f.challengeRegistry, store.load(), NOW)
    .competencyInsights.find(item => item.id === "thenable-adoption");
  assert.equal(state.evidenceCount, 0);
});

test("completed action time is deducted from the same day's budget", async () => {
  const f = await fixtures();
  const store = createLearningProgressStore({ storage: memoryStorage() });
  const preferences = { dailyMinutes: 15, focusTopicId: "all" };
  const initial = plan(f, store.load(), preferences);
  const lesson = initial.actions[0];
  assert.equal(lesson.estimatedMinutes, 12);
  recordLearningPlanAction(store, lesson, "completed", { at: NOW });
  const after = plan(f, store.load(), preferences);
  assert.equal(after.completedMinutesToday, 12);
  assert.equal(after.remainingMinutes, 3);
  assert.equal(after.actions.length, 0, "a 15-minute plan must not schedule another 12-minute task after 12 minutes were used");
  assert.ok(after.plannedMinutes + after.completedMinutesToday <= 15);
});

test("started and completed plan steps are idempotent and do not count as assessment evidence", async () => {
  const f = await fixtures();
  const storage = memoryStorage();
  const store = createLearningProgressStore({ storage });
  const action = plan(f, store.load()).actions[0];
  recordLearningPlanAction(store, action, "started", { at: NOW });
  recordLearningPlanAction(store, action, "started", { at: NOW });
  recordLearningPlanAction(store, action, "completed", { at: NOW });
  recordLearningPlanAction(store, action, "completed", { at: NOW });
  const events = store.load().events;
  assert.equal(events.filter(item => item.type === "plan_action_started").length, 1);
  assert.equal(events.filter(item => item.type === "plan_action_completed").length, 1);
  const result = plan(f, store.load());
  assert.equal(result.completedTodayCount, 1);
  assert.ok(!result.actions.some(item => item.actionId === action.actionId));
  const insights = deriveLearningInsights(f.learningMap, f.challengeRegistry, store.load(), NOW);
  assert.equal(insights.summary.testedCount, 0);
});

test("preferences are validated and persisted independently of the learning event log", () => {
  const storage = memoryStorage();
  const preferences = createLearningPlanPreferencesStore({ storage });
  assert.deepEqual(preferences.load(), { dailyMinutes: 25, focusTopicId: "all" });
  assert.equal(preferences.save({ dailyMinutes: 40, focusTopicId: "promise" }), true);
  assert.deepEqual(preferences.load(), { dailyMinutes: 40, focusTopicId: "promise" });
  assert.deepEqual(
    createLearningPlanPreferencesStore({ storage: memoryStorage({ "knowverse:learning-plan:preferences:v1": "{broken" }) }).load(),
    { dailyMinutes: 25, focusTopicId: "all" }
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
