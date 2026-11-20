import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deleteLocalDatabaseForTests } from "../assets/js/backend/local-event-store.mjs";
import { getLearningRepository, resetLearningRepositoryForTests } from "../assets/js/backend/learning-repository.mjs";
import { createLearningTaskOrchestrator, mapPlanActionToTask } from "../assets/js/learning-agent/task-orchestrator.mjs";
import { createReviewSessionEngine } from "../assets/js/review-engine.mjs";

const NOW = new Date();
const readJSON = async p => JSON.parse(await readFile(new URL(p, import.meta.url), "utf8"));
const ago = ms => new Date(NOW.getTime() - ms).toISOString();

function evt(id, type, at, fields = {}) {
  return {
    id, type, at, topicId: "promise", challengeId: "c", challengeTitle: "c",
    stepId: "s", stepTitle: "s", competencyIds: ["thenable-adoption"],
    sessionId: "sess", sessionType: "checkpoint", ...fields,
  };
}

// Reproduces KV41-010: a Staging learner archive reused across many runs contains
// an old gap observation that was already resolved by a *different* task/session.
// A fresh review task for the same competency+gap must still be able to complete
// after a valid no-hint independent pass, even though the historical archive has
// failures that this task's pass does not (and should not) reference.
test("review task completes despite historically resolved failures for the same gap", async () => {
  resetLearningRepositoryForTests();
  await deleteLocalDatabaseForTests();
  const repository = await getLearningRepository();
  const map = await readJSON("../content/learning-map.json");
  const registry = await readJSON("../content/review-assessments.json");
  const orchestrator = createLearningTaskOrchestrator({ repository });
  const gapId = "thenable-get-vs-call";
  const competencyId = "thenable-adoption";

  // Old failure (target A): already resolved by a valid no-hint review pass
  // belonging to an earlier, unrelated task/session.
  const oldFailure = evt("old-failure", "attempt", ago(10 * 3600_000), {
    correct: false, gapId, gapObservationId: "old-failure",
    variantId: "old-checkpoint-variant", sessionType: "checkpoint",
  });
  const oldStart = evt("old-start", "review_started", ago(9.5 * 3600_000), {
    sessionId: "old-session", sessionType: "review", taskId: "old-task",
    gapId, variantId: "old-review-variant", targetGapEventIds: ["old-failure"],
    causationEventIds: ["old-failure"],
  });
  const oldAttempt = evt("old-attempt", "attempt", ago(9.2 * 3600_000), {
    sessionId: "old-session", sessionType: "review", taskId: "old-task",
    gapId, variantId: "old-review-variant", correct: true, hintsUsed: 0,
    targetGapEventIds: ["old-failure"], causationEventIds: ["old-start"],
  });
  const oldPass = evt("old-pass", "assessment_passed", ago(9 * 3600_000), {
    sessionId: "old-session", sessionType: "review", taskId: "old-task",
    gapId, variantId: "old-review-variant", hintsUsed: 0, independent: true,
    targetGapEventIds: ["old-failure"], causationEventIds: ["old-start", "old-attempt"],
  });
  await repository.events.append([oldFailure, oldStart, oldAttempt, oldPass]);

  // Current, still-open failure (target B) for the same competency+gap.
  const openFailure = evt("open-failure", "attempt", ago(3600_000), {
    correct: false, gapId, gapObservationId: "open-failure",
    variantId: "checkpoint-variant", sessionType: "checkpoint",
  });
  await repository.events.append([openFailure]);

  const dateKey = [NOW.getFullYear(), String(NOW.getMonth() + 1).padStart(2, "0"),
    String(NOW.getDate()).padStart(2, "0")].join("-");
  const action = mapPlanActionToTask({
    actionId: "fresh-review", type: "repair", title: "针对性复习", topicId: "promise",
    competencyId, gapId, estimatedMinutes: 8, planDate: dateKey,
    href: "./review/", resourceType: "review",
  }, "fresh-plan");
  await repository.commit({
    documents: [{ type: "learning_task", key: action.taskId, payload: action, expectedLocalRevision: 0 }],
  });
  await orchestrator.start(action.taskId);

  const engine = createReviewSessionEngine({ repository, registry });
  const session = await engine.start({ competencyId, gapId, taskId: action.taskId, planId: action.planId });
  // The engine must target only the still-open observation, not the historical one.
  assert.ok(session.targetGapEventIds.includes("open-failure"));
  assert.equal(session.targetGapEventIds.includes("old-failure"), false);
  const result = await engine.submit(session.sessionId, session.answer);
  assert.equal(result.correct, true);
  assert.equal(result.session.hintsUsed, 0);

  const completed = await orchestrator.complete(action.taskId);
  assert.equal(completed.status, "completed");
  assert.ok(completed.evidenceEventIds.length > 0);
});

// A reused archive may also contain a hint-assisted (non-resolution) pass and
// several historical tasks for the same gap. Only the current task's no-hint pass
// may close the review task; assisted passes never count as resolution.
test("hint-assisted history and multiple prior tasks do not block independent completion", async () => {
  resetLearningRepositoryForTests();
  await deleteLocalDatabaseForTests();
  const repository = await getLearningRepository();
  const registry = await readJSON("../content/review-assessments.json");
  const orchestrator = createLearningTaskOrchestrator({ repository });
  const gapId = "thenable-get-vs-call";
  const competencyId = "thenable-adoption";

  const failed = evt("f", "attempt", ago(7200_000), {
    correct: false, gapId, gapObservationId: "f", variantId: "checkpoint-v", sessionType: "checkpoint",
  });
  await repository.events.append([failed]);

  // Two prior tasks each added noise; one assisted pass (hints>0) must NOT resolve.
  const assisted = evt("assisted-pass", "assessment_passed", ago(3600_000), {
    sessionId: "assisted-session", sessionType: "review", taskId: "task-1",
    gapId, variantId: "review-v-a", hintsUsed: 2, independent: false,
    targetGapEventIds: ["f"], causationEventIds: ["assisted-start", "assisted-attempt"],
  });
  await repository.events.append([assisted]);

  const dateKey = [NOW.getFullYear(), String(NOW.getMonth() + 1).padStart(2, "0"),
    String(NOW.getDate()).padStart(2, "0")].join("-");
  const action = mapPlanActionToTask({
    actionId: "fresh-review-2", type: "repair", title: "针对性复习", topicId: "promise",
    competencyId, gapId, estimatedMinutes: 8, planDate: dateKey,
    href: "./review/", resourceType: "review",
  }, "fresh-plan-2");
  await repository.commit({
    documents: [{ type: "learning_task", key: action.taskId, payload: action, expectedLocalRevision: 0 }],
  });
  await orchestrator.start(action.taskId);

  const engine = createReviewSessionEngine({ repository, registry });
  const session = await engine.start({ competencyId, gapId, taskId: action.taskId, planId: action.planId });
  assert.ok(session.targetGapEventIds.includes("f"),
    "a hint-assisted pass must leave the original observation open for independent verification");
  const submitted = await engine.submit(session.sessionId, session.answer);
  assert.equal(submitted.correct, true);
  assert.equal(submitted.session.hintsUsed, 0);

  const completed = await orchestrator.complete(action.taskId);
  assert.equal(completed.status, "completed");
  assert.ok(completed.evidenceEventIds.length > 0);
});
