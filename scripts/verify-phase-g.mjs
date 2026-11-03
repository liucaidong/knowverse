import assert from "node:assert/strict";
import test from "node:test";
import {
  calibrateLearningStrategy,
  createLearningStrategyEngine,
  evaluateLearningStrategyEffectiveness,
} from "../assets/js/learning-strategy-engine.mjs";
import { calculateReviewSchedule } from "../assets/js/spaced-repetition-engine.mjs";
import { createReviewSessionEngine } from "../assets/js/review-engine.mjs";
import { createLearningTaskOrchestrator } from "../assets/js/learning-agent/task-orchestrator.mjs";

const NOW = new Date("2026-11-03T04:00:00.000Z");
const DAY = 86_400_000;
const atDaysAgo = days => new Date(NOW.getTime() - days * DAY).toISOString();
const event = (id, type, daysAgo, extra = {}) => ({
  id, type, at: atDaysAgo(daysAgo), topicId: "promise",
  challengeId: "phase-g-test", challengeTitle: "Phase G test",
  stepId: id, stepTitle: id, competencyIds: ["thenable-adoption"],
  ...extra,
});
const independentSet = () => [
  event("p1", "assessment_passed", 40, { independent: true, hintsUsed: 0, scorePct: 96, variantId: "v1", sessionType: "checkpoint" }),
  event("p2", "assessment_passed", 28, { independent: true, hintsUsed: 0, scorePct: 94, variantId: "v2", sessionType: "challenge" }),
  event("p3", "assessment_passed", 16, { independent: true, hintsUsed: 0, scorePct: 98, variantId: "v3", sessionType: "challenge" }),
  event("p4", "assessment_passed", 5, { independent: true, hintsUsed: 0, scorePct: 92, variantId: "v1", sessionType: "challenge" }),
];

test("cold start uses behavior only for task-load signals, never as mastery evidence", () => {
  const rows = Array.from({ length: 6 }, (_, index) =>
    event("task-" + index, "learning_task_failed", index + 1, { taskId: "task-" + index }));
  const { profile } = calibrateLearningStrategy({ events: rows, now: NOW });
  assert.equal(profile.personalizationLevel, "emerging");
  assert.equal(profile.active, true);
  assert.equal(profile.evidence.sampleCounts.independent, 0);
  assert.equal(profile.evidence.sampleCounts.ability, 0);
  assert.equal(profile.parameters.difficultyBias, 0);
  assert.equal(profile.parameters.taskLoadMultiplier, 0.95);
  assert.equal(profile.lastDecision?.after.taskLoadMultiplier, 0.95);
});

test("empty and one-event histories remain in cold start with no invented personalization", () => {
  const empty = calibrateLearningStrategy({ events: [], now: NOW });
  assert.equal(empty.profile.personalizationLevel, "cold-start");
  assert.equal(empty.profile.active, false);
  assert.equal(empty.profile.confidence.level, "low");
  const single = calibrateLearningStrategy({
    events: [event("one-pass", "assessment_passed", 1, {
      independent: true, hintsUsed: 0, scorePct: 100, variantId: "one",
    })],
    now: NOW,
  });
  assert.equal(single.profile.personalizationLevel, "cold-start");
  assert.equal(single.profile.parameters.difficultyBias, 0);
  assert.equal(single.decision, null);
});

test("duplicate, invalid, future and out-of-window events do not inflate evidence", () => {
  const one = event("same-id", "assessment_passed", 1, {
    independent: true, hintsUsed: 0, scorePct: 100, variantId: "one",
  });
  const { evidence } = calibrateLearningStrategy({
    events: [one, { ...one, scorePct: 0 }, event("future", "assessment_passed", -2, {
      independent: true, hintsUsed: 0, variantId: "future",
    }), event("old", "assessment_passed", 220, { independent: true, variantId: "old" }),
      { ...event("bad-date", "assessment_passed", 1), at: "not-a-date" }],
    now: NOW,
  });
  assert.equal(evidence.sampleCounts.ability, 1);
  assert.equal(evidence.sampleCounts.independent, 1);
});

