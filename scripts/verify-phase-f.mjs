import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { beforeEach } from "node:test";
import { deleteLocalDatabaseForTests } from "../assets/js/backend/local-event-store.mjs";
import { getLearningRepository, resetLearningRepositoryForTests } from "../assets/js/backend/learning-repository.mjs";
import { createLearnerProfileStore } from "../assets/js/learning-agent/learner-profile.mjs";
import { createLearningGoalManager } from "../assets/js/learning-agent/goal-manager.mjs";
import { createLearningTaskOrchestrator } from "../assets/js/learning-agent/task-orchestrator.mjs";
import { createProactiveLearningEngine } from "../assets/js/proactive-learning-engine.mjs";
import { calculateReviewSchedule } from "../assets/js/spaced-repetition-engine.mjs";
import {
  analyzeWeaknessTrends, deriveForgettingRisks, diagnoseLearningState, forecastLearningGoals,
} from "../assets/js/learning-risk-engine.mjs";
import { rankNextBestActions } from "../assets/js/next-best-action.mjs";

const NOW = new Date("2026-11-03T10:00:00.000Z");
const DAY_MS = 86_400_000;
const iso = value => new Date(value).toISOString();
const daysAgo = days => iso(NOW.getTime() - days * 86_400_000);
const map = {
  topics: [{ id: "promise", title: "Promise", competencies: [
    { id: "parent", title: "先修基础", prerequisites: [], lessonHref: "./knowledge/promise/" },
    { id: "child", title: "下游能力", prerequisites: ["parent"], lessonHref: "./knowledge/promise/" },
  ] }],
};
function event(id, type, at, overrides = {}) {
  return {
    id, type, at,
    topicId: "promise", challengeId: "test-challenge", challengeTitle: "测试挑战",
    stepId: "step-one", stepTitle: "测试能力",
    competencyIds: ["parent"], sessionId: id, sessionType: "checkpoint",
    variantId: "variant-" + id, hintsUsed: 0, attempts: 1,
    ...overrides,
  };
}

beforeEach(async () => {
  resetLearningRepositoryForTests();
  await deleteLocalDatabaseForTests();
});

test("spaced repetition groups attempts by session, applies hint/retry penalties and schedules from evidence time", () => {
  const clean = [
    event("clean-attempt", "attempt", daysAgo(4), { correct: true, attempts: 1 }),
    event("clean-pass", "assessment_passed", daysAgo(4), { scorePct: 95, independent: true }),
  ];
  const schedule = calculateReviewSchedule({
    competencyId: "parent", events: clean, intelligence: { status: "initial", activeGaps: [] }, now: NOW,
  });
  assert.equal(schedule.successfulReviewCount, 1);
  assert.equal(schedule.intervalDays, 3);
  assert.equal(schedule.status, "due");
  assert.equal(schedule.dueAt, iso(new Date(daysAgo(4)).getTime() + 3 * 86_400_000));
  assert.equal(schedule.confidence, "low");

  const assisted = [
    event("hint", "hint_revealed", daysAgo(1), { hintNumber: 1, hintsUsed: 1 }),
    event("assisted-attempt", "attempt", daysAgo(1), { correct: true, attempts: 1, hintsUsed: 1 }),
    event("assisted-pass", "assessment_passed", daysAgo(1), {
      scorePct: 100, attempts: 1, hintsUsed: 1, independent: false,
    }),
  ];
  const assistedSchedule = calculateReviewSchedule({
    competencyId: "parent", events: assisted,
    intelligence: { status: "initial", activeGaps: [] }, now: NOW,
  });
  assert.equal(assistedSchedule.latestQuality, 3);
  assert.equal(assistedSchedule.intervalDays, 1);

  const failed = [event("failed-attempt", "attempt", NOW.toISOString(), {
    correct: false, gapId: "gap-parent", sessionType: "challenge",
  })];
  const failedSchedule = calculateReviewSchedule({
    competencyId: "parent", events: failed,
    intelligence: { status: "weak", activeGaps: [] }, now: NOW,
  });
  assert.equal(failedSchedule.status, "learning");
  assert.equal(failedSchedule.isDue, false);
  assert.equal(failedSchedule.dueAt, iso(NOW.getTime() + 86_400_000));
});

