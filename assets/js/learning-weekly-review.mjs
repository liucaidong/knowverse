const WINDOW_DAYS = 7;
const PASS_TYPES = new Set(["assessment_passed", "completed"]);
const ACTIVITY_TYPES = new Set([
  "attempt", "assessment_passed", "completed", "review_started", "hint", "hint_revealed",
  "learning_task_in_progress", "learning_task_paused", "learning_task_completed",
  "learning_task_failed", "learning_task_skipped",
]);
const TASK_TYPES = new Set([
  "learning_task_in_progress", "learning_task_paused", "learning_task_completed",
  "learning_task_failed", "learning_task_skipped", "learning_task_cancelled",
]);
const DAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function validDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function startOfLocalDay(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
function dateKey(value) {
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0")].join("-");
}
function compactDate(value) {
  return String(value.getMonth() + 1).padStart(2, "0") + "/" +
    String(value.getDate()).padStart(2, "0");
}
function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter(value => typeof value === "string" && value.trim()))];
}

/**
 * Build a seven-calendar-day learning reflection from canonical events.
 * Reading, browsing, AI conversations and task completion are never treated
 * as independent mastery evidence. Duration comes only from settled task
 * transition events, never estimatedMinutes or open sessions.
 */
export function buildWeeklyLearningReview({
  events = [],
  activeGaps = [],
  topicTitles = {},
  now = new Date(),
} = {}) {
  const current = validDate(now);
  if (!current) throw new TypeError("now must be a valid date.");

  const today = startOfLocalDay(current);
  const endExclusive = new Date(today);
  endExclusive.setDate(endExclusive.getDate() + 1);
  const start = new Date(today);
  start.setDate(start.getDate() - (WINDOW_DAYS - 1));

  const seen = new Set();
  const rows = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event.id !== "string" || !event.id.trim() || seen.has(event.id)) continue;
    const at = validDate(event.at);
    if (!at || at < start || at >= endExclusive) continue;
    if (!ACTIVITY_TYPES.has(event.type)) continue;
    seen.add(event.id);
    rows.push({ ...event, _time: at, _day: dateKey(at) });
  }
  rows.sort((a, b) => a._time - b._time);

  const days = [];
  for (let offset = 0; offset < WINDOW_DAYS; offset += 1) {
    const date = new Date(start);
    date.setDate(date.getDate() + offset);
    days.push({
      date: dateKey(date),
      label: compactDate(date),
      weekday: DAY_NAMES[date.getDay()],
      count: 0,
      attempts: 0,
      independentPasses: 0,
      assistedPasses: 0,
      hints: 0,
      taskTransitions: 0,
      reviewStarts: 0,
      _independentPassKeys: new Set(),
      _assistedPassKeys: new Set(),
      _unclassifiedPassKeys: new Set(),
    });
  }
  const dayByKey = new Map(days.map(day => [day.date, day]));
  const competencyCounts = new Map();
  const taskDurationEventIds = new Set();
  const gapObservations = new Set();
  const reviewSessions = new Set();
  const taskIdsStarted = new Set();
  const taskIdsCompleted = new Set();
  const taskIdsFailed = new Set();
  const distinctLearningSessions = new Set();
  const independentPassKeys = new Set();
  const assistedPassKeys = new Set();
  const unclassifiedPassKeys = new Set();

  let attempts = 0;
  let incorrectAttempts = 0;
  let hints = 0;
  let actualDurationSeconds = 0;

  for (const event of rows) {
    const day = dayByKey.get(event._day);
    if (!day) continue;
    day.count += 1;
    const competencyIds = uniqueStrings(event.competencyIds);
    competencyIds.forEach(id => competencyCounts.set(id, (competencyCounts.get(id) || 0) + 1));
    if (event.sessionId && event.sessionType) {
      distinctLearningSessions.add(event.sessionType + ":" + event.sessionId);
    }
    if (event.type === "attempt") {
      attempts += 1;
      day.attempts += 1;
      if (event.correct === false) {
        incorrectAttempts += 1;
        if (event.gapId) gapObservations.add(event.gapObservationId || event.id);
      }
    }
    if (PASS_TYPES.has(event.type)) {
      const hasEvidenceIdentity = competencyIds.length > 0 &&
        typeof event.variantId === "string" && event.variantId.trim();
      const resultKey = (event.sessionType || "unknown") + ":" +
        (event.sessionId || event.id) + ":" + (event.variantId || event.id);
      if (event.independent === true && Number(event.hintsUsed || 0) === 0 && hasEvidenceIdentity) {
        independentPassKeys.add(resultKey);
        day._independentPassKeys.add(resultKey);
      } else if (Number(event.hintsUsed || 0) > 0) {
        assistedPassKeys.add(resultKey);
        day._assistedPassKeys.add(resultKey);
      } else {
        unclassifiedPassKeys.add(resultKey);
        day._unclassifiedPassKeys.add(resultKey);
      }
    }
    if (event.type === "hint" || event.type === "hint_revealed") {
      hints += 1;
      day.hints += 1;
    }
    if (event.type === "review_started" && event.sessionType === "review") {
      day.reviewStarts += 1;
      if (event.sessionId) reviewSessions.add(event.sessionId);
    }
    if (TASK_TYPES.has(event.type)) {
      day.taskTransitions += 1;
      if (event.taskId && event.type === "learning_task_in_progress") taskIdsStarted.add(event.taskId);
      if (event.taskId && event.type === "learning_task_completed") taskIdsCompleted.add(event.taskId);
      if (event.taskId && event.type === "learning_task_failed") taskIdsFailed.add(event.taskId);
      const seconds = Number(event.durationSeconds);
      if (event.taskId && !taskDurationEventIds.has(event.id) && Number.isFinite(seconds) && seconds > 0 &&
          ["learning_task_paused", "learning_task_completed", "learning_task_failed"].includes(event.type)) {
        taskDurationEventIds.add(event.id);
        actualDurationSeconds += Math.floor(seconds);
      }
    }
  }

  for (const day of days) {
    day.independentPasses = day._independentPassKeys.size;
    day.assistedPasses = [...day._assistedPassKeys].filter(key =>
      !day._independentPassKeys.has(key)).length;
    delete day._independentPassKeys;
    delete day._assistedPassKeys;
    delete day._unclassifiedPassKeys;
  }
  const assistedOnlyKeys = [...assistedPassKeys].filter(key => !independentPassKeys.has(key));
  const unclassifiedOnlyKeys = [...unclassifiedPassKeys].filter(key =>
    !independentPassKeys.has(key) && !assistedPassKeys.has(key));
  const independentPasses = independentPassKeys.size;
  const assistedPasses = assistedOnlyKeys.length;
  const unclassifiedPasses = unclassifiedOnlyKeys.length;
  const taskStarted = taskIdsStarted.size;
  const taskCompleted = taskIdsCompleted.size;
  const taskFailed = taskIdsFailed.size;
  const activeDays = days.filter(day => day.count > 0).length;
  const maxDayCount = Math.max(1, ...days.map(day => day.count));
  const topCompetencies = [...competencyCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([id, count]) => ({ id, title: topicTitles[id] || id, eventCount: count }));

  return {
    windowDays: WINDOW_DAYS,
    from: start.toISOString(),
    to: new Date(endExclusive.getTime() - 1).toISOString(),
    rangeLabel: compactDate(start) + " – " + compactDate(today),
    activeDays,
    maxDayCount,
    days,
    activity: {
      attempts,
      incorrectAttempts,
      independentPasses,
      assistedPasses,
      unclassifiedPasses,
      hints,
      reviewSessions: reviewSessions.size,
      distinctLearningSessions: distinctLearningSessions.size,
      taskStarted,
      taskCompleted,
      taskFailed,
      uniqueTasksStarted: taskIdsStarted.size,
      uniqueTasksCompleted: taskIdsCompleted.size,
      actualDurationSeconds,
      actualDurationMinutes: Math.round(actualDurationSeconds / 60),
    },
    openGapCount: Array.isArray(activeGaps) ? activeGaps.length : 0,
    gapObservations: gapObservations.size,
    topCompetencies,
    hasLearningData: rows.length > 0,
    eventCount: rows.length,
    evidenceBoundary: "只读真实学习事件；独立通过要求明确标记 independent、零提示、关联能力点与变体。阅读、浏览、AI 对话、任务确认和未结算计时不会计入掌握证据或实际耗时。",
  };
}