test("independent failure evidence across variants can trigger scaffolding after the evidence threshold", () => {
  const rows = Array.from({ length: 4 }, (_, index) =>
    event("wrong-" + index, "attempt", index + 1, {
      sessionId: "failure-session-" + index, sessionType: "challenge",
      correct: false, hintsUsed: 0, variantId: "failure-variant-" + index,
    }));
  const { profile } = calibrateLearningStrategy({ events: rows, now: NOW });
  assert.equal(profile.evidence.ability.independentFailures, 4);
  assert.equal(profile.parameters.difficultyBias, 0);
  assert.equal(profile.parameters.difficultyBiasByCompetency["thenable-adoption"], -1);
  assert.equal(profile.recommendation.difficultyByCompetency["thenable-adoption"], "scaffold");
  assert.equal(profile.recommendation.difficulty, "scaffold");
});

test("independent unhinted success across variants can cautiously raise difficulty", () => {
  const { profile, decision } = calibrateLearningStrategy({ events: independentSet(), now: NOW });
  assert.equal(profile.evidence.ability.independentPasses, 4);
  assert.equal(profile.evidence.transfer.distinctVariants, 3);
  assert.equal(profile.parameters.difficultyBias, 0);
  assert.equal(profile.parameters.difficultyBiasByCompetency["thenable-adoption"], 1);
  assert.equal(profile.recommendation.difficultyByCompetency["thenable-adoption"], "stretch");
  assert.equal(profile.recommendation.difficulty, "stretch");
  assert.ok(decision);
  assert.ok(decision.evidenceRefs.includes("p4"));
  assert.equal(decision.algorithmVersion, 1);
});

test("difficulty calibration is isolated by competency when two knowledge nodes show opposite outcomes", () => {
  const rows = [
    ...independentSet(),
    ...Array.from({ length: 4 }, (_, index) =>
      event("chaining-failure-" + index, "attempt", index + 1, {
        competencyIds: ["promise-chaining"],
        sessionId: "chaining-session-" + index,
        correct: false, hintsUsed: 0, variantId: "chaining-variant-" + index,
      })),
  ];
  const { profile } = calibrateLearningStrategy({ events: rows, now: NOW });
  assert.equal(profile.parameters.difficultyBiasByCompetency["thenable-adoption"], 1);
  assert.equal(profile.parameters.difficultyBiasByCompetency["promise-chaining"], -1);
  assert.equal(profile.recommendation.difficultyByCompetency["thenable-adoption"], "stretch");
  assert.equal(profile.recommendation.difficultyByCompetency["promise-chaining"], "scaffold");
  assert.equal(profile.recommendation.difficulty, "maintain",
    "opposing per-node signals must not collapse into a global difficulty decision");
});

test("hint-assisted passes are not independent mastery evidence and suggest guided retrieval", () => {
  const rows = [];
  for (let index = 0; index < 5; index += 1) {
    rows.push(event("attempt-" + index, "attempt", index + 1, { hintsUsed: 2, correct: true }));
    rows.push(event("assisted-" + index, "assessment_passed", index + 1, {
      independent: false, hintsUsed: 2, scorePct: 95, variantId: "same", sessionType: "challenge",
    }));
  }
  const { profile } = calibrateLearningStrategy({ events: rows, now: NOW });
  assert.equal(profile.evidence.ability.independentPasses, 0);
  assert.equal(profile.evidence.ability.assistedPasses, 5);
  assert.equal(profile.parameters.difficultyBias, 0);
  assert.equal(profile.recommendation.intervention, "guided-retrieval");
});