test("stable review status needs multiple independent dates, variants and authoritative stable mastery", () => {
  const events = [
    event("pass-a", "assessment_passed", daysAgo(30), { scorePct: 98, variantId: "a", independent: true }),
    event("pass-b", "assessment_passed", daysAgo(20), { scorePct: 98, variantId: "b", independent: true }),
    event("pass-c", "assessment_passed", daysAgo(10), { scorePct: 98, variantId: "c", independent: true }),
  ];
  const result = calculateReviewSchedule({
    competencyId: "parent", events, intelligence: { status: "stable", activeGaps: [] }, now: NOW,
  });
  assert.equal(result.independentReviewCount, 3);
  assert.equal(result.status, "stable");
  assert.ok(Date.parse(result.dueAt) > NOW.getTime());
  const futureEvents = events.map((item, index) => ({ ...item, at: iso(NOW.getTime() - (3-index)*DAY_MS) }));
  const stable = calculateReviewSchedule({
    competencyId: "parent", events: futureEvents,
    intelligence: { status: "stable", activeGaps: [] }, now: NOW,
  });
  assert.equal(stable.status, "stable");
});

test("forgetting risk includes overdue interval, active gaps and prerequisite propagation", () => {
  const schedules = [
    { competencyId: "parent", status: "overdue", intervalDays: 2, elapsedDays: 9,
      overdueDays: 7, isDue: true, consecutiveFailures: 2, activeGapIds: ["gap-1"],
      confidence: "low", evidenceRefs: ["wrong-1"] },
    { competencyId: "child", status: "scheduled", intervalDays: 14, elapsedDays: 2,
      overdueDays: 0, isDue: false, consecutiveFailures: 0, activeGapIds: [],
      confidence: "medium", evidenceRefs: ["pass-1"] },
  ];
  const insights = { competencyInsights: [
    { id: "parent", status: "weak", masteryScore: 35, activeGaps: [{ id: "gap-1" }] },
    { id: "child", status: "initial", masteryScore: 72, activeGaps: [] },
  ] };
  const risks = deriveForgettingRisks({ schedules, insights, learningMap: map, now: NOW });
  assert.equal(risks.find(item => item.competencyId === "parent").level, "critical");
  assert.deepEqual(risks.find(item => item.competencyId === "child").prerequisiteRiskIds, ["parent"]);
  assert.ok(risks.find(item => item.competencyId === "parent").reasons.length);
});

test("weakness trend is derived from recent assessment events, not browsing or agent activity", () => {
  const events = [
    event("old-a", "assessment_passed", daysAgo(30), { scorePct: 40 }),
    event("old-b", "assessment_passed", daysAgo(25), { scorePct: 45 }),
    event("old-c", "assessment_passed", daysAgo(20), { scorePct: 50 }),
    event("new-a", "assessment_passed", daysAgo(4), { scorePct: 85 }),
    event("new-b", "assessment_passed", daysAgo(2), { scorePct: 92 }),
    event("new-c", "assessment_passed", daysAgo(1), { scorePct: 98 }),
    event("page-view", "page_viewed", daysAgo(0.5), { scorePct: 100 }),
  ];
  const result = analyzeWeaknessTrends({
    events, learningMap: map,
    insights: { competencyInsights: [{ id: "parent", status: "initial", activeGaps: [] }] },
    now: NOW,
  });
  assert.equal(result[0].direction, "improving");
  assert.equal(result[0].delta, 46.7);
  assert.ok(!result[0].evidenceRefs.includes("page-view"));
});

test("diagnostics detect stagnation, repeated gap failures, backlog, overload and hint dependence", () => {
  const events = [
    event("old-evidence", "assessment_passed", daysAgo(20), { scorePct: 55 }),
    ...Array.from({ length: 5 }, (_, index) => event("hinted-" + index, "attempt", daysAgo(index+1), {
      correct: false, hintsUsed: 1, gapId: "gap-x",
    })),
  ];
  const schedules = Array.from({ length: 5 }, (_, index) => ({
    competencyId: "node-" + index, status: "overdue", activeGapIds: [], evidenceRefs: [],
  }));
  const tasks = Array.from({ length: 4 }, (_, index) => ({
    taskId: "task-" + index, status: "ready", estimatedMinutes: 40,
  }));
  const diagnostics = diagnoseLearningState({
    events, goals: [{ goalId: "goal-1", title: "Promise", status: "active" }],
    tasks, schedules, risks: [], trends: [], insights: {
      goalProgress: [], competencyInsights: [
        { id: "parent", status: "weak", activeGaps: [{ id: "gap-x" }] },
      ],
    },
    preferences: { dailyMinutes: 20 }, now: NOW,
  });
  const ids = new Set(diagnostics.map(item => item.id.split(":")[0]));
  for (const id of ["repeated-failure", "review-backlog", "learning-overload", "hint-dependency"]) {
    assert.ok(ids.has(id), "expected diagnostic " + id);
  }
  const stagnant = diagnoseLearningState({
    events: [event("stale", "assessment_passed", daysAgo(20), { scorePct: 60 })],
    goals: [{ goalId: "goal-2", title: "Stale goal", status: "active" }],
    tasks: [], schedules: [], risks: [], trends: [], insights: { goalProgress: [] }, now: NOW,
  });
  assert.ok(stagnant.some(item => item.id === "learning-stagnation"));
});

