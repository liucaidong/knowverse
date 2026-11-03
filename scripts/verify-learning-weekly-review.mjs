import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeklyLearningReview } from "../assets/js/learning-weekly-review.mjs";

const NOW = new Date(2026, 10, 3, 10, 30, 0, 0);
const at = (daysAgo, hour = 9) => {
  const value = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo, hour, 0, 0, 0);
  return value.toISOString();
};
const event = (id, type, daysAgo, fields = {}) => ({
  id, type, at: at(daysAgo), topicId: "promise",
  competencyIds: ["thenable-adoption"],
  ...fields,
});

test("weekly review uses seven local calendar days and ignores duplicate, future and out-of-window events", () => {
  const result = buildWeeklyLearningReview({
    now: NOW,
    events: [
      event("today-hint", "hint", 0),
      event("today-hint", "hint", 0, { hintNumber: 2 }),
      event("day-six", "attempt", 6, { correct: false }),
      event("too-old", "attempt", 7, { correct: false }),
      {
        id: "future",
        type: "attempt",
        at: new Date(2026, 10, 4, 8).toISOString(),
        correct: false,
      },
      {
        id: "browse",
        type: "activity",
        at: at(0),
      },
    ],
  });
  assert.equal(result.windowDays, 7);
  assert.equal(result.days.length, 7);
  assert.equal(result.eventCount, 2);
  assert.equal(result.activeDays, 2);
  assert.equal(result.activity.hints, 1);
  assert.equal(result.activity.attempts, 1);
  assert.equal(result.days[0].date, "2026-10-28");
  assert.equal(result.days[6].date, "2026-11-03");
});

test("weekly review separates independent passes, hint-assisted passes and unclassified completion", () => {
  const result = buildWeeklyLearningReview({
    now: NOW,
    events: [
      event("independent", "assessment_passed", 1, {
        independent: true, hintsUsed: 0, variantId: "variant-b",
      }),
      event("assisted", "completed", 1, {
        independent: false, hintsUsed: 2, variantId: "variant-c",
      }),
      event("unknown", "completed", 0, {
        hintsUsed: 0, variantId: "variant-d",
      }),
      event("no-variant", "assessment_passed", 0, {
        independent: true, hintsUsed: 0,
      }),
    ],
  });
  assert.equal(result.activity.independentPasses, 1);
  assert.equal(result.activity.assistedPasses, 1);
  assert.equal(result.activity.unclassifiedPasses, 2);
  assert.equal(result.activity.independentPasses + result.activity.assistedPasses, 2);
});

test("weekly review counts review sessions, gap observations and actual settled task duration only", () => {
  const result = buildWeeklyLearningReview({
    now: NOW,
    activeGaps: [{ id: "gap-a" }, { id: "gap-b" }],
    events: [
      event("wrong-a", "attempt", 2, {
        correct: false, gapId: "thenable-get-vs-call", gapObservationId: "observation-a",
      }),
      event("wrong-b", "attempt", 2, {
        correct: false, gapId: "thenable-get-vs-call", gapObservationId: "observation-a",
      }),
      event("review-a", "review_started", 1, {
        sessionType: "review", sessionId: "review-session-a",
      }),
      event("review-b", "review_started", 0, {
        sessionType: "review", sessionId: "review-session-a",
      }),
      event("task-start", "learning_task_in_progress", 1, {
        taskId: "task-a", estimatedMinutes: 120,
      }),
      event("task-pause", "learning_task_paused", 1, {
        taskId: "task-a", durationSeconds: 315,
      }),
      event("task-complete", "learning_task_completed", 0, {
        taskId: "task-a", durationSeconds: 245,
      }),
      event("task-complete-open-clock", "learning_task_completed", 0, {
        taskId: "task-b", estimatedMinutes: 90,
      }),
    ],
  });
  assert.equal(result.gapObservations, 1);
  assert.equal(result.openGapCount, 2);
  assert.equal(result.activity.reviewSessions, 1);
  assert.equal(result.activity.taskStarted, 1);
  assert.equal(result.activity.taskCompleted, 2);
  assert.equal(result.activity.actualDurationSeconds, 560);
  assert.equal(result.activity.actualDurationMinutes, 9);
});

test("weekly review resolves canonical topic labels and never counts reading, AI or browsing as mastery", () => {
  const result = buildWeeklyLearningReview({
    now: NOW,
    topicTitles: { "thenable-adoption": "Thenable 解析与采用" },
    events: [
      event("lesson-task", "learning_task_completed", 0, { taskId: "read-1", estimatedMinutes: 20 }),
      event("ai-is-not-mastery", "activity", 0, { activity: "ai_tutor_used" }),
      event("read-is-not-mastery", "activity", 0, { activity: "reading" }),
      event("failed", "attempt", 0, { correct: false }),
    ],
  });
  assert.equal(result.activity.independentPasses, 0);
  assert.equal(result.activity.unclassifiedPasses, 0);
  assert.equal(result.activity.actualDurationSeconds, 0);
  assert.equal(result.topCompetencies[0].title, "Thenable 解析与采用");
  assert.match(result.evidenceBoundary, /AI 对话/);
});

test("empty weekly review reports no learning data instead of zero mastery", () => {
  const result = buildWeeklyLearningReview({ events: [], now: NOW });
  assert.equal(result.hasLearningData, false);
  assert.equal(result.eventCount, 0);
  assert.equal(result.activeDays, 0);
  assert.equal(result.activity.independentPasses, 0);
  assert.equal(result.activity.actualDurationSeconds, 0);
  assert.equal(result.topCompetencies.length, 0);
  assert.equal(result.days.every(day => day.count === 0), true);
});

test("weekly review deduplicates one assessment session and task IDs across state transitions", () => {
  const result = buildWeeklyLearningReview({
    now: NOW,
    events: [
      event("pass-result", "assessment_passed", 0, {
        independent: true, hintsUsed: 0, variantId: "variant-x", sessionId: "same-session",
      }),
      event("complete-result", "completed", 0, {
        independent: true, hintsUsed: 0, variantId: "variant-x", sessionId: "same-session",
      }),
      event("task-start-1", "learning_task_in_progress", 0, { taskId: "same-task" }),
      event("task-start-2", "learning_task_in_progress", 0, { taskId: "same-task" }),
      event("task-complete-1", "learning_task_completed", 0, {
        taskId: "same-task", durationSeconds: 120,
      }),
    ],
  });
  assert.equal(result.activity.independentPasses, 1);
  assert.equal(result.days[6].independentPasses, 1);
  assert.equal(result.activity.taskStarted, 1);
  assert.equal(result.activity.taskCompleted, 1);
  assert.equal(result.activity.actualDurationSeconds, 120);
});