test("delayed retrieval failures shorten the individual interval only after the evidence threshold", () => {
  const rows = [
    event("base-1", "assessment_passed", 40, { independent: true, hintsUsed: 0, scorePct: 96, variantId: "a", sessionType: "challenge" }),
    event("delay-1-start", "review_started", 33, { sessionId: "r1", sessionType: "review" }),
    event("delay-1", "attempt", 33, { sessionId: "r1", sessionType: "review", correct: false, hintsUsed: 0, variantId: "r1" }),
    event("base-2", "assessment_passed", 25, { independent: true, hintsUsed: 0, scorePct: 92, variantId: "b", sessionType: "challenge" }),
    event("delay-2-start", "review_started", 18, { sessionId: "r2", sessionType: "review" }),
    event("delay-2", "attempt", 18, { sessionId: "r2", sessionType: "review", correct: false, hintsUsed: 0, variantId: "r2" }),
    event("base-3", "assessment_passed", 10, { independent: true, hintsUsed: 0, scorePct: 94, variantId: "c", sessionType: "challenge" }),
    event("delay-3-start", "review_started", 3, { sessionId: "r3", sessionType: "review" }),
    event("delay-3", "attempt", 3, { sessionId: "r3", sessionType: "review", correct: false, hintsUsed: 0, variantId: "r3" }),
  ];
  const { profile } = calibrateLearningStrategy({ events: rows, now: NOW });
  assert.equal(profile.evidence.sampleCounts.delayedRecall, 3);
  assert.equal(profile.evidence.delayedRecall.failed, 3);
  assert.equal(profile.parameters.reviewIntervalMultiplier, 1, "review interval calibration must not be global");
  assert.equal(profile.parameters.reviewIntervalsByCompetency["thenable-adoption"], 0.95);
  const schedule = calculateReviewSchedule({
    competencyId: "thenable-adoption",
    events: rows,
    intelligence: { status: "initial", activeGaps: [] },
    strategyProfile: profile,
    now: NOW,
  });
  assert.equal(schedule.strategyIntervalMultiplier, 0.95);
  assert.ok(schedule.intervalDays <= schedule.baseIntervalDays);
  const unrelated = calculateReviewSchedule({
    competencyId: "unrelated-competency", events: rows,
    intelligence: { status: "initial", activeGaps: [] },
    strategyProfile: profile, now: NOW,
  });
  assert.equal(unrelated.strategyIntervalMultiplier, 1,
    "a review pattern in one competency must not alter another competency");
  const lowSample = calculateReviewSchedule({
    competencyId: "thenable-adoption", events: rows.slice(0, 4),
    intelligence: { status: "initial", activeGaps: [] },
    strategyProfile: { ...profile, evidence: { ...profile.evidence, delayedRecall: {
      ...profile.evidence.delayedRecall,
      byCompetency: { "thenable-adoption": { independentObservations: 2 } },
    } } },
    now: NOW,
  });
  assert.equal(lowSample.strategyIntervalMultiplier, 1);
});

test("hint-assisted delayed review passes are tracked separately and never shorten or lengthen intervals", () => {
  const rows = [
    event("base-assisted", "assessment_passed", 30, {
      independent: true, hintsUsed: 0, scorePct: 95, variantId: "base", sessionType: "challenge",
    }),
    ...Array.from({ length: 3 }, (_, index) => ([
      event("assisted-start-" + index, "review_started", 20 - index * 5, {
        sessionId: "assisted-review-" + index, sessionType: "review",
      }),
      event("assisted-pass-" + index, "assessment_passed", 20 - index * 5, {
        sessionId: "assisted-review-" + index, independent: false, hintsUsed: 2,
        scorePct: 95, variantId: "assisted-" + index, sessionType: "review",
      }),
    ])).flat(),
  ];
  const { profile } = calibrateLearningStrategy({ events: rows, now: NOW });
  assert.equal(profile.evidence.delayedRecall.observations, 3);
  assert.equal(profile.evidence.delayedRecall.independentObservations, 0);
  assert.equal(profile.evidence.delayedRecall.assistedObservations, 3);
  assert.equal(profile.evidence.sampleCounts.delayedRecall, 0);
  assert.equal(profile.parameters.reviewIntervalMultiplier, 1);
});

