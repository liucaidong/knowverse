import {
  deriveLearningInsights,
  getOpenGapObservationEventIds,
} from "./learning-progress.mjs";
import { deriveReviewSchedules, SPACED_REPETITION_VERSION } from "./spaced-repetition-engine.mjs";
import { analyzeWeaknessTrends, deriveForgettingRisks, diagnoseLearningState, forecastLearningGoals, RISK_ENGINE_VERSION } from "./learning-risk-engine.mjs";
import { rankNextBestActions, NEXT_BEST_ACTION_VERSION } from "./next-best-action.mjs";
import { getLearningRepository } from "./backend/learning-repository.mjs";
import { createLearningStrategyEngine, LEARNING_STRATEGY_VERSION } from "./learning-strategy-engine.mjs";

export const PROACTIVE_PROJECTION_TYPE = "proactive_learning_projection";
export const PROACTIVE_PROJECTION_KEY = "current";
export const PROACTIVE_PROJECTION_SCHEMA = 3;
const PROACTIVE_ENGINE_VERSION = 3;
const HOUR_MS = 3_600_000;

function stableHash(value) {
  const source = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function latestEvidence(events) {
  return events.filter(item => ["assessment_passed", "completed", "attempt"].includes(item.type))
    .filter(item => Number.isFinite(Date.parse(item.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]?.at || null;
}

function eventFingerprint(event) {
  return [
    event.id, event.type, event.at, event.competencyIds, event.sessionId, event.sessionType,
    event.variantId, event.challengeId, event.stepId, event.correct, event.gapId,
    event.gapObservationId, event.scorePct, event.hintsUsed, event.attempts, event.independent,
    event.causationEventIds, event.targetGapEventIds,
    event.strategyDecisionId, event.learningIntervention, event.difficultyLevel,
  ];
}

function sourceFingerprint({ events, goals, preferences, tasks, learningMap, challengeRegistry, strategyProfile, now }) {
  const hourBucket = Math.floor(now.getTime() / HOUR_MS);
  const source = {
    algorithm: [PROACTIVE_ENGINE_VERSION, SPACED_REPETITION_VERSION, RISK_ENGINE_VERSION,
      NEXT_BEST_ACTION_VERSION, LEARNING_STRATEGY_VERSION],
    hourBucket,
    strategy: strategyProfile ? [
      strategyProfile.profileRevision, strategyProfile.mode, strategyProfile.sourceFingerprint,
      strategyProfile.parameters, strategyProfile.recommendation,
    ] : null,
    events: events.map(eventFingerprint).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    goals: goals.map(item => [
      item.goalId, item.revision, item.status, item.targetAt, item.priority,
      item.title, item.description, item.acceptanceCriteria, item.topicIds, item.competencyIds,
      item.dailyMinutes,
    ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    preferences: {
      dailyMinutes: preferences.dailyMinutes, weeklyDays: preferences.weeklyDays,
      preferredTopicIds: preferences.preferredTopicIds, learningModes: preferences.learningModes,
      personalizationMode: preferences.personalizationMode || "adaptive",
    },
    graph: (learningMap.topics || []).map(topic => [
      topic.id, (topic.competencies || []).map(item => [item.id, item.prerequisites, item.lessonHref, item.challengeHref]),
    ]),
    challengeRegistry: (challengeRegistry.challenges || []).map(item => [
      item.id, item.topicId,
      (item.steps || []).map(step => [step.id, step.competencyIds, step.gapIds, step.type]),
    ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    tasks: tasks.map(item => [
      item.taskId, item.revision, item.status, item.taskType, item.competencyId,
      item.gapId, item.dueAt, item.completedAt, item.estimatedMinutes, item.timeSpentSeconds,
    ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  };
  return stableHash(source);
}

function safeProjection(payload) {
  return Boolean(payload && payload.schemaVersion === PROACTIVE_PROJECTION_SCHEMA &&
    payload.algorithmVersions?.spacedRepetition === SPACED_REPETITION_VERSION &&
    payload.algorithmVersions?.risk === RISK_ENGINE_VERSION &&
    payload.algorithmVersions?.nextBestAction === NEXT_BEST_ACTION_VERSION &&
    payload.algorithmVersions?.learningStrategy === LEARNING_STRATEGY_VERSION &&
    typeof payload.sourceFingerprint === "string" &&
    Array.isArray(payload.schedules) && Array.isArray(payload.risks) &&
    Array.isArray(payload.nextBestActions) && Array.isArray(payload.timeline));
}

const TIMELINE_EVENT_LABELS = Object.freeze({
  attempt: "挑战作答",
  assessment_passed: "评估通过",
  completed: "学习活动完成",
  review_started: "开始复习",
  hint: "查看提示",
  hint_revealed: "查看提示",
  learning_goal_created: "创建学习目标",
  learning_goal_updated: "更新学习目标",
  learning_goal_paused: "暂停学习目标",
  learning_goal_resumed: "恢复学习目标",
  learning_goal_completed: "完成学习目标",
  learning_goal_cancelled: "取消学习目标",
  learning_goal_deleted: "归档学习目标",
  learning_plan_generated: "生成学习计划提案",
  learning_plan_accepted: "接受学习计划",
  learning_plan_rejected: "拒绝学习计划",
  learning_plan_superseded: "替换旧计划提案",
  learning_task_created: "创建学习任务",
  learning_task_in_progress: "开始执行任务",
  learning_task_paused: "暂停学习任务",
  learning_task_completed: "完成学习任务",
  learning_task_failed: "任务验证失败",
  learning_task_skipped: "跳过学习任务",
  learning_task_cancelled: "取消学习任务",
  learning_strategy_calibrated: "调整个性化学习策略",
  learning_strategy_feedback: "收到学习策略反馈",
});

function buildLearningTimeline(events, risks, schedules, now) {
  const scheduleMap = new Map(schedules.map(item => [item.competencyId, item]));
  const rows = (events || [])
    .filter(event => TIMELINE_EVENT_LABELS[event.type] && Number.isFinite(Date.parse(event.at)))
    .map(event => {
      const competencyId = event.competencyIds?.[0] || null;
      const schedule = competencyId ? scheduleMap.get(competencyId) : null;
      let detail = event.reason || event.stepTitle || event.challengeTitle || "";
      if (event.type === "attempt") detail = event.correct === false
        ? "本次答题未通过" + (event.gapId ? "，形成薄弱点 " + event.gapId : "")
        : "记录一次作答" + (event.hintsUsed ? "，使用提示 " + event.hintsUsed + " 次" : "");
      if (event.type === "assessment_passed") {
        detail = "得分 " + (Number.isFinite(Number(event.scorePct)) ? Number(event.scorePct) + " 分" : "通过") +
          (event.independent === false || Number(event.hintsUsed) > 0 ? " · 辅助验证" : " · 独立验证");
      }
      if (event.taskStatus) detail += (detail ? " · " : "") + "任务状态 " + event.taskStatus;
      return {
        id: event.id,
        source: "event",
        type: event.type,
        at: event.at,
        title: TIMELINE_EVENT_LABELS[event.type],
        detail: String(detail || "").slice(0, 240),
        topicId: event.topicId || null,
        competencyId,
        competencyTitle: schedule?.competencyTitle || event.stepTitle || null,
        goalId: event.goalId || null,
        planId: event.planId || null,
        taskId: event.taskId || null,
        scorePct: Number.isFinite(Number(event.scorePct)) ? Number(event.scorePct) : null,
        evidenceRefs: [event.id],
      };
    })
    .sort((a,b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 40);

  const warnings = (risks || [])
    .filter(item => ["high", "critical"].includes(item.level))
    .sort((a,b) => b.score - a.score)
    .slice(0, 5)
    .map(item => {
      const schedule = scheduleMap.get(item.competencyId);
      return {
        id: "risk-snapshot:" + item.competencyId + ":" + new Date(now).toISOString(),
        source: "derived",
        type: "risk_snapshot",
        at: new Date(now).toISOString(),
        title: item.level === "critical" ? "系统识别到关键复习风险" : "系统识别到高复习风险",
        detail: (schedule?.competencyTitle || item.competencyId) + " · " + (item.reasons || []).join("；"),
        competencyId: item.competencyId,
        competencyTitle: schedule?.competencyTitle || item.competencyId,
        evidenceRefs: item.evidenceRefs || [],
      };
    });
  return [...rows, ...warnings]
    .sort((a,b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 45);
}

function latestTaskForAction(action, tasks) {
  return tasks.find(task => task.taskId === action.taskId) || null;
}

/** Repository-backed orchestrator for rebuildable proactive learning projections. */
export function createProactiveLearningEngine(options = {}) {
  const repositoryPromise = options.repository ? Promise.resolve(options.repository) : getLearningRepository();
  const { learningMap, challengeRegistry } = options;
  const goalManager = options.goalManager || null;
  const taskOrchestrator = options.taskOrchestrator || null;
  const profileStore = options.profileStore || null;
  const strategyEngine = options.strategyEngine || createLearningStrategyEngine({
    repository: options.repository, profileStore,
  });
  let refreshPromise = null;
  let refreshAgain = false;
  let queuedRefreshOptions = null;

  async function refresh(options = {}) {
    if (refreshPromise) {
      refreshAgain = true;
      queuedRefreshOptions = { ...(queuedRefreshOptions || {}), ...options };
      return refreshPromise;
    }
    let activeOptions = { now: new Date(), createTasks: true, force: false, ...options };
    refreshPromise = (async () => {
      let result;
      do {
        refreshAgain = false;
        result = await calculate(activeOptions);
        if (refreshAgain && queuedRefreshOptions) {
          activeOptions = { ...activeOptions, ...queuedRefreshOptions };
          queuedRefreshOptions = null;
        }
      } while (refreshAgain);
      return result;
    })().finally(() => {
      refreshPromise = null;
      refreshAgain = false;
      queuedRefreshOptions = null;
    });
    return refreshPromise;
  }

  async function calculate({ now, createTasks, force, casRetry = 0 }) {
    const current = now instanceof Date ? new Date(now) : new Date(now);
    if (!Number.isFinite(current.getTime())) throw new TypeError("now must be a valid date.");
    if (!learningMap?.topics || !challengeRegistry?.challenges) {
      throw new TypeError("Learning Map and challenge registry are required.");
    }
    const repository = await repositoryPromise;
    const [initialEvents, goals, preferences, allTasks, projectionRow] = await Promise.all([
      repository.events.list(),
      goalManager?.list?.() || Promise.resolve([]),
      profileStore?.loadPreferences?.() || Promise.resolve({ dailyMinutes: 25, weeklyDays: 5, preferredTopicIds: [] }),
      taskOrchestrator?.list?.() || Promise.resolve([]),
      repository.documents.get(PROACTIVE_PROJECTION_TYPE, PROACTIVE_PROJECTION_KEY),
    ]);
    const strategyProfile = await strategyEngine.refresh({
      events: initialEvents, mode: preferences.personalizationMode || "adaptive", now: current,
    });
    // The calibration and its audit event are committed atomically. Re-read the append-only log
    // so the projection fingerprint and timeline describe the same committed source snapshot.
    const events = await repository.events.list();

    const fingerprint = sourceFingerprint({
      events, goals, preferences, tasks: allTasks, learningMap, challengeRegistry, strategyProfile, now: current,
    });
    const cached = projectionRow?.payload;
    const computedAt = Date.parse(cached?.computedAt || "");
    const crossedScheduleBoundary = Number.isFinite(computedAt) && current.getTime() > computedAt &&
      (cached?.schedules || []).some(item => {
        const dueAt = Date.parse(item.dueAt || "");
        if (!Number.isFinite(dueAt)) return false;
        const overdueAt = dueAt + Math.max(0, Number(item.intervalDays) || 0) * 86_400_000;
        return (dueAt > computedAt && dueAt <= current.getTime()) ||
          (overdueAt > computedAt && overdueAt <= current.getTime());
      });
    if (!force && !crossedScheduleBoundary && safeProjection(cached) && cached.sourceFingerprint === fingerprint) {
      return { ...cached, localRevision: projectionRow.localRevision, cacheHit: true, taskCreation: [] };
    }

    let insights = deriveLearningInsights(learningMap, challengeRegistry, { events }, current);
    const schedules = deriveReviewSchedules({ learningMap, events, insights, strategyProfile, now: current });
    const risks = deriveForgettingRisks({ schedules, insights, learningMap, now: current });
    const trends = analyzeWeaknessTrends({ events, insights, learningMap, now: current });
    const forecasts = forecastLearningGoals({
      goals, learningMap, schedules, insights, events, preferences, tasks: allTasks, now: current,
    });

    const taskCreation = [];
    if (createTasks && taskOrchestrator?.ensureScheduledReviewTask) {
      const competencyById = new Map((learningMap.topics || []).flatMap(topic =>
        (topic.competencies || []).map(item => [item.id, { ...item, topicId: topic.id, topicTitle: topic.title }])));
      const stateById = new Map(insights.competencyInsights.map(item => [item.id, item]));
      for (const schedule of schedules.filter(item => item.isDue)) {
        const competency = competencyById.get(schedule.competencyId);
        if (!competency) continue;
        const state = stateById.get(schedule.competencyId);
        const gaps = state?.activeGaps || [];
        if (gaps.length) {
          for (const gap of gaps) {
            const evidenceRefs = getOpenGapObservationEventIds({ events }, schedule.competencyId, gap.id);
            if (!evidenceRefs.length) continue;
            const gapEvidenceAt = events
              .filter(event => evidenceRefs.includes(event.id))
              .map(event => Date.parse(event.at))
              .filter(Number.isFinite)
              .sort((a, b) => b - a)[0];
            const deterministicAt = new Date(gapEvidenceAt || Date.parse(schedule.dueAt) || current.getTime());
            const linkedGoalIds = goals.filter(goal => goal.status === "active" &&
              ((goal.competencyIds || []).includes(schedule.competencyId) ||
                (goal.topicIds || []).includes(competency.topicId)))
              .map(goal => goal.goalId).sort();
            const task = await taskOrchestrator.ensureScheduledReviewTask({
              competencyId: schedule.competencyId,
              competencyTitle: competency.title,
              topicId: competency.topicId,
              topicTitle: competency.topicTitle,
              linkedGoalIds,
              gapId: gap.id,
              gapLabel: gap.label,
              lastFailureVariantId: gap.lastFailureVariantId,
              dueAt: deterministicAt,
              scheduleStatus: "relearning",
              estimatedMinutes: 12,
              evidenceRefs,
              strategyDecisionId: strategyProfile.active ? strategyProfile.lastDecision?.decisionId || null : null,
              strategyProfileRevision: strategyProfile.profileRevision || 0,
              learningIntervention: strategyProfile.recommendation?.intervention || "active-recall",
              strategyInstruction: strategyProfile.active ? strategyProfile.lastDecision?.reasons?.join("；") || null : null,
              difficultyLevel: strategyProfile.recommendation?.difficulty || "maintain",
              strategyEvidenceRefs: strategyProfile.active ? strategyProfile.lastDecision?.evidenceRefs || [] : [],
              at: deterministicAt,
            });
            if (task) taskCreation.push(task);
          }
        } else {
          const linkedGoalIds = goals.filter(goal => goal.status === "active" &&
            ((goal.competencyIds || []).includes(schedule.competencyId) ||
              (goal.topicIds || []).includes(competency.topicId)))
            .map(goal => goal.goalId).sort();
          const task = await taskOrchestrator.ensureScheduledReviewTask({
            competencyId: schedule.competencyId,
            competencyTitle: competency.title,
            topicId: competency.topicId,
            topicTitle: competency.topicTitle,
            linkedGoalIds,
            gapId: null,
            dueAt: schedule.dueAt,
            scheduleStatus: schedule.status,
            estimatedMinutes: 8,
            evidenceRefs: schedule.evidenceRefs,
            strategyDecisionId: strategyProfile.active ? strategyProfile.lastDecision?.decisionId || null : null,
            strategyProfileRevision: strategyProfile.profileRevision || 0,
            learningIntervention: strategyProfile.recommendation?.intervention || "active-recall",
            strategyInstruction: strategyProfile.active ? strategyProfile.lastDecision?.reasons?.join("；") || null : null,
            difficultyLevel: strategyProfile.recommendation?.difficulty || "maintain",
            strategyEvidenceRefs: strategyProfile.active ? strategyProfile.lastDecision?.evidenceRefs || [] : [],
            at: new Date(schedule.dueAt || current),
          });
          if (task) taskCreation.push(task);
        }
      }
    }

    let tasks = taskOrchestrator ? await taskOrchestrator.list() : allTasks;
    if (taskCreation.length) {
      // Task creation is an orchestration fact, not mastery evidence. Reload the
      // append-only log so the cache fingerprint describes the exact committed state.
      const refreshed = await repository.events.list();
      const changed = refreshed.length !== events.length;
      if (changed) insights = deriveLearningInsights(learningMap, challengeRegistry, { events: refreshed }, current);
      const finalFingerprint = sourceFingerprint({
        events: refreshed, goals, preferences, tasks, learningMap, challengeRegistry, strategyProfile, now: current,
      });
      return persistProjection({
        repository, projectionRow, current, fingerprint: finalFingerprint,
        events: refreshed, goals, preferences, tasks, insights, schedules, risks, trends, forecasts,
        strategyProfile, taskCreation, casRetry,
      });
    }

    return persistProjection({
      repository, projectionRow, current, fingerprint,
      events, goals, preferences, tasks, insights, schedules, risks, trends, forecasts,
      strategyProfile, taskCreation, casRetry,
    });
  }

  async function persistProjection(context) {
    const {
      repository, projectionRow, current, fingerprint, events, goals, preferences, tasks,
      insights, schedules, risks, trends, forecasts, strategyProfile, taskCreation, casRetry = 0,
    } = context;
    const diagnostics = diagnoseLearningState({
      events, goals, tasks, schedules, risks, trends, goalForecasts: forecasts,
      insights, preferences, now: current,
    });
    const nextBestActions = rankNextBestActions({
      learningMap, insights, schedules, risks, trends, goals, tasks, preferences, now: current,
    }).map(action => {
      const task = latestTaskForAction(action, tasks);
      if (task) return { ...action, taskStatus: task.status, taskId: task.taskId, href: task.href || action.href };
      return action;
    });

    const payload = {
      schemaVersion: PROACTIVE_PROJECTION_SCHEMA,
      engineVersion: PROACTIVE_ENGINE_VERSION,
      algorithmVersions: {
        spacedRepetition: SPACED_REPETITION_VERSION,
        risk: RISK_ENGINE_VERSION,
        nextBestAction: NEXT_BEST_ACTION_VERSION,
        learningStrategy: LEARNING_STRATEGY_VERSION,
      },
      strategyProfile,
      strategyEffectiveness: strategyProfile?.effectiveness || null,
      sourceFingerprint: fingerprint,
      sourceEventCount: events.length,
      latestEvidenceAt: latestEvidence(events),
      computedAt: current.toISOString(),
      summary: {
        dueCount: schedules.filter(item => item.isDue || item.status === "overdue").length,
        overdueCount: schedules.filter(item => item.status === "overdue").length,
        highRiskCount: risks.filter(item => ["high", "critical"].includes(item.level)).length,
        activeGapCount: insights.gaps.length,
        activeGoalCount: goals.filter(item => item.status === "active").length,
        taskBacklogCount: tasks.filter(item => ["ready","in_progress","paused","failed"].includes(item.status)).length,
      },
      schedules: schedules.slice(0, 300),
      risks: risks.slice(0, 300),
      trends: trends.slice(0, 300),
      diagnostics: diagnostics.slice(0, 30),
      goalForecasts: forecasts.slice(0, 50),
      nextBestActions: nextBestActions.slice(0, 20),
      timeline: buildLearningTimeline(events, risks, schedules, current),
    };


    if (!safeProjection(payload)) throw new Error("Proactive projection failed schema validation.");
    const previous = await repository.documents.get(PROACTIVE_PROJECTION_TYPE, PROACTIVE_PROJECTION_KEY);
    if (previous?.payload?.sourceFingerprint === fingerprint && safeProjection(previous.payload)) {
      return { ...previous.payload, localRevision: previous.localRevision, cacheHit: true, taskCreation };
    }
    try {
      await repository.commit({
        documents: [{
          type: PROACTIVE_PROJECTION_TYPE,
          key: PROACTIVE_PROJECTION_KEY,
          payload,
          expectedLocalRevision: Number(previous?.localRevision) || 0,
        }],
      });
    } catch (error) {
      const latest = await repository.documents.get(PROACTIVE_PROJECTION_TYPE, PROACTIVE_PROJECTION_KEY);
      if (latest?.payload?.sourceFingerprint === fingerprint && safeProjection(latest.payload)) {
        return { ...latest.payload, localRevision: latest.localRevision, cacheHit: true, taskCreation };
      }
      const isRevisionConflict = /文档版本冲突|revision conflict|compare-and-swap|CAS/i.test(error?.message || "");
      if (isRevisionConflict && casRetry < 2) {
        return calculate({
          now: current,
          createTasks: true,
          force: true,
          casRetry: casRetry + 1,
        });
      }
      throw error;
    }
    const stored = await repository.documents.get(PROACTIVE_PROJECTION_TYPE, PROACTIVE_PROJECTION_KEY);
    return { ...payload, localRevision: stored?.localRevision || 1, cacheHit: false, taskCreation };
  }

  async function getCurrent() {
    const repository = await repositoryPromise;
    const row = await repository.documents.get(PROACTIVE_PROJECTION_TYPE, PROACTIVE_PROJECTION_KEY);
    return row && safeProjection(row.payload)
      ? { ...row.payload, localRevision: row.localRevision }
      : null;
  }

  async function feedback(input) {
    await strategyEngine.feedback(input);
    return refresh({ force: true });
  }

  return Object.freeze({ refresh, getCurrent, feedback });
}
