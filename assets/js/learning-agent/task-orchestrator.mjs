import { getLearningRepository } from "../backend/learning-repository.mjs";

const TYPE = "learning_task";
const TERMINAL = new Set(["completed", "skipped", "cancelled"]);
const TRANSITIONS = Object.freeze({
  locked: new Set(["ready", "cancelled"]),
  ready: new Set(["in_progress", "skipped", "cancelled"]),
  in_progress: new Set(["paused", "completed", "failed", "cancelled"]),
  paused: new Set(["in_progress", "skipped", "cancelled"]),
  failed: new Set(["ready", "cancelled"]),
  completed: new Set(),
  skipped: new Set(),
  cancelled: new Set(),
});
const id = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
const nowIso = () => new Date().toISOString();
const dateKey = value => {
  const date = value instanceof Date ? value : new Date(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")].join("-");
};

function eventFor(task, status, extra = {}, at = nowIso()) {
  return {
    id: "learning-task:" + task.taskId + ":" + status + ":" + (task.revision || 1),
    type: "learning_task_" + status,
    at,
    topicId: task.topicId || "unclassified",
    challengeId: "learning-agent",
    challengeTitle: "学习任务编排",
    stepId: task.taskId,
    stepTitle: task.title,
    competencyIds: task.competencyId ? [task.competencyId] : [],
    sessionId: task.planId,
    sessionType: "orchestration",
    variantId: task.variantId || task.taskType,
    planId: task.planId,
    planDate: task.planDate,
    actionId: task.actionId,
    taskId: task.taskId,
    taskType: task.taskType,
    taskStatus: status,
    estimatedMinutes: task.estimatedMinutes,
    ...extra,
  };
}

function validateEvidence(task, events, startedAt) {
  const eventById = new Map(events.map(event => [event.id, event]));
  const eligible = events.filter(event =>
    Date.parse(event.at) >= Date.parse(startedAt || task.createdAt) &&
    (event.competencyIds || []).includes(task.competencyId)
  );

  if (task.taskType === "review") {
    const failures = events.filter(event => event.type === "attempt" &&
      event.correct === false && event.gapId === task.gapId &&
      (event.competencyIds || []).includes(task.competencyId));
    const validPasses = eligible.filter(pass => {
      if (pass.type !== "assessment_passed" || pass.sessionType !== "review" ||
          pass.gapId !== task.gapId || Number(pass.hintsUsed) !== 0 ||
          !pass.variantId || pass.variantId === task.variantId) return false;
      const parents = pass.causationEventIds || [];
      return failures.some(failure => {
        const targetId = failure.gapObservationId || failure.id;
        const failedVariant = failure.variantId || failure.challengeId + ":" + failure.stepId;
        if (pass.variantId === failedVariant || !(pass.targetGapEventIds || []).includes(targetId)) return false;
        const start = parents.map(id => eventById.get(id)).find(item =>
          item?.type === "review_started" && item.sessionType === "review" &&
          item.sessionId === pass.sessionId && (item.targetGapEventIds || []).includes(targetId) &&
          (item.competencyIds || []).includes(task.competencyId) &&
          (item.causationEventIds || []).includes(failure.id));
        if (!start) return false;
        const previousVariants = (start.causationEventIds || [])
          .map(id => eventById.get(id))
          .filter(item => item?.type === "attempt" && item.sessionType === "review" &&
            item.gapId === task.gapId)
          .map(item => item.variantId).filter(Boolean);
        if (previousVariants.includes(pass.variantId)) return false;
        return parents.some(id => {
          const attempt = eventById.get(id);
          return attempt?.type === "attempt" && attempt.sessionType === "review" &&
            attempt.sessionId === pass.sessionId &&
            (attempt.competencyIds || []).includes(task.competencyId) &&
            attempt.variantId === pass.variantId && attempt.correct === true &&
            Number(attempt.hintsUsed) === 0 &&
            (attempt.causationEventIds || []).includes(start.id) &&
            (attempt.targetGapEventIds || []).includes(targetId);
        });
      });
    });
    const unresolved = failures.filter(failure => !validPasses.some(pass => {
      const targetId = failure.gapObservationId || failure.id;
      return (pass.targetGapEventIds || []).includes(targetId);
    }));
    if (unresolved.length || !validPasses.length) {
      throw new Error("该复习任务必须对当前薄弱点的所有未解决错误观察完成不同变体、无提示、可追溯的独立验证。");
    }
    return validPasses.slice(0, 20).map(event => event.id);
  }

  const matches = eligible.filter(event =>
    task.taskType === "assessment"
      ? event.type === "assessment_passed" && (!task.variantId || event.variantId === task.variantId)
      : ["assessment_passed", "completed"].includes(event.type)
  );
  if (!matches.length && task.evidencePolicy === "required_assessment") {
    throw new Error("该验证任务必须先完成关联挑战或检查点，系统尚未找到有效评估证据。");
  }
  return matches.slice(0, 20).map(event => event.id);
}

export function mapPlanActionToTask(action, planId, options = {}) {
  const taskType = action.type === "learn" ? "read" :
    action.type === "repair" ? "review" :
      action.type === "validate" || action.type === "review" ? "assessment" :
        action.resourceType === "checkpoint" || action.resourceType === "challenge" ? "challenge" :
          action.resourceType === "lab" ? "explore" : "practice";
  const evidencePolicy = ["review", "assessment", "challenge"].includes(taskType)
    ? "required_assessment" : "execution_confirmation";
  return {
    taskId: planId + ":" + action.actionId,
    planId,
    planDate: action.planDate,
    actionId: action.actionId,
    taskType,
    title: action.title || action.typeLabel || "学习行动",
    competencyId: action.competencyId,
    competencyTitle: action.competencyTitle,
    topicId: action.topicId,
    topicTitle: action.topicTitle,
    linkedGoalIds: action.linkedGoalIds || [],
    priority: action.priority,
    priorityReasons: action.priorityReasons || [],
    estimatedMinutes: action.estimatedMinutes,
    href: action.href,
    resourceTitle: action.resourceTitle,
    resourceLabel: action.resourceLabel,
    resourceType: action.resourceType,
    variantId: action.variantId,
    workId: action.workId,
    gapId: action.gapId || null,
    dependsOnTaskIds: options.dependsOnTaskIds || [],
    evidencePolicy,
    status: options.dependsOnTaskIds?.length ||
      (action.planDate && action.planDate > dateKey(new Date())) ? "locked" : "ready",
    lockedReason: action.planDate && action.planDate > dateKey(new Date())
      ? "scheduled-date" : options.dependsOnTaskIds?.length ? "task-dependency" : null,
    revision: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    startedAt: null,
    completedAt: null,
    timeSpentSeconds: 0,
    evidenceEventIds: [],
    pauseReason: null,
  };
}

export function createLearningTaskOrchestrator(options = {}) {
  const repositoryPromise = options.repository ? Promise.resolve(options.repository) : getLearningRepository();

  async function get(taskId) {
    const repository = await repositoryPromise;
    const row = await repository.documents.get(TYPE, taskId);
    return row && !row.payload?._deleted
      ? { ...row.payload, localRevision: row.localRevision }
      : null;
  }

  async function list(planId = null) {
    const repository = await repositoryPromise;
    const rows = await repository.documents.list(1000);
    return rows.filter(row => row.type === TYPE && !row.payload?._deleted &&
      (!planId || row.payload.planId === planId))
      .map(row => ({ ...row.payload, localRevision: row.localRevision }))
      .sort((a, b) => (a.sequence || 0) - (b.sequence || 0) || a.createdAt.localeCompare(b.createdAt));
  }

  async function createForPlan(plan) {
    const repository = await repositoryPromise;
    if (!plan || typeof plan.planId !== "string" || !Array.isArray(plan.actions)) {
      throw new TypeError("正式学习计划格式无效，无法创建任务。");
    }
    const rows = await list(plan.planId);
    if (rows.length) return rows;
    const actionToTask = new Map();
    const tasks = plan.actions.map((action, index) => {
      const dependencyIds = (action.dependsOnActionIds || [])
        .map(actionId => actionToTask.get(actionId)).filter(Boolean);
      const task = mapPlanActionToTask(action, plan.planId, { dependsOnTaskIds: dependencyIds });
      task.sequence = index + 1;
      actionToTask.set(action.actionId, task.taskId);
      return task;
    });
    const event = {
      id: "learning-plan:" + plan.planId + ":tasks-created",
      type: "learning_tasks_created",
      at: nowIso(),
      topicId: "unclassified",
      challengeId: "learning-agent",
      challengeTitle: "学习任务编排",
      stepId: plan.planId,
      stepTitle: "创建计划任务",
      competencyIds: [],
      sessionId: plan.planId,
      sessionType: "orchestration",
      taskCount: tasks.length,
    };
    await repository.commit({
      events: [event],
      documents: tasks.map(task => ({ type: TYPE, key: task.taskId, payload: task, expectedLocalRevision: 0 })),
    });
    return tasks;
  }

  async function transition(taskId, target, options = {}) {
    const repository = await repositoryPromise;
    const row = await repository.documents.get(TYPE, taskId);
    if (!row || row.payload?._deleted) throw new Error("学习任务不存在。");
    const previous = row.payload;
    const at = options.at ? new Date(options.at).toISOString() : nowIso();
    if (!TRANSITIONS[previous.status] || !TRANSITIONS[previous.status].has(target)) {
      if (previous.status === target) return { ...previous, localRevision: row.localRevision, idempotent: true };
      throw new Error("非法任务状态转换：" + previous.status + " → " + target + "。");
    }
    if (previous.status === "locked" && target === "ready") {
      if (previous.planDate && previous.planDate > dateKey(at)) {
        throw new Error("该任务尚未到计划日期，暂时不能解锁。");
      }
      const all = await list(previous.planId);
      const dependencies = all.filter(item => previous.dependsOnTaskIds.includes(item.taskId));
      if (dependencies.length !== previous.dependsOnTaskIds.length || dependencies.some(item => item.status !== "completed")) {
        throw new Error("任务仍被前置任务锁定。");
      }
    }
    if (target === "completed" && previous.status !== "in_progress") {
      throw new Error("只有正在执行的任务可以完成。");
    }
    const revision = (Number(previous.revision) || 0) + 1;
    let evidenceEventIds = [];
    const durationSeconds = Math.max(0, Math.floor((Date.parse(at) -
      Date.parse(previous.currentStartedAt || previous.startedAt || at)) / 1000));
    if (target === "completed") {
      const events = await repository.events.list();
      evidenceEventIds = validateEvidence(previous, events, previous.startedAt);
      const supplied = Array.isArray(options.evidenceEventIds) ? options.evidenceEventIds : [];
      if (supplied.some(id => !evidenceEventIds.includes(id))) {
        throw new Error("提交的学习证据不属于当前知识点或不符合任务验证条件。");
      }
    }
    if (target === "ready" && previous.status === "failed") {
      // Retry is a new execution attempt; historical task events remain append-only.
    }
    const next = {
      ...previous,
      status: target,
      revision,
      updatedAt: at,
      startedAt: target === "in_progress" && (previous.status === "ready" || previous.status === "failed")
        ? at : previous.startedAt,
      currentStartedAt: target === "in_progress" ? at :
        (["paused", "completed", "failed", "cancelled"].includes(target) ? null : previous.currentStartedAt || null),
      completedAt: target === "completed" ? at : previous.completedAt,
      timeSpentSeconds: Number(previous.timeSpentSeconds || 0) +
        (["paused", "completed", "failed", "cancelled"].includes(target) ? durationSeconds : 0),
      pauseReason: target === "paused" ? String(options.reason || "学习者主动暂停").slice(0, 500) : null,
      evidenceEventIds: target === "completed" ? evidenceEventIds : previous.evidenceEventIds || [],
      lastTransition: { from: previous.status, to: target, at, actor: options.actor || "learner" },
    };
    const extra = {
      previousStatus: previous.status,
      taskRevision: revision,
      reason: options.reason || null,
      durationSeconds: ["paused", "completed", "failed"].includes(target) ? durationSeconds : 0,
      evidenceEventIds,
      causationEventIds: evidenceEventIds,
    };
    const event = eventFor(next, target, extra, at);
    await repository.commit({
      events: [event],
      documents: [{
        type: TYPE,
        key: taskId,
        payload: next,
        expectedLocalRevision: Number(row.localRevision) || 0,
      }],
    });
    return { ...next, localRevision: (Number(row.localRevision) || 0) + 1 };
  }

  async function refreshUnlocks(planId) {
    const all = await list(planId);
    const unlocked = [];
    for (const task of all.filter(item => item.status === "locked")) {
      const dependencies = all.filter(item => task.dependsOnTaskIds.includes(item.taskId));
      const dateReady = !task.planDate || task.planDate <= dateKey(new Date());
      if (dateReady && dependencies.length === task.dependsOnTaskIds.length &&
          dependencies.every(item => item.status === "completed")) {
        unlocked.push(await transition(task.taskId, "ready"));
      }
    }
    return unlocked;
  }

  return {
    get, list, createForPlan, transition, refreshUnlocks,
    start: (taskId, options) => transition(taskId, "in_progress", options),
    pause: (taskId, options) => transition(taskId, "paused", options),
    complete: (taskId, options) => transition(taskId, "completed", options),
    skip: (taskId, options) => transition(taskId, "skipped", options),
    fail: (taskId, options) => transition(taskId, "failed", options),
    cancel: (taskId, options) => transition(taskId, "cancelled", options),
    retry: (taskId, options) => transition(taskId, "ready", options),
  };
}

export const LEARNING_TASK_TRANSITIONS = TRANSITIONS;