test("hint-assisted delayed failures are not counted as independent recall failures", () => {
  const rows = [
    event("assisted-failure-base", "assessment_passed", 35, {
      independent: true, hintsUsed: 0, scorePct: 95, variantId: "base", sessionType: "challenge",
    }),
    ...Array.from({ length: 3 }, (_, index) => ([
      event("assisted-failure-start-" + index, "review_started", 25 - index * 6, {
        sessionId: "assisted-fail-" + index, sessionType: "review",
      }),
      event("assisted-failure-hint-" + index, "hint", 25 - index * 6, {
        sessionId: "assisted-fail-" + index, sessionType: "review", hintNumber: 1,
      }),
      event("assisted-failure-attempt-" + index, "attempt", 25 - index * 6, {
        sessionId: "assisted-fail-" + index, sessionType: "review",
        correct: false, hintsUsed: 1, variantId: "assisted-fail-variant-" + index,
      }),
    ])).flat(),
  ];
  const { profile } = calibrateLearningStrategy({ events: rows, now: NOW });
  assert.equal(profile.evidence.delayedRecall.assistedObservations, 3);
  assert.equal(profile.evidence.delayedRecall.independentObservations, 0);
  assert.equal(profile.evidence.delayedRecall.failed, 0);
  assert.equal(profile.evidence.sampleCounts.delayedRecall, 0);
  assert.equal(profile.parameters.reviewIntervalsByCompetency["thenable-adoption"], undefined);
});

test("per-competency difficulty and review intervals expire when their evidence leaves the observation window", () => {
  const previous = {
    schemaVersion: 1,
    profileRevision: 5,
    lastParameterChangeAt: atDaysAgo(10),
    parameters: {
      taskLoadMultiplier: 0.9, reviewIntervalMultiplier: 1,
      difficultyBias: 1,
      difficultyBiasByCompetency: { "thenable-adoption": 1 },
      reviewIntervalsByCompetency: { "thenable-adoption": 0.9 },
      interventionPreference: "transfer-challenge",
    },
  };
  const { profile, decision } = calibrateLearningStrategy({ events: [], previous, now: NOW });
  assert.deepEqual(profile.parameters.difficultyBiasByCompetency, {});
  assert.deepEqual(profile.parameters.reviewIntervalsByCompetency, {});
  assert.equal(profile.parameters.difficultyBias, 0);
  assert.equal(profile.parameters.taskLoadMultiplier, 0.95,
    "task density gradually returns toward, but never exceeds, the user's chosen budget");
  assert.equal(profile.recommendation.difficulty, "maintain");
  assert.ok(decision);
  assert.ok(decision.reasons.some(reason => /观察窗口|默认难度|通用复习间隔/.test(reason)));
});

test("the 72-hour cooldown prevents oscillation and parameter changes are bounded", () => {
  const previous = {
    schemaVersion: 1, profileRevision: 3,
    parameters: { taskLoadMultiplier: 1, reviewIntervalMultiplier: 1, difficultyBias: 0,
        interventionPreference: "active-recall", reviewIntervalsByCompetency: {} },
    lastParameterChangeAt: new Date(NOW.getTime() - 12 * 60 * 60 * 1000).toISOString(),
  };
  const rows = [
    ...independentSet(),
    ...Array.from({ length: 6 }, (_, index) => event("failed-task-" + index, "learning_task_failed", index + 1, { taskId: "failed-task-" + index })),
  ];
  const { profile, decision, coolingDown } = calibrateLearningStrategy({ events: rows, previous, now: NOW });
  assert.equal(coolingDown, true);
  assert.equal(decision, null);
  assert.equal(profile.parameters.taskLoadMultiplier, 1);
  assert.equal(profile.parameters.difficultyBias, 0);
});

