import { deriveLearningInsights } from "./learning-progress.mjs";

const PREFERENCES_KEY = "knowverse:learning-plan:preferences:v1";
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
    dailyMinutes: [15, 25, 40, 60].includes(minutes) ? minutes : DEFAULT_PREFERENCES.dailyMinutes,
    focusTopicId: focusTopicId || "all",
  };
}

export function createLearningPlanPreferencesStore(options = {}) {
  let storage = options.storage;
  if (typeof storage === "undefined") {
    try { storage = globalThis.localStorage || null; } catch { storage = null; }
  }
  const key = options.key || PREFERENCES_KEY;
  const available = Boolean(storage && typeof storage.getItem === "function" && typeof storage.setItem === "function");
  return {
    available,
    load() {
      if (!available) return { ...DEFAULT_PREFERENCES };
      try { return normalizePreferences(JSON.parse(storage.getItem(key) || "{}")); }
      catch { return { ...DEFAULT_PREFERENCES }; }
    },
    save(value) {
      const normalized = normalizePreferences(value);
      if (!available) return false;
      try { storage.setItem(key, JSON.stringify(normalized)); return true; }
      catch { return false; }
    },
  };
}

function planActivity(snapshot, today) {
  const started = new Set();
  const completed = new Set();
  const completedLearningCompetencies = new Set();
  let completedMinutes = 0;
  for (const event of snapshot?.events || []) {
    if (event.sessionType !== "planning" || typeof event.actionId !== "string") continue;
    if (event.planActionType === "learn" && event.type === "plan_action_completed") {
      for (const competencyId of event.competencyIds || []) completedLearningCompetencies.add(competencyId);
    }
    if (event.planDate !== today) continue;
    if (event.type === "plan_action_started") started.add(event.actionId);
    if (event.type === "plan_action_completed") {
      completed.add(event.actionId);
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

function makeAction({ today, type, competency, gapId = null, minutes, priority, reasons, resource, state }) {
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
  const futureDue = allCompetencies
    .filter(item => item.nextReviewAt && !item.isDue)
    .sort((a, b) => Date.parse(a.nextReviewAt) - Date.parse(b.nextReviewAt));
  const candidates = [];
  const blocked = [];

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
    const activeGaps = state.activeGaps || [];
    const focusBoost = preferences.focusTopicId !== "all" && preferences.focusTopicId === definition.topicId ? 12 : 0;
    const downstream = descendants.get(definition.id) || 0;

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
          resource, state,
        }));
      }
      continue;
    }

    if (state.isDue && state.evidenceCount) {
      const priority = 92 + Math.min(8, downstream * 2) +
        Math.max(0, 80 - (state.masteryScore || 0)) * 0.12 + focusBoost;
      candidates.push(makeAction({
        today, type: "review", competency: definition, minutes: 8, priority,
        reasons: [
          "已达到下一次复习时间",
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
      const resource = practiceResource(definition, options.worksManifest, options.checkpointRegistry, options.challengeRegistry,
        usedVariantsByCompetency.get(definition.id) || new Set());
      if (resource) action = makeAction({
        today, type: "practice", competency: definition, minutes: 15,
        priority: 82 + Math.min(8, downstream * 2) + focusBoost,
        reasons: [
          state.status === "weak" ? "近期证据显示需要补强" : "理解正在建立，需要增加主动练习",
          "通过对应实验或挑战产生新的验证证据",
          focusBoost ? "符合当前优先专题" : null,
        ].filter(Boolean),
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

  candidates.sort((a, b) => b.priority - a.priority || a.estimatedMinutes - b.estimatedMinutes ||
    a.topicTitle.localeCompare(b.topicTitle, "zh-CN"));
  const dailyMinutes = preferences.dailyMinutes;
  const selected = [];
  let remaining = Math.max(0, dailyMinutes - activity.completedMinutes);
  const seenCompetencies = new Set();
  for (const candidate of candidates) {
    if (activity.completed.has(candidate.actionId) || seenCompetencies.has(candidate.competencyId)) continue;
    if (candidate.estimatedMinutes > remaining) continue;
    selected.push({
      ...candidate,
      completedToday: false,
      startedToday: activity.started.has(candidate.actionId),
      sequence: selected.length + 1,
    });
    seenCompetencies.add(candidate.competencyId);
    remaining -= candidate.estimatedMinutes;
    if (selected.length >= 3) break;
  }

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
    plannedMinutes: selected.reduce((sum, item) => sum + item.estimatedMinutes, 0),
    remainingMinutes: Math.max(0, remaining),
    actions: selected,
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

export function recordLearningPlanAction(store, action, status, options = {}) {
  if (!store || typeof store.appendMany !== "function") throw new TypeError("A learning progress store is required.");
  if (!action || typeof action.actionId !== "string" || !["started", "completed"].includes(status)) {
    throw new TypeError("A valid plan action and started/completed status are required.");
  }
  const eventType = status === "started" ? "plan_action_started" : "plan_action_completed";
  const at = validDate(options.at) ? (options.at instanceof Date ? options.at : new Date(options.at)).toISOString() : new Date().toISOString();
  const event = {
    id: action.actionId + ":" + status,
    eventSchemaVersion: 2,
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
  };
  if (!store.appendMany([event])) throw new Error("学习计划事件保存失败，请检查浏览器本地存储空间并导出备份。");
  return event;
}

export const LEARNING_PLAN_DEFAULTS = DEFAULT_PREFERENCES;