test("goal forecast returns a range with explicit assumptions and blockers", () => {
  const goal = { goalId: "goal-1", title: "Promise mastery", status: "active", topicIds: ["promise"], competencyIds: [] };
  const insights = { competencyInsights: [
    { id: "parent", status: "stable", masteryScore: 95, activeGaps: [] },
    { id: "child", status: "weak", masteryScore: 52, activeGaps: [{ id: "gap-child" }], prerequisites: ["parent"] },
  ] };
  const schedules = [{ competencyId: "child", status: "new", confidence: "low", evidenceRefs: [] }];
  const forecast = forecastLearningGoals({
    goals: [goal], learningMap: map, schedules, insights, events: [],
    preferences: { dailyMinutes: 20, weeklyDays: 5 }, now: NOW,
  })[0];
  assert.equal(forecast.progress, 50);
  assert.equal(forecast.remainingMinutesEstimate, 12);
  assert.equal(forecast.confidence, "low");
  assert.ok(Date.parse(forecast.latestDate) > Date.parse(forecast.earliestDate));
  assert.ok(forecast.variables.length >= 2);
  assert.equal(forecast.milestones.length, 1);
  assert.equal(forecast.milestones[0].title, "Promise");
  assert.equal(forecast.milestones[0].status, "blocked");
  assert.equal(forecast.milestones[0].progress, 50);
});

test("Next Best Action sorts review risk above a new lesson and exposes evidence and execution route", () => {
  const learningMap = { topics: [{ id: "promise", title: "Promise", competencies: [
    { id: "due-node", title: "Due knowledge", prerequisites: [], lessonHref: "./knowledge/promise/" },
    { id: "new-node", title: "New knowledge", prerequisites: [], lessonHref: "./knowledge/promise/" },
  ] }] };
  const insights = { competencyInsights: [
    { id: "due-node", status: "initial", activeGaps: [] },
    { id: "new-node", status: "unverified", activeGaps: [] },
  ] };
  const actions = rankNextBestActions({
    learningMap, insights,
    schedules: [
      { competencyId: "due-node", status: "overdue", isDue: true, overdueDays: 5, confidence: "medium", evidenceRefs: ["event-1"] },
      { competencyId: "new-node", status: "new", isDue: false, confidence: "low", evidenceRefs: [] },
    ],
    risks: [{ competencyId: "due-node", level: "high", downstreamCount: 1, reasons: ["超过复习间隔"] }],
    now: NOW,
  });
  assert.equal(actions[0].competencyId, "due-node");
  assert.equal(actions[0].type, "spaced-review");
  assert.deepEqual(actions[0].evidenceRefs, ["event-1"]);
  assert.ok(actions[0].href.startsWith("./review/"));
  assert.ok(actions.find(item => item.competencyId === "new-node"));

  const queued = rankNextBestActions({
    learningMap,
    insights,
    schedules: [
      { competencyId: "due-node", status: "overdue", isDue: true, overdueDays: 5,
        confidence: "medium", evidenceRefs: ["event-1"] },
    ],
    risks: [{ competencyId: "due-node", level: "critical", downstreamCount: 2,
      reasons: ["存在持续失败"] }],
    tasks: [{ taskId: "due-task", competencyId: "due-node", topicId: "promise",
      title: "间隔复习任务", status: "ready", estimatedMinutes: 8,
      href: "./review/?competencyId=due-node&taskId=due-task" }],
    now: NOW,
  });
  assert.equal(queued[0].taskId, "due-task");
  assert.ok(queued[0].score >= 80, "an executable review task must inherit current risk urgency");
 });