test("contradictory delayed outcomes lower confidence and old evidence decays", () => {
  const consistent = [
    event("c-base", "assessment_passed", 30, { independent: true, hintsUsed: 0, scorePct: 95, variantId: "a", sessionType: "challenge" }),
    ...Array.from({ length: 4 }, (_, index) => event("c-delay-" + index, "assessment_passed", 25 - index * 4, {
      independent: true, hintsUsed: 0, scorePct: 95, variantId: "r" + index, sessionType: "review", sessionId: "cr" + index,
    })),
  ];
  const contradictory = [
    event("m-base", "assessment_passed", 30, { independent: true, hintsUsed: 0, scorePct: 95, variantId: "a", sessionType: "challenge" }),
    ...Array.from({ length: 4 }, (_, index) => event("m-delay-" + index, "assessment_passed", 25 - index * 4, {
      independent: true, hintsUsed: 0, scorePct: index % 2 ? 90 : 45, variantId: "m" + index, sessionType: "review", sessionId: "mr" + index,
    })),
  ];
  const good = calibrateLearningStrategy({ events: consistent, now: NOW });
  const mixed = calibrateLearningStrategy({ events: contradictory, now: NOW });
  assert.ok(mixed.confidence.score < good.confidence.score);
  const oldAndNew = calibrateLearningStrategy({
    events: [
      event("old-pass", "assessment_passed", 170, { independent: true, hintsUsed: 0, scorePct: 90, variantId: "old" }),
      event("new-pass", "assessment_passed", 1, { independent: true, hintsUsed: 0, scorePct: 90, variantId: "new" }),
    ],
    now: NOW,
  });
  assert.ok(oldAndNew.evidence.decay.effectiveIndependentSamples < oldAndNew.evidence.sampleCounts.independent);
  assert.equal(oldAndNew.evidence.decay.halfLifeDays, 60);
});

test("effectiveness separates recommendation, execution, independent ability, delayed results and feedback", () => {
  const decisionId = "decision-x";
  const rows = [
    event("generated", "learning_plan_generated", 10, { strategyDecisionId: decisionId }),
    event("accepted", "learning_plan_accepted", 9, { strategyDecisionId: decisionId }),
    event("started", "learning_task_in_progress", 8, { strategyDecisionId: decisionId }),
    event("completed", "learning_task_completed", 7, { strategyDecisionId: decisionId }),
    event("ability", "assessment_passed", 6, { strategyDecisionId: decisionId, independent: true, hintsUsed: 0, scorePct: 90 }),
    event("delayed", "assessment_passed", 1, { strategyDecisionId: decisionId, independent: true, hintsUsed: 0, scorePct: 90, sessionType: "review" }),
    event("feedback", "learning_strategy_feedback", 1, { strategyDecisionId: decisionId, rating: "helpful" }),
  ];
  const result = evaluateLearningStrategyEffectiveness(rows, decisionId);
  assert.deepEqual(result.recommendation, { generated: 1, accepted: 1, rejected: 0 });
  assert.deepEqual(result.execution, { started: 1, completed: 1, failed: 0, skipped: 0 });
  assert.equal(result.learning.independentChecks, 1);
  assert.equal(result.learning.independentPasses, 1);
  assert.equal(result.longTerm.delayedIndependentPasses, 1);
  assert.equal(result.longTerm.observations, 1);
  assert.equal(result.longTerm.independentObservations, 1);
  assert.equal(result.feedback.helpful, 1);
  assert.equal(result.status, "observing");
  assert.match(result.interpretation, /不足|观察/);
});

function memoryRepository({ conflictOnce = false } = {}) {
  const documents = new Map();
  const events = [];
  let conflict = conflictOnce;
  return {
    events: { list: async () => events.map(item => structuredClone(item)) },
    documents: {
      get: async (type, key) => {
        const row = documents.get(type + "::" + key);
        return row ? structuredClone(row) : null;
      },
      list: async () => [...documents.entries()].map(([compoundKey, row]) => {
        const separator = compoundKey.indexOf("::");
        return {
          type: compoundKey.slice(0, separator),
          key: compoundKey.slice(separator + 2),
          ...structuredClone(row),
        };
      }),
    },
    async commit(change) {
      for (const item of change.documents || []) {
        const key = item.type + "::" + item.key;
        const row = documents.get(key);
        const revision = row?.localRevision || 0;
        if (conflict && item.type === "learner_profile" && item.key === "strategy") {
          conflict = false;
          documents.set(key, {
            localRevision: 1,
            payload: {
              schemaVersion: 1, profileRevision: 0,
              parameters: { taskLoadMultiplier: 1, reviewIntervalMultiplier: 1, difficultyBias: 0,
        interventionPreference: "active-recall", reviewIntervalsByCompetency: {} },
              sourceFingerprint: "other-device",
            },
          });
          throw new Error("compare-and-swap revision conflict");
        }
        if (revision !== item.expectedLocalRevision) throw new Error("compare-and-swap revision conflict");
      }
      for (const item of change.documents || []) {
        const key = item.type + "::" + item.key;
        const row = documents.get(key);
        documents.set(key, { localRevision: (row?.localRevision || 0) + 1, payload: structuredClone(item.payload) });
      }
      for (const eventRow of change.events || []) {
        if (!events.some(item => item.id === eventRow.id)) events.push(structuredClone(eventRow));
      }
    },
  };
}

