import { deriveLearningInsights } from "./learning-progress.mjs";
import {
  getLearningRepository,
  isLearningRepositoryAvailable,
} from "./backend/learning-repository.mjs";

const PREFERENCES_KEY = "knowverse:learning-plan:preferences";
const DEFAULT_PREFERENCES = Object.freeze({ dailyMinutes: 25, focusTopicId: "all" });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clone = value => JSON.parse(JSON.stringify(value));
const validDate = value => value instanceof Date ? Number.isFinite(value.getTime()) : Number.isFinite(Date.parse(value));
const dateKey = value => {
  const date = value instanceof Date ? value : new Date(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};
const daysUntil = (value, now) => (Date.parse(value) - now.getTime()) / 86_400_000;

function normalizePreferences(value = {}) {
  const minutes = Number(value.dailyMinutes);
  const focusTopicId = typeof value.focusTopicId === "string" ? value.focusTopicId : "all";
  return {
    dailyMinutes: Number.isInteger(minutes) ? clamp(minutes, 10, 240) : DEFAULT_PREFERENCES.dailyMinutes,
    focusTopicId: focusTopicId || "all",
  };
}

export function createLearningPlanPreferencesStore(options = {}) {
  const repositoryPromise = options.repository
    ? Promise.resolve(options.repository)
    : getLearningRepository();
  return {
    available: isLearningRepositoryAvailable(),
    async load() {
      const repository = await repositoryPromise;
      const document = await repository.documents.get("plan_preferences", "preferences");
      return normalizePreferences(document?.payload?._deleted ? {} : document?.payload || {});
    },
    async save(value) {
      const normalized = normalizePreferences(value);
      if (!isLearningRepositoryAvailable()) throw new Error("当前浏览器不支持 IndexedDB，学习偏好未保存。");
      const repository = await repositoryPromise;
      const current = await repository.documents.get("plan_preferences", "preferences");
      await repository.commit({
        documents: [{
          type: "plan_preferences",
          key: "preferences",
          payload: normalized,
          expectedLocalRevision: Number(current?.localRevision) || 0,
        }],
      });
      return true;
    },
  };
}

function planActivity(snapshot, today) {
  const started = new Set();
  const completed = new Set();
  const completedLearningCompetencies = new Set();
  let completedMinutes = 0;
  for (const event of snapshot?.events || []) {
    if (typeof event.actionId !== "string") continue;
    const legacyPlanEvent = event.sessionType === "planning";
    const orchestratedTaskEvent = event.sessionType === "orchestration";
    if (!legacyPlanEvent && !orchestratedTaskEvent) continue;
    const wasCompleted = event.type === "plan_action_completed" || event.type === "learning_task_completed";
    const wasStarted = event.type === "plan_action_started" || event.type === "learning_task_in_progress";
    if (wasCompleted && (event.planActionType === "learn" || event.taskType === "read")) {
      for (const competencyId of event.competencyIds || []) completedLearningCompetencies.add(competencyId);
    }
    // Completion is terminal for this action regardless of which calendar day
    // it was actually completed. Budget accounting remains scoped to planDate.
    if (wasCompleted) completed.add(event.actionId);
    if (event.planDate !== today) continue;
    if (wasStarted) started.add(event.actionId);
    if (wasCompleted) {
      completedMinutes += Number.isFinite(Number(event.estimatedMinutes)) ? Math.max(0, Number(event.estimatedMinutes)) : 0;
    }
  }
  return { started, completed, completedLearningCompetencies, completedMinutes };
}

function checkpointResource(competency, works, checkpointRegistry, usedVariants) {
  const checkpoints = new Map((checkpointRegistry?.checkpoints || []).map(item => [item.id, item]));
  const candidates = (works?.works || []).filter(work =>
    work.status === "live" &&
    work.learning?.competencyIds?.includes(competency.id) &&
    work.learning?.assessment?.type === "checkpoint"
  ).filter(work => {
    const checkpoint = checkpoints.get(work.learning.assessment.checkpointId);
    return checkpoint && checkpoint.competencyId === competency.id && !usedVariants.has(checkpoint.id);
  });
  const order = { lab: 0, gallery: 1, puzzles: 2 };
  candidates.sort((a, b) => (order[a.pillar] ?? 9) - (order[b.pillar] ?? 9));
  const work = candidates[0];
  if (!work) return null;
  return {
    href: work.href,
    resourceTitle: work.title,
    resourceLabel: work.pillar === "lab" ? "进入实验并完成知识检查" :
      work.pillar === "gallery" ? "进入知识展厅并完成检查" : "进入解谜世界并完成检查",
    resourceType: "checkpoint",
    variantId: work.learning.assessment.checkpointId,
    workId: work.id,
  };
}

function challengeResource(competency, works, challengeRegistry, usedVariants) {
  const work = (works?.works || []).find(item =>
    item.status === "live" &&
    item.learning?.competencyIds?.includes(competency.id) &&
    item.learning?.assessment?.type === "challenge"
  );
  if (work) {
    const challengeId = work.learning.assessment.challengeId;
    const challenge = (challengeRegistry?.challenges || []).find(item => item.id === challengeId);
    const step = challenge?.steps?.find(item => item.competencyIds?.includes(competency.id));
    const variantId = challengeId + ":" + (step?.id || competency.id);
    if (usedVariants?.has(variantId)) return null;
    return {
      href: work.href,
      resourceTitle: work.title,
      resourceLabel: "进入结构化挑战",
      resourceType: "challenge",
      variantId,
      workId: work.id,
    };
  }
  if (competency.challengeHref && !competency.challengeHref.includes("review/")) return {
    href: competency.challengeHref,
    resourceTitle: "知识挑战",
    resourceLabel: "进入挑战",
    resourceType: "challenge",
    variantId: "challenge:" + competency.id,
    workId: null,
  };
  return null;
}

function practiceResource(competency, works, checkpointRegistry, challengeRegistry, usedVariants) {
  return checkpointResource(competency, works, checkpointRegistry, usedVariants) ||
    challengeResource(competency, works, challengeRegistry, usedVariants) ||
    (competency.labHref && competency.labHref !== "./lab/" ? {
      href: competency.labHref,
      resourceTitle: "原理实验",
      resourceLabel: "进入原理实验",
      resourceType: "lab",
      variantId: "lab:" + competency.id,
      workId: null,
    } : null);
}

function makeAction({ today, type, competency, gapId = null, minutes, priority, reasons, resource, state, sourceEvidenceRefs = [] }) {
  const resourceKey = gapId || resource?.variantId || resource?.workId || type;
  const actionId = [today, type, competency.id, resourceKey].join(":");
  return {
    id: actionId,
    actionId,
    planDate: today,
    type,
    competencyId: competency.id,
    competencyTitle: competency.title,
    topicId: competency.topicId,
    topicTitle: competency.topicTitle,
    gapId,
    title: type === "repair" ? "纠正一个具体概念误区" :
      type === "review" ? "进行间隔复习" :
      type === "learn" ? "建立知识基础" :
      type === "practice" ? "进入实验并验证理解" :
      "完成一次独立验证",
    typeLabel: type === "repair" ? "薄弱点纠正" :
      type === "review" ? "间隔复习" :
      type === "learn" ? "学习新知识" :
      type === "practice" ? "实验练习" : "独立验证",
    estimatedMinutes: minutes,
    priority: Math.round(priority),
    priorityReasons: reasons,
    masteryScore: state?.masteryScore ?? null,
    confidenceScore: state?.confidenceScore ?? 0,
    status: state?.status || "unverified",
    href: resource?.href || competency.lessonHref || competency.topicHref || "./knowledge/",
    resourceTitle: resource?.resourceTitle || competency.title,
    resourceLabel: resource?.resourceLabel || "打开对应课程",
    resourceType: resource?.resourceType || "lesson",
    variantId: resource?.variantId || null,
    workId: resource?.workId || null,
    sourceEvidenceRefs: [...new Set([
      ...(Array.isArray(state?.evidence) ? state.evidence.map(item => item.id) : []),
      ...(Array.isArray(sourceEvidenceRefs) ? sourceEvidenceRefs : []),
    ].filter(value => typeof value === "string" && value.length > 0))].slice(-20),
  };
}

/**
 * Builds a deterministic, explainable study plan from the existing mastery graph and event log.
 * Exploration/plan events are never considered mastery evidence by deriveLearningInsights().
 */
export function buildAdaptiveLearningPlan(options = {}) {
  const now = validDate(options.now) ? (options.now instanceof Date ? new Date(options.now) : new Date(options.now)) : new Date();
  const today = dateKey(now);
  const preferences = normalizePreferences(options.preferences);
  const snapshot = options.snapshot || { events: [] };
  const insights = deriveLearningInsights(options.learningMap || { topics: [], gaps: [] },
    options.challengeRegistry || { challenges: [] }, snapshot, now);
  const allCompetencies = insights.competencyInsights;
  const stateById = new Map(allCompetencies.map(item => [item.id, item]));
  const reviewScheduleById = new Map((options.reviewSchedules || []).map(item => [item.competencyId, item]));
  const existingTaskByCompetency = new Map((options.existingTasks || [])
    .filter(task => !["completed", "skipped", "cancelled"].includes(task.status))
    .map(task => [task.competencyId, task]));
  const definitions = new Map(allCompetencies.map(item => [item.id, item]));
  const activity = planActivity(snapshot, today);
  const usedVariantsByCompetency = new Map();
  for (const state of allCompetencies) usedVariantsByCompetency.set(state.id, new Set(state.evidence.map(item => item.variantId).filter(Boolean)));

  const childrenById = new Map(allCompetencies.map(item => [item.id, new Set()]));
  for (const item of allCompetencies) {
    for (const prerequisite of item.prerequisites || []) {
      if (childrenById.has(prerequisite)) childrenById.get(prerequisite).add(item.id);
    }
  }
  const descendants = new Map();
  for (const definition of allCompetencies) {
    const seen = new Set();
    const pending = [...(childrenById.get(definition.id) || [])];
    while (pending.length) {
      const child = pending.pop();
      if (seen.has(child)) continue;
      seen.add(child);
      for (const descendant of childrenById.get(child) || []) pending.push(descendant);
    }
    descendants.set(definition.id, seen.size);
  }
  const futureDue = allCompetencies.map(item => {
    const schedule = reviewScheduleById.get(item.id);
    return schedule ? { ...item, nextReviewAt: schedule.dueAt } : item;
  }).filter(item => item.nextReviewAt &&
    Date.parse(item.nextReviewAt) > now.getTime() &&
    !(reviewScheduleById.get(item.id)?.isDue ?? item.isDue))
    .sort((a, b) => Date.parse(a.nextReviewAt) - Date.parse(b.nextReviewAt));
  const candidates = [];
  const blocked = [];
  const strategyProfile = options.strategyProfile || null;
  const strategyActive = strategyProfile?.mode === "adaptive" && strategyProfile?.active === true;
  const strategyDifficulty = strategyActive ? strategyProfile.recommendation?.difficulty || "maintain" : "maintain";
  const difficultyFor = competencyId => {
    if (!strategyActive) return "maintain";
    const perCompetency = strategyProfile.recommendation?.difficultyByCompetency || {};
    return Object.keys(perCompetency).length
      ? perCompetency[competencyId] || "maintain"
      : strategyDifficulty;
  };
  const strategyIntervention = strategyActive ? strategyProfile.recommendation?.intervention || "active-recall" : "active-recall";
  const strategyInstruction = strategyIntervention === "guided-retrieval"
    ? "先独立尝试；确有需要时逐级查看提示，之后换一个变体无提示验证。"
    : strategyIntervention === "spaced-retrieval"
      ? "本轮重点是主动回忆而非重读，失败后按较短间隔再次验证。"
      : strategyIntervention === "transfer-challenge"
        ? "优先使用未见过的题型或检查点，验证能否迁移应用。"
        : "先主动回忆，再通过独立练习验证理解。";

  function prerequisitesReady(definition) {
    const unmet = new Map();
    const visited = new Set();
    function inspect(prerequisiteId) {
      if (visited.has(prerequisiteId)) return;
      visited.add(prerequisiteId);
      const prerequisite = stateById.get(prerequisiteId);
      if (!prerequisite || !["initial", "stable"].includes(prerequisite.status) || prerequisite.activeGaps.length > 0) {
        unmet.set(prerequisiteId, prerequisite?.title || "未知前置知识");
        return;
      }
      for (const ancestorId of prerequisite.prerequisites || []) inspect(ancestorId);
    }
    for (const prerequisiteId of definition.prerequisites || []) inspect(prerequisiteId);
    if (unmet.size) {
      blocked.push({
        competencyId: definition.id,
        competencyTitle: definition.title,
        topicId: definition.topicId,
        blockedBy: [...unmet.values()],
      });
      return false;
    }
    return true;
  }

  for (const definition of allCompetencies) {
    const state = stateById.get(definition.id);
    const reviewSchedule = reviewScheduleById.get(definition.id);
    const existingTask = existingTaskByCompetency.get(definition.id);
    if (existingTask) continue;
    const activeGaps = state.activeGaps || [];
    const focusBoost = preferences.focusTopicId !== "all" && preferences.focusTopicId === definition.topicId ? 12 : 0;
    const downstream = descendants.get(definition.id) || 0;
    const competencyStrategyDifficulty = difficultyFor(definition.id);

    if (activeGaps.length) {
      for (const gap of activeGaps) {
        const resource = {
          href: "./review/?competencyId=" + encodeURIComponent(definition.id) + "&gapId=" + encodeURIComponent(gap.id),
          resourceTitle: gap.label,
          resourceLabel: "开始针对性复习",
          resourceType: "review",
          variantId: gap.verificationVariantId || gap.lastFailureVariantId,
          workId: null,
        };
        const priority = 120 + Math.min(16, Math.max(0, gap.count - 1) * 4) +
          (gap.lifecycle === "pending-verification" ? 10 : gap.lifecycle === "reviewing" ? 5 : 0) +
          Math.min(8, downstream * 2) + focusBoost;
        candidates.push(makeAction({
          today, type: "repair", competency: definition, gapId: gap.id, minutes: 10,
          priority,
          reasons: [
            gap.count > 1 ? "同一误区重复出现 " + gap.count + " 次" : "发现尚未纠正的具体误区",
            gap.lifecycle === "pending-verification" ? "已辅助纠正，必须无提示独立确认" :
              gap.lifecycle === "reviewing" ? "复习已经开始，需要完成验证" : "先纠正错误概念，再继续后续知识",
            downstream ? "该能力影响 " + downstream + " 个下游知识点" : null,
            focusBoost ? "符合当前优先专题" : null,
          ].filter(Boolean),
          resource, state, sourceEvidenceRefs: gap.sourceEvidenceRefs,
        }));
      }
      if (competencyStrategyDifficulty === "scaffold" && definition.lessonHref) {
        const resource = {
          href: definition.lessonHref,
          resourceTitle: definition.title,
          resourceLabel: "补充基础知识讲解",
          resourceType: "lesson",
          variantId: "scaffold-lesson:" + definition.id,
          workId: null,
        };
        const scaffoldAction = makeAction({
          today, type: "learn", competency: definition, minutes: 10,
          priority: 108 + Math.min(8, downstream * 2) + focusBoost,
          reasons: ["独立验证出现跨题型困难，先补充基础解释", "针对性复习仍然优先，基础讲解用于降低后续挑战跨度"],
          resource, state,
        });
        scaffoldAction.strategyCompanion = true;
        candidates.push(scaffoldAction);
      }
      continue;
    }

    if ((reviewSchedule?.isDue ?? state.isDue) && state.evidenceCount) {
      const priority = 92 + Math.min(8, downstream * 2) +
        Math.max(0, 80 - (state.masteryScore || 0)) * 0.12 + focusBoost;
      candidates.push(makeAction({
        today, type: "review", competency: definition, minutes: 8, priority,
        reasons: [
          reviewSchedule?.status === "overdue" ? "已经超过一个完整复习间隔" :
            reviewSchedule?.status === "relearning" ? "进入重新学习状态" : "已达到下一次复习时间",
          state.status === "weak" ? "近期表现偏弱，保持短间隔复习" : "通过间隔复习检查长期保持情况",
          downstream ? "该能力影响 " + downstream + " 个下游知识点" : null,
          focusBoost ? "符合当前优先专题" : null,
        ].filter(Boolean),
        resource: {
          href: "./review/?competencyId=" + encodeURIComponent(definition.id),
          resourceTitle: definition.title,
          resourceLabel: "开始间隔复习",
          resourceType: "review",
          variantId: null,
          workId: null,
        },
        state,
      }));
      continue;
    }

    if (!prerequisitesReady(definition)) continue;

    let action = null;
    if (state.status === "unverified") {
      const learnResource = { href: definition.lessonHref || definition.topicHref, resourceTitle: definition.title, resourceLabel: "打开知识课程", resourceType: "lesson", variantId: "lesson:" + definition.id, workId: null };
      const learnActionId = [today, "learn", definition.id, learnResource.variantId].join(":");
      if (activity.completedLearningCompetencies.has(definition.id) || activity.completed.has(learnActionId)) {
        const resource = practiceResource(definition, options.worksManifest, options.checkpointRegistry, options.challengeRegistry,
          usedVariantsByCompetency.get(definition.id) || new Set());
        if (resource) action = makeAction({
          today, type: "practice", competency: definition, minutes: 15,
          priority: 70 + Math.min(8, downstream * 2) + focusBoost,
          reasons: ["今天的基础学习步骤已标记完成", "下一步用实验、检查点或挑战验证能否独立运用", focusBoost ? "符合当前优先专题" : null].filter(Boolean),
          resource, state,
        });
      } else {
        action = makeAction({
          today, type: "learn", competency: definition, minutes: 12,
          priority: 64 + Math.min(8, downstream * 2) + focusBoost,
          reasons: [
            "该知识点尚无有效掌握证据",
            "前置知识已经满足，可以开始学习",
            downstream ? "这是 " + downstream + " 个下游知识点的前置基础" : null,
            focusBoost ? "符合当前优先专题" : null,
          ].filter(Boolean),
          resource: learnResource, state,
        });
      }
    } else if (["weak", "building"].includes(state.status)) {
      const resource = competencyStrategyDifficulty === "scaffold" && definition.lessonHref
        ? {
            href: definition.lessonHref,
            resourceTitle: definition.title,
            resourceLabel: "补充基础知识讲解",
            resourceType: "lesson",
            variantId: "scaffold-lesson:" + definition.id,
            workId: null,
          }
        : practiceResource(definition, options.worksManifest, options.checkpointRegistry, options.challengeRegistry,
          usedVariantsByCompetency.get(definition.id) || new Set());
      if (resource) action = makeAction({
        today, type: competencyStrategyDifficulty === "scaffold" && definition.lessonHref ? "learn" : "practice",
        competency: definition, minutes: competencyStrategyDifficulty === "scaffold" && definition.lessonHref ? 10 : 15,
        priority: 82 + Math.min(8, downstream * 2) + focusBoost,
        reasons: [
          competencyStrategyDifficulty === "scaffold" && definition.lessonHref
            ? "独立验证显示基础仍需巩固，先补充解释和示例"
            : state.status === "weak" ? "近期证据显示需要补强" : "理解正在建立，需要增加主动练习",
          "后续仍需通过独立挑战产生能力证据",
          focusBoost ? "符合当前优先专题" : null,
        ].filter(Boolean),
        resource, state,
      });
    } else if (["initial", "stable"].includes(state.status) &&
        (competencyStrategyDifficulty === "stretch" || strategyIntervention === "transfer-challenge")) {
      const resource = practiceResource(definition, options.worksManifest, options.checkpointRegistry,
        options.challengeRegistry, usedVariantsByCompetency.get(definition.id) || new Set());
      if (resource) action = makeAction({
        today, type: "validate", competency: definition, minutes: 15,
        priority: (state.status === "stable" ? 66 : 71) + Math.min(8, downstream * 2) + focusBoost,
        reasons: [
          "近期无提示独立表现达到尝试更高难度的门槛",
          "优先选择尚未使用的检查点或挑战变体，检验知识迁移",
          "本次挑战仍需独立完成，不能以提示辅助成功替代掌握证据",
        ],
        resource, state,
      });
    } else if (state.status === "initial" && state.evidenceCount < 2) {
      const resource = checkpointResource(definition, options.worksManifest, options.checkpointRegistry,
        usedVariantsByCompetency.get(definition.id) || new Set()) ||
        challengeResource(definition, options.worksManifest, options.challengeRegistry,
          usedVariantsByCompetency.get(definition.id) || new Set());
      if (resource) action = makeAction({
        today, type: "validate", competency: definition, minutes: 15,
        priority: 68 + focusBoost,
        reasons: [
          "已有初步掌握证据，但样本数量还不足",
          "需要另一个独立场景，避免只记住单一道题",
          focusBoost ? "符合当前优先专题" : null,
        ].filter(Boolean),
        resource, state,
      });
    }
    if (action) candidates.push(action);
  }

  // Multi-goal prioritization is an overlay on the existing deterministic
  // prerequisite/mastery/review engine. Goal state never becomes mastery evidence.
  const activeGoals = (Array.isArray(options.goals) ? options.goals : [])
    .filter(goal => goal && goal.status === "active");
  const goalTargets = activeGoals.map(goal => {
    const competencyIds = new Set(goal.competencyIds || []);
    for (const item of allCompetencies) {
      if ((goal.topicIds || []).includes(item.topicId)) competencyIds.add(item.id);
    }
    return { goal, competencyIds };
  });
  for (const candidate of candidates) {
    const matches = goalTargets.filter(item => item.competencyIds.has(candidate.competencyId));
    candidate.linkedGoalIds = matches.map(item => item.goal.goalId);
    if (!matches.length) continue;
    const best = Math.max(...matches.map(({ goal }) => {
      const priority = clamp(Number(goal.priority) || 3, 1, 5);
      const days = goal.targetAt ? daysUntil(goal.targetAt, now) : Infinity;
      const urgency = days < 0 ? 12 : days <= 7 ? 9 : days <= 30 ? 5 : 0;
      return priority * 3 + urgency;
    }));
    candidate.priority += best;
    candidate.priorityReasons.push(matches.length > 1
      ? "同时推进 " + matches.length + " 个学习目标"
      : "属于当前主动学习目标");
    const soonestDeadline = matches.map(item => item.goal.targetAt).filter(Boolean).sort()[0];
    if (soonestDeadline) candidate.goalDeadline = soonestDeadline;
  }

  const dailyMinutes = preferences.dailyMinutes;
  const selected = [];
  const requestedBudget = Number(options.budgetMinutes);
  const budgetMinutes = Number.isFinite(requestedBudget)
    ? clamp(requestedBudget, 0, 10_000)
    : dailyMinutes;
  const maxActions = Number.isInteger(Number(options.maxActions))
    ? clamp(Number(options.maxActions), 1, 30)
    : 3;
  let remaining = Math.max(0, budgetMinutes - activity.completedMinutes);
  const seenCompetencies = new Set();
  const coveredGoals = new Set();
  const pending = candidates.filter(candidate =>
    !activity.completed.has(candidate.actionId) &&
    !seenCompetencies.has(candidate.competencyId) &&
    candidate.estimatedMinutes <= remaining
  );
  while (pending.length && selected.length < maxActions) {
    // A small coverage bonus prevents a high-priority single goal from
    // monopolizing every slot when another active goal has valid work ready.
    pending.sort((a, b) => {
      const score = item => item.priority + item.linkedGoalIds
        .filter(goalId => !coveredGoals.has(goalId)).length * 7;
      return score(b) - score(a) || a.estimatedMinutes - b.estimatedMinutes ||
        a.topicTitle.localeCompare(b.topicTitle, "zh-CN");
    });
    const index = pending.findIndex(candidate =>
      (!seenCompetencies.has(candidate.competencyId) || candidate.strategyCompanion) &&
      candidate.estimatedMinutes <= remaining
    );
    if (index < 0) break;
    const [candidate] = pending.splice(index, 1);
    selected.push({
      ...candidate,
      completedToday: false,
      startedToday: activity.started.has(candidate.actionId),
      sequence: selected.length + 1,
    });
    if (!candidate.strategyCompanion) seenCompetencies.add(candidate.competencyId);
    candidate.linkedGoalIds.forEach(goalId => coveredGoals.add(goalId));
    remaining -= candidate.estimatedMinutes;
  }

  const strategyDecisionId = strategyActive ? strategyProfile.lastDecision?.decisionId || null : null;
  const interventionFor = action => strategyActive
    ? strategyProfile.recommendation?.intervention || "active-recall"
    : action.type === "repair" ? "targeted-repair"
      : action.type === "review" ? "active-recall"
        : action.type === "learn" ? "worked-example"
          : action.type === "practice" ? "stepwise-practice" : "transfer-challenge";
  const personalizedActions = selected.map(action => ({
    ...action,
    strategyDecisionId,
    strategyProfileRevision: strategyProfile?.profileRevision || 0,
    learningIntervention: interventionFor(action),
    strategyInstruction,
    difficultyLevel: strategyActive
      ? strategyProfile.recommendation?.difficultyByCompetency?.[action.competencyId] ||
        strategyProfile.recommendation?.difficulty || "maintain"
      : "maintain",
    strategyEvidenceRefs: strategyActive ? (strategyProfile.lastDecision?.evidenceRefs || []).slice(0, 12) : [],
  }));
  const completedToday = [...activity.completed];
  const nextScheduledAt = futureDue[0]?.nextReviewAt || null;
  const first = selected[0] || null;
  const headline = first
    ? first.type === "repair" ? "先纠正最影响后续学习的概念误区" :
      first.type === "review" ? "先完成已经到期的间隔复习" :
      first.type === "learn" ? "先建立可继续向上学习的知识基础" :
      first.type === "validate" ? "把初步理解转化为独立证据" :
      "通过主动练习巩固薄弱知识"
    : completedToday.length
      ? activity.completedMinutes >= dailyMinutes
        ? "今日学习时间预算已用完"
        : "今天的计划步骤已完成，剩余时间不足以安排另一个完整行动"
      : nextScheduledAt
        ? "当前知识保持良好，下一次复习尚未到期"
        : allCompetencies.length && allCompetencies.every(item => item.status === "stable")
          ? "当前已跟踪知识均达到稳定掌握"
          : "暂时没有满足前置条件的学习行动";

  const schedule = futureDue.slice(0, 3).map(item => ({
    competencyId: item.id,
    competencyTitle: item.title,
    topicTitle: item.topicTitle,
    nextReviewAt: item.nextReviewAt,
    masteryScore: item.masteryScore,
  }));

  return {
    version: 1,
    date: today,
    generatedAt: now.toISOString(),
    preferences,
    headline,
    dailyMinutes,
    budgetMinutes,
    maxActions,
    plannedMinutes: selected.reduce((sum, item) => sum + item.estimatedMinutes, 0),
    remainingMinutes: Math.max(0, remaining),
    actions: personalizedActions,
    strategyDecisionId,
    strategyProfileRevision: strategyProfile?.profileRevision || 0,
    candidateCount: candidates.length,
    completedTodayCount: completedToday.length,
    completedMinutesToday: activity.completedMinutes,
    blockedCompetencies: blocked,
    nextScheduledAt,
    upcomingReviews: schedule,
    summary: insights.summary,
    insights,
  };
}

export async function recordLearningPlanAction(store, action, status, options = {}) {
  if (!store || typeof store.appendMany !== "function") throw new TypeError("A learning progress store is required.");
  if (!action || typeof action.actionId !== "string" || !["started", "completed"].includes(status)) {
    throw new TypeError("A valid plan action and started/completed status are required.");
  }
  const eventType = status === "started" ? "plan_action_started" : "plan_action_completed";
  const at = validDate(options.at) ? (options.at instanceof Date ? options.at : new Date(options.at)).toISOString() : new Date().toISOString();
  const event = {
    id: action.actionId + ":" + status,
    eventSchemaVersion: 3,
    type: eventType,
    at,
    topicId: action.topicId || "unclassified",
    challengeId: "learning-plan",
    challengeTitle: "主动学习计划",
    stepId: action.actionId,
    stepTitle: action.title || action.typeLabel || "学习行动",
    competencyIds: action.competencyId ? [action.competencyId] : [],
    sessionId: "learning-plan:" + action.planDate,
    sessionType: "planning",
    variantId: action.variantId || action.type,
    actionId: action.actionId,
    planDate: action.planDate || dateKey(at),
    planActionType: action.type,
    workId: action.workId || null,
    targetHref: action.href || null,
    estimatedMinutes: Number(action.estimatedMinutes) || 0,
    strategyDecisionId: action.strategyDecisionId || null,
    learningIntervention: action.learningIntervention || null,
    strategyInstruction: action.strategyInstruction || null,
    difficultyLevel: action.difficultyLevel || "maintain",
  };
  await store.appendMany([event]);
  return event;
}

export const LEARNING_PLAN_DEFAULTS = DEFAULT_PREFERENCES;