test("Repository-backed proactive engine creates idempotent due tasks and stores rebuildable projection", async () => {
  const [learningMap, challengeRegistry] = await Promise.all([
    readFile(new URL("../content/learning-map.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../content/challenges.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const repository = await getLearningRepository();
  const profileStore = createLearnerProfileStore({ repository });
  const goalManager = createLearningGoalManager({ repository, learningMap });
  const taskOrchestrator = createLearningTaskOrchestrator({ repository });
  const competencyId = "thenable-adoption";
  const topicId = "promise";
  const past = daysAgo(10);
  await repository.events.append([event("initial-pass", "assessment_passed", past, {
    topicId, competencyIds: [competencyId], sessionId: "old-session",
    sessionType: "checkpoint", variantId: "checkpoint-thenable-a",
    scorePct: 92, independent: true, attempts: 1, hintsUsed: 0,
    challengeId: "promise-quest", stepId: "thenable",
  })]);
  const engine = createProactiveLearningEngine({
    repository, learningMap, challengeRegistry, goalManager, taskOrchestrator, profileStore,
  });
  const first = await engine.refresh({ now: NOW });
  assert.equal(first.schemaVersion, 3);
  assert.ok(Array.isArray(first.timeline));
  assert.ok(first.timeline.some(item => item.type === "assessment_passed"));
  assert.ok(first.sourceFingerprint);
  assert.ok(first.schedules.find(item => item.competencyId === competencyId).isDue);
  const generated = await taskOrchestrator.list();
  const dueTasks = generated.filter(item => item.proactiveGenerated && item.competencyId === competencyId);
  assert.equal(dueTasks.length, 1);
  assert.equal(dueTasks[0].taskType, "assessment");
  assert.equal(dueTasks[0].status, "ready");
  assert.ok(dueTasks[0].href.includes("taskId="));

  const second = await engine.refresh({ now: NOW });
  assert.equal(second.cacheHit, true);
  assert.equal((await taskOrchestrator.list()).filter(item => item.proactiveGenerated).length, 1);
  const stored = await repository.documents.get("proactive_learning_projection", "current");
  assert.equal(stored.payload.sourceFingerprint, second.sourceFingerprint);
  assert.equal(stored.payload.algorithmVersions.spacedRepetition, 2);
  assert.equal(stored.payload.engineVersion, 3);
  assert.ok(stored.payload.timeline.length > 0);

  const startedAt = iso(NOW.getTime() + 60_000);
  const started = await taskOrchestrator.start(dueTasks[0].taskId, { at: startedAt });
  assert.equal(started.status, "in_progress");
  await repository.events.append([event("new-valid-pass", "assessment_passed", iso(NOW.getTime() + 120_000), {
    taskId: dueTasks[0].taskId, topicId, competencyIds: [competencyId], sessionId: "new-session",
    sessionType: "review", variantId: "review-variant-z",
    scorePct: 95, independent: true, attempts: 1, hintsUsed: 0,
    challengeId: "review", stepId: "thenable-adoption",
  })]);
  const completed = await taskOrchestrator.complete(dueTasks[0].taskId, {
    at: iso(NOW.getTime() + 180_000),
  });
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.evidenceEventIds, ["new-valid-pass"]);
  assert.ok((await repository.events.list()).some(item => item.type === "learning_task_completed"));
});

test("projection cache re-evaluates when a scheduled review crosses its due instant within the same hour", async () => {
  const [learningMap, challengeRegistry] = await Promise.all([
    readFile(new URL("../content/learning-map.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../content/challenges.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const repository = await getLearningRepository();
  const profileStore = createLearnerProfileStore({ repository });
  const goalManager = createLearningGoalManager({ repository, learningMap });
  const taskOrchestrator = createLearningTaskOrchestrator({ repository });
  const eventAt = iso(NOW.getTime() - 3 * DAY_MS + 60_000);
  await repository.events.append([event("near-due", "assessment_passed", eventAt, {
    topicId: "promise", competencyIds: ["thenable-adoption"], sessionId: "near-due-session",
    sessionType: "checkpoint", variantId: "near-due-variant", scorePct: 98,
    attempts: 1, hintsUsed: 0, independent: true,
    challengeId: "promise-mechanism-quest", stepId: "thenable-adoption",
  })]);
  const engine = createProactiveLearningEngine({
    repository, learningMap, challengeRegistry, goalManager, taskOrchestrator, profileStore,
  });
  const before = await engine.refresh({ now: NOW });
  assert.equal(before.schedules.find(item => item.competencyId === "thenable-adoption").isDue, false);
  assert.equal((await taskOrchestrator.list()).filter(item => item.proactiveGenerated).length, 0);
  const after = await engine.refresh({ now: new Date(NOW.getTime() + 2 * 60_000) });
  assert.ok(after.schedules.find(item => item.competencyId === "thenable-adoption").isDue);
  assert.equal((await taskOrchestrator.list()).filter(item => item.proactiveGenerated).length, 1);
});


test("gap review task deduplicates by open evidence set and preserves skipped history", async () => {
  const repository = await getLearningRepository();
  const orchestrator = createLearningTaskOrchestrator({ repository });
  const input = {
    competencyId: "parent", competencyTitle: "先修基础", topicId: "promise", topicTitle: "Promise",
    gapId: "gap-parent", gapLabel: "先修概念错误", dueAt: NOW.toISOString(),
    scheduleStatus: "relearning", evidenceRefs: ["failure-a", "failure-b"], at: NOW,
  };
  const first = await orchestrator.ensureScheduledReviewTask(input);
  assert.equal(first.taskType, "review");
  await orchestrator.skip(first.taskId, { reason: "今天时间不足，主动延期" });
  const repeated = await orchestrator.ensureScheduledReviewTask({
    ...input, dueAt: iso(NOW.getTime() + 6 * 60 * 60 * 1000), at: new Date(NOW.getTime() + 6 * 60 * 60 * 1000),
  });
  assert.equal(repeated.taskId, first.taskId);
  assert.equal(repeated.status, "skipped");
  assert.equal(repeated.lastTransition.reason, "今天时间不足，主动延期");
  const expanded = await orchestrator.ensureScheduledReviewTask({
    ...input, evidenceRefs: ["failure-a", "failure-b", "failure-c"],
    dueAt: iso(NOW.getTime() + 12 * 60 * 60 * 1000), at: new Date(NOW.getTime() + 12 * 60 * 60 * 1000),
  });
  assert.notEqual(expanded.taskId, first.taskId);
  assert.equal(expanded.status, "ready");
});

test("concurrent projection refresh queues a second snapshot instead of losing an event", async () => {
  const [learningMap, challengeRegistry] = await Promise.all([
    readFile(new URL("../content/learning-map.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../content/challenges.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const repository = await getLearningRepository();
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const release = new Promise(resolve => { releaseResolve = resolve; });
  let reads = 0;
  const repositoryProxy = {
    events: {
      list: async () => {
        const snapshot = await repository.events.list();
        reads += 1;
        if (reads === 1) {
          enteredResolve();
          await release;
        }
        return snapshot;
      },
    },
    documents: repository.documents,
    commit: repository.commit.bind(repository),
  };
  const engine = createProactiveLearningEngine({
    repository: repositoryProxy, learningMap, challengeRegistry,
  });
  const firstRefresh = engine.refresh({ now: NOW, createTasks: false, force: true });
  await entered;
  await repository.events.append([event("racing-event", "assessment_passed", NOW.toISOString(), {
    topicId: "promise", competencyIds: ["thenable-adoption"], sessionId: "racing-session",
    sessionType: "checkpoint", variantId: "racing-variant", scorePct: 90,
    attempts: 1, hintsUsed: 0, independent: true,
  })]);
  const overlappingRefresh = engine.refresh({ now: NOW, createTasks: false, force: true });
  releaseResolve();
  const [first, second] = await Promise.all([firstRefresh, overlappingRefresh]);
  assert.equal(first.sourceEventCount, 1);
  assert.equal(second.sourceEventCount, 1);
  assert.ok(reads >= 2, "the queued pass must read events again after the concurrent write");
  assert.ok(second.schedules.find(item => item.competencyId === "thenable-adoption").successfulReviewCount === 1);
});

test("projection CAS conflict performs bounded reread and recomputation before commit", async () => {
  const [learningMap, challengeRegistry] = await Promise.all([
    readFile(new URL("../content/learning-map.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../content/challenges.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const base = await getLearningRepository();
  let injected = false;
  const repository = {
    events: base.events,
    documents: base.documents,
    commit: async change => {
      if (!injected && (change.documents || []).some(item =>
        item.type === "proactive_learning_projection" && item.key === "current")) {
        injected = true;
        await base.commit({
          documents: [{
            type: "proactive_learning_projection",
            key: "current",
            expectedLocalRevision: 0,
            payload: {
              schemaVersion: 3, engineVersion: 3,
              algorithmVersions: { spacedRepetition: 2, risk: 1, nextBestAction: 1, learningStrategy: 1 },
              sourceFingerprint: "concurrent-device-projection",
              sourceEventCount: 0, latestEvidenceAt: null, computedAt: NOW.toISOString(),
              summary: {}, schedules: [], risks: [], trends: [], diagnostics: [],
              goalForecasts: [], nextBestActions: [], timeline: [],
            },
          }],
        });
      }
      return base.commit(change);
    },
  };
  const engine = createProactiveLearningEngine({ repository, learningMap, challengeRegistry });
  const result = await engine.refresh({ now: NOW, createTasks: false, force: true });
  const saved = await base.documents.get("proactive_learning_projection", "current");
  assert.equal(injected, true);
  assert.equal(saved.localRevision, 2);
  assert.equal(saved.payload.sourceFingerprint, result.sourceFingerprint);
  assert.notEqual(saved.payload.sourceFingerprint, "concurrent-device-projection");
});