test("task rhythm measurements use completed task time and active dates, not mastery evidence", () => {
  const rows = [
    event("t1", "learning_task_completed", 5, { taskId: "t1", durationSeconds: 900 }),
    event("t2", "learning_task_completed", 4, { taskId: "t2", durationSeconds: 1800 }),
    event("t3", "learning_task_completed", 3, { taskId: "t3", durationSeconds: 1200 }),
    event("t4", "learning_task_skipped", 2, { taskId: "t4", durationSeconds: 3600 }),
  ];
  const { profile } = calibrateLearningStrategy({ events: rows, now: NOW });
  assert.equal(profile.evidence.behavior.completedTasksWithDuration, 3);
  assert.equal(profile.evidence.behavior.averageTaskDurationMinutes, 21.667);
  assert.equal(profile.evidence.behavior.medianTaskDurationMinutes, 20);
  assert.equal(profile.evidence.behavior.activeCompletionDays, 3);
  assert.equal(profile.evidence.behavior.longestCompletionStreakDays, 3);
  assert.equal(profile.evidence.sampleCounts.independent, 0);
  assert.equal(profile.evidence.sampleCounts.ability, 0);
});

test("challenge step completion is counted as independent evidence only when no hints were used", () => {
  const rows = [
    event("campaign-attempt", "attempt", 12, {
      sessionId: "campaign-run", stepId: "step-a", correct: true, hintsUsed: 0, variantId: "quest:step-a",
    }),
    event("campaign-complete", "completed", 12, {
      sessionId: "campaign-run", stepId: "step-a", independent: true, hintsUsed: 0,
      scorePct: 100, variantId: "quest:step-a",
    }),
    event("assisted-attempt", "attempt", 5, {
      sessionId: "campaign-assisted", stepId: "step-b", correct: true, hintsUsed: 1, variantId: "quest:step-b",
    }),
    event("assisted-complete", "completed", 5, {
      sessionId: "campaign-assisted", stepId: "step-b", independent: false, hintsUsed: 1,
      scorePct: 90, variantId: "quest:step-b",
    }),
  ];
  const { profile } = calibrateLearningStrategy({ events: rows, now: NOW });
  assert.equal(profile.evidence.ability.independentPasses, 1);
  assert.equal(profile.evidence.ability.assistedPasses, 0);
  assert.equal(profile.evidence.sampleCounts.independent, 1);
  assert.equal(profile.evidence.sampleCounts.ability, 1);
});

test("repository strategy projection and audit event are idempotent; CAS conflict is retried", async () => {
  const repository = memoryRepository({ conflictOnce: true });
  const engine = createLearningStrategyEngine({ repository });
  const rows = independentSet();
  const first = await engine.refresh({ events: rows, mode: "adaptive", now: NOW });
  assert.equal(first.profileRevision, 1);
  assert.equal(first.lastDecision.after.difficultyBias, 0);
  assert.equal(first.lastDecision.after.difficultyBiasByCompetency["thenable-adoption"], 1);
  assert.equal((await repository.events.list()).filter(item => item.type === "learning_strategy_calibrated").length, 1);
  const second = await engine.refresh({ events: rows, mode: "adaptive", now: NOW });
  assert.equal(second.cacheHit, true);
  assert.equal((await repository.events.list()).filter(item => item.type === "learning_strategy_calibrated").length, 1);
  const off = await engine.refresh({ events: rows, mode: "default", now: new Date(NOW.getTime() + 4 * DAY) });
  assert.equal(off.mode, "default");
  assert.equal(off.parameters.difficultyBias, 0);
  const feedback = await engine.feedback({
    decisionId: first.lastDecision.decisionId, rating: "not_helpful", now: new Date(NOW.getTime() + 5 * DAY),
  });
  assert.equal(feedback.type, "learning_strategy_feedback");
  assert.ok((await repository.events.list()).some(item => item.id === feedback.id));
});

