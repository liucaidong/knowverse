import { deriveLearningInsights } from "../learning-progress.mjs";
import { getLearningRepository } from "../backend/learning-repository.mjs";

const DOCUMENT_TYPE = "learner_profile";
const DOCUMENT_KEY = "preferences";
const DEFAULT_PREFERENCES = Object.freeze({
  dailyMinutes: 25,
  weeklyDays: 5,
  preferredTopicIds: [],
  learningModes: ["read", "explore", "challenge"],
  goal: "",
  targetAt: null,
});
const clone = value => JSON.parse(JSON.stringify(value));
const validStringList = value => Array.isArray(value)
  ? [...new Set(value.filter(item => typeof item === "string" && item.trim()).map(item => item.trim()))].slice(0, 30)
  : [];

export function normalizeLearnerPreferences(value = {}) {
  const minutes = Number(value.dailyMinutes);
  const weeklyDays = Number(value.weeklyDays);
  const modes = validStringList(value.learningModes).filter(item =>
    ["read", "explore", "challenge", "review", "project"].includes(item));
  return {
    dailyMinutes: Number.isInteger(minutes) ? Math.max(10, Math.min(240, minutes)) : DEFAULT_PREFERENCES.dailyMinutes,
    weeklyDays: Number.isInteger(weeklyDays) ? Math.max(1, Math.min(7, weeklyDays)) : DEFAULT_PREFERENCES.weeklyDays,
    preferredTopicIds: validStringList(value.preferredTopicIds),
    learningModes: modes.length ? modes : [...DEFAULT_PREFERENCES.learningModes],
    goal: typeof value.goal === "string" ? value.goal.trim().slice(0, 500) : "",
    targetAt: value.targetAt && Number.isFinite(Date.parse(value.targetAt))
      ? new Date(value.targetAt).toISOString() : null,
  };
}

export function createLearnerProfileStore(options = {}) {
  const repositoryPromise = options.repository ? Promise.resolve(options.repository) : getLearningRepository();
  return {
    async loadPreferences() {
      const repository = await repositoryPromise;
      const row = await repository.documents.get(DOCUMENT_TYPE, DOCUMENT_KEY);
      return normalizeLearnerPreferences(row?.payload?._deleted ? {} : row?.payload || {});
    },
    async savePreferences(value) {
      const repository = await repositoryPromise;
      const row = await repository.documents.get(DOCUMENT_TYPE, DOCUMENT_KEY);
      const preferences = normalizeLearnerPreferences(value);
      const event = {
        id: "learner-preferences-updated:" + (globalThis.crypto?.randomUUID?.() || Date.now()),
        type: "learner_preferences_updated",
        at: new Date().toISOString(),
        topicId: "unclassified",
        challengeId: "learning-agent",
        challengeTitle: "学习者画像",
        stepId: "profile-preferences",
        stepTitle: "更新学习偏好",
        competencyIds: [],
        sessionId: "learner-profile",
        sessionType: "profile",
        preferenceSnapshot: preferences,
      };
      await repository.commit({
        events: [event],
        documents: [{
          type: DOCUMENT_TYPE,
          key: DOCUMENT_KEY,
          payload: preferences,
          expectedLocalRevision: Number(row?.localRevision) || 0,
        }],
      });
      return preferences;
    },
  };
}

const LEARNING_ACTIVITY_TYPES = new Set([
  "attempt", "completed", "assessment_passed", "review_started",
  "plan_action_started", "plan_action_completed", "learning_task_in_progress",
  "learning_task_paused", "learning_task_completed", "learning_task_failed",
  "learning_task_skipped",
]);

function uniqueDays(events, sinceMs) {
  return new Set(events.filter(event => LEARNING_ACTIVITY_TYPES.has(event.type) &&
    Number.isFinite(Date.parse(event.at)) && Date.parse(event.at) >= sinceMs)
    .map(event => new Date(event.at).toISOString().slice(0, 10))).size;
}