test("scheduled review tasks preserve the strategy decision, intervention and explanation in journal events", async () => {
  const repository = memoryRepository();
  const taskOrchestrator = createLearningTaskOrchestrator({ repository });
  const task = await taskOrchestrator.ensureScheduledReviewTask({
    competencyId: "thenable-adoption", competencyTitle: "Thenable",
    topicId: "promise", topicTitle: "Promise",
    dueAt: NOW.toISOString(), at: NOW,
    evidenceRefs: ["review-source-1"],
    strategyDecisionId: "decision-schedule",
    strategyProfileRevision: 4,
    learningIntervention: "spaced-retrieval",
    strategyInstruction: "延迟回忆失败，先采用短间隔复习。",
    difficultyLevel: "scaffold",
    strategyEvidenceRefs: ["review-source-1", "review-source-2"],
  });
  assert.equal(task.strategyDecisionId, "decision-schedule");
  assert.equal(task.learningIntervention, "spaced-retrieval");
  assert.equal(task.strategyInstruction, "延迟回忆失败，先采用短间隔复习。");
  const created = (await repository.events.list()).find(item => item.type === "learning_task_created");
  assert.equal(created.strategyDecisionId, "decision-schedule");
  assert.equal(created.difficultyLevel, "scaffold");
  const started = await taskOrchestrator.start(task.taskId, { at: new Date(NOW.getTime() + 1000) });
  assert.equal(started.status, "in_progress");
  const startEvent = (await repository.events.list()).find(item => item.type === "learning_task_in_progress");
  assert.equal(startEvent.strategyDecisionId, "decision-schedule");
  assert.equal(startEvent.learningIntervention, "spaced-retrieval");
});

test("review task strategy metadata is preserved on the resulting assessment evidence", async () => {
  const docs = new Map();
  const rows = [];
  const repository = {
    events: { list: async () => rows.slice() },
    documents: { get: async (type, key) => docs.get(type + "::" + key) || null },
    async commit(change) {
      for (const eventRow of change.events || []) if (!rows.some(item => item.id === eventRow.id)) rows.push(eventRow);
      for (const item of change.documents || []) {
        const key = item.type + "::" + item.key;
        const prior = docs.get(key);
        if ((prior?.localRevision || 0) !== item.expectedLocalRevision) throw new Error("revision conflict");
        docs.set(key, { localRevision: (prior?.localRevision || 0) + 1, payload: item.payload });
      }
    },
  };
  const progressStore = { load: async () => ({ events: rows.slice() }) };
  const registry = { assessments: [{
    id: "variant-a", competencyId: "thenable-adoption", topicId: "promise",
    title: "Strategy tagged check", prompt: "Check", options: [{ id: "a", label: "Correct" }, { id: "b", label: "Wrong" }],
    answer: "a", hints: [], explanation: "Reason",
  }] };
  const engine = createReviewSessionEngine({ repository, progressStore, registry });
  const session = await engine.start({
    competencyId: "thenable-adoption",
    strategyDecisionId: "decision-review",
    learningIntervention: "guided-retrieval",
    difficultyLevel: "scaffold",
  });
  await engine.submit(session.sessionId, "a");
  const passed = rows.find(item => item.type === "assessment_passed");
  assert.equal(passed.strategyDecisionId, "decision-review");
  assert.equal(passed.learningIntervention, "guided-retrieval");
  assert.equal(passed.difficultyLevel, "scaffold");
});