export function deriveLearnerProfile({ learningMap, challengeRegistry, snapshot, preferences, goals = [], now = new Date() }) {
  const current = now instanceof Date ? now : new Date(now);
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  const insights = deriveLearningInsights(learningMap, challengeRegistry, snapshot, current);
  const activeGoals = goals.filter(goal => goal.status === "active");
  const taskEvents = events.filter(event => event.type?.startsWith("learning_task_"));
  const terminal = taskEvents.filter(event => ["learning_task_completed", "learning_task_failed",
    "learning_task_skipped", "learning_task_cancelled"].includes(event.type));
  const completedTasks = taskEvents.filter(event => event.type === "learning_task_completed");
  const attempted = events.filter(event => event.type === "attempt");
  const hinted = attempted.filter(event => Number(event.hintsUsed) > 0);
  const last7Days = current.getTime() - 7 * 86_400_000;
  const last30Days = current.getTime() - 30 * 86_400_000;
  const recent = events.filter(event => Number.isFinite(Date.parse(event.at)) && Date.parse(event.at) >= last30Days);
  const byTopic = new Map();
  for (const event of events) {
    const topicId = event.topicId || "unclassified";
    if (!byTopic.has(topicId)) byTopic.set(topicId, { topicId, attempts: 0, evidence: 0, hints: 0, completedTasks: 0 });
    const item = byTopic.get(topicId);
    if (event.type === "attempt") { item.attempts += 1; if (Number(event.hintsUsed) > 0) item.hints += 1; }
    if (["completed", "assessment_passed"].includes(event.type)) item.evidence += 1;
    if (event.type === "learning_task_completed") item.completedTasks += 1;
  }
  const competencies = insights.competencyInsights;
  const behavior = {
    learningDaysLast7: uniqueDays(events, last7Days),
    learningDaysLast30: uniqueDays(events, last30Days),
    taskCompletionRate: terminal.length ? Number((completedTasks.length / terminal.length).toFixed(3)) : null,
    taskCompletions: completedTasks.length,
    taskInterruptions: taskEvents.filter(event => ["learning_task_paused", "learning_task_failed"].includes(event.type)).length,
    hintDependencyRate: attempted.length ? Number((hinted.length / attempted.length).toFixed(3)) : null,
    attempts: attempted.length,
    hintAssistedAttempts: hinted.length,
    averageEvidencePerAttempt: attempted.length
      ? Number((events.filter(event => ["completed", "assessment_passed"].includes(event.type)).length / attempted.length).toFixed(2))
      : null,
    topicPerformance: [...byTopic.values()].sort((a, b) => b.evidence - a.evidence),
    planExecution: {
      plannedTasks: events.filter(event => event.type === "learning_plan_accepted").reduce((sum, event) => sum + (Number(event.taskCount) || 0), 0),
      completedTasks: completedTasks.length,
      pausedOrFailed: taskEvents.filter(event => ["learning_task_paused", "learning_task_failed"].includes(event.type)).length,
    },
  };
  const recentGrowth = recent.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .filter(event => ["completed", "assessment_passed", "attempt", "learning_task_completed"].includes(event.type))
    .slice(-20).map(event => ({
      eventId: event.id,
      type: event.type,
      at: event.at,
      topicId: event.topicId || null,
      competencyIds: event.competencyIds || [],
      label: event.stepTitle || event.challengeTitle || event.type,
    }));
  const weak = competencies.filter(item => item.status === "weak" || item.activeGaps.length);
  const unverified = competencies.filter(item => item.status === "unverified");
  const mastery = {
    totalCompetencies: competencies.length,
    verifiedCompetencies: competencies.filter(item => item.evidenceCount > 0).length,
    stableCompetencies: competencies.filter(item => item.status === "stable").length,
    weakCompetencies: weak.map(item => ({ id: item.id, title: item.title, topicId: item.topicId, masteryScore: item.masteryScore })),
    unverifiedCompetencies: unverified.map(item => ({ id: item.id, title: item.title, topicId: item.topicId })),
    activeGaps: insights.gaps.map(gap => ({
      id: gap.id, label: gap.label, competencyId: gap.competencyId,
      lifecycle: gap.lifecycle, lifecycleLabel: gap.lifecycleLabel,
      count: gap.count, lastSeenAt: gap.lastSeenAt,
      evidenceRefs: events.filter(event => event.type === "attempt" &&
        event.gapId === gap.id && (event.competencyIds || []).includes(gap.competencyId))
        .map(event => event.id),
    })),
    prerequisiteGaps: competencies.filter(item => (item.prerequisites || []).some(id => {
      const parent = competencies.find(candidate => candidate.id === id);
      return !parent || !["initial", "stable"].includes(parent.status) || parent.activeGaps.length > 0;
    })).map(item => ({
      competencyId: item.id,
      missingPrerequisites: (item.prerequisites || []).filter(id => {
        const parent = competencies.find(candidate => candidate.id === id);
        return !parent || !["initial", "stable"].includes(parent.status) || parent.activeGaps.length > 0;
      }),
    })),
    summary: insights.summary,
  };
  const goalProgress = goals.filter(goal => goal.status !== "cancelled").map(goal => {
    const targetIds = goal.competencyIds?.length ? goal.competencyIds :
      competencies.filter(item => (goal.topicIds || []).includes(item.topicId)).map(item => item.id);
    const rows = targetIds.map(id => competencies.find(item => item.id === id)).filter(Boolean);
    const stableCount = rows.filter(item => item.status === "stable" && !item.activeGaps.length).length;
    return {
      goalId: goal.goalId,
      title: goal.title,
      stableCount,
      targetCount: rows.length,
      progress: rows.length ? Math.round(stableCount / rows.length * 100) : 0,
      remaining: rows.filter(item => item.status !== "stable" || item.activeGaps.length).map(item => item.id),
      status: rows.length && stableCount === rows.length ? "ready-to-complete" : "in-progress",
    };
  });
  return {
    generatedAt: current.toISOString(),
    preferences: normalizeLearnerPreferences(preferences || {}),
    goals: goalProgress,
    mastery,
    behavior,
    growth: {
      recentEvents: recentGrowth,
      recentActivityAt: events.map(event => event.at).filter(Boolean).sort().at(-1) || null,
      evidenceLast7Days: events.filter(event => Date.parse(event.at) >= last7Days &&
        ["completed", "assessment_passed"].includes(event.type)).length,
      activeGoalCount: activeGoals.length,
    },
    evidenceRefs: {
      mastery: competencies.flatMap(item => item.evidence.map(event => event.id)).slice(-100),
      gaps: mastery.activeGaps.flatMap(item => item.evidenceRefs || []).slice(-100),
      recent: recentGrowth.map(item => item.eventId),
    },
  };
}

export const LEARNER_PROFILE_DEFAULTS = DEFAULT_PREFERENCES;
