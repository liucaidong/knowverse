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
    strategyDecisionId: task.strategyDecisionId || null,
    strategyProfileRevision: task.strategyProfileRevision || null,
    learningIntervention: task.learningIntervention || null,
    strategyInstruction: task.strategyInstruction || null,
    difficultyLevel: task.difficultyLevel || "maintain",
    sourceEvidenceRefs: task.sourceEvidenceRefs || [],
    causationEventIds: task.sourceEvidenceRefs || [],
    targetGapEventIds: task.gapId ? (task.sourceEvidenceRefs || []) : [],
    ...extra,
  };
}

function validateEvidence(task, events, startedAt) {
  const eventById = new Map(events.map(event => [event.id, event]));
  const eligible = events.filter(event =>
    Date.parse(event.at) >= Date.parse(startedAt || task.createdAt) &&
    (event.competencyIds || []).includes(task.competencyId) &&
    (Number(task.taskSchemaVersion) < 2
      ? (!event.taskId || event.taskId === task.taskId)
      : event.taskId === task.taskId)
  );

  if (task.taskType === "review") {
    // The original gap event predates this review task. Only the review chain itself
    // must be tagged with this task's ID; the causal source remains the historical failure.
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
        // targetGapEventIds is the explicit reference to the original failed
        // observation. causationEventIds is reserved for the review's causal
        // predecessors (for example, the prior assisted attempt); requiring the
        // original failure in both fields breaks a second review session.
        const start = parents.map(id => eventById.get(id)).find(item =>
          item?.type === "review_started" && item.sessionType === "review" &&
          item.sessionId === pass.sessionId && (item.targetGapEventIds || []).includes(targetId) &&
          (item.competencyIds || []).includes(task.competencyId));
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

  const matches = eligible.filter(event => {
    if (task.taskType === "assessment") {
      if (task.resourceType === "challenge") {
        return event.type === "completed" &&
          (Number(task.taskSchemaVersion) < 2 ||
            event.independent === true && Number(event.hintsUsed || 0) === 0) &&
          (!task.variantId || event.variantId === task.variantId);
      }
      return event.type === "assessment_passed" &&
        (!task.variantId || event.variantId === task.variantId);
    }
    if (task.taskType === "challenge") {
      return event.type === "completed" &&
        (Number(task.taskSchemaVersion) < 2 ||
          event.independent === true && Number(event.hintsUsed || 0) === 0) &&
        (!task.variantId || event.variantId === task.variantId);
    }
    return ["assessment_passed", "completed"].includes(event.type);
  });
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
  const taskId = planId + ":" + action.actionId;
  let href = action.href;
  if (typeof href === "string" && href.startsWith("./")) {
    const hashIndex = href.indexOf("#");
    const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
    const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
    const queryIndex = withoutHash.indexOf("?");
    const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
    const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";
    const params = new URLSearchParams(query);
    params.set("taskId", taskId);
    href = path + "?" + params.toString() + hash;
  }
  return {
    taskId,
    taskSchemaVersion: 2,
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
    href,
    resourceTitle: action.resourceTitle,
    resourceLabel: action.resourceLabel,
    resourceType: action.resourceType,
    variantId: action.variantId,
    workId: action.workId,
    strategyDecisionId: action.strategyDecisionId || null,
    strategyProfileRevision: action.strategyProfileRevision || 0,
    learningIntervention: action.learningIntervention || null,
    strategyInstruction: action.strategyInstruction || null,
    difficultyLevel: action.difficultyLevel || "maintain",
    strategyEvidenceRefs: action.strategyEvidenceRefs || [],
    sourceEvidenceRefs: [...new Set((Array.isArray(action.sourceEvidenceRefs) ? action.sourceEvidenceRefs : [])
      .filter(value => typeof value === "string" && value.length > 0))].slice(-20),
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

  async function ensureScheduledReviewTask(input = {}) {
    const repository = await repositoryPromise;
    const required = ["competencyId", "competencyTitle", "topicId", "topicTitle"];
    if (required.some(key => typeof input[key] !== "string" || !input[key].trim())) {
      throw new TypeError("复习调度任务缺少知识节点信息。");
    }
    const at = input.at ? new Date(input.at).toISOString() : nowIso();
    const gapId = typeof input.gapId === "string" && input.gapId ? input.gapId : null;
    const dueAt = input.dueAt ? new Date(input.dueAt).toISOString() : at;
    const targetKey = input.competencyId + "::" + (gapId || "competency");
    const evidenceRefs = [...new Set((Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [])
      .filter(value => typeof value === "string" && value.length > 0))].sort();
    const cycleBasis = gapId ? "open:" + evidenceRefs.join("|") : "due:" + dueAt;
    const cycleKey = targetKey + "::" + cycleBasis;
    let hash = 0xcbf29ce484222325n;
    for (const char of cycleKey) {
      hash ^= BigInt(char.charCodeAt(0));
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    const suffix = hash.toString(16).padStart(16, "0");
    const taskId = "proactive-review:" + suffix;
    const all = await list();
    const existing = all.find(task => task.proactiveScheduleKey === cycleKey);
    if (existing) return existing;
    const activeForTarget = all
      .filter(task => task.proactiveScheduleTarget === targetKey &&
        !TERMINAL.has(task.status))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if (activeForTarget) return activeForTarget;

    const taskType = gapId ? "review" : "assessment";
    const params = new URLSearchParams({ competencyId: input.competencyId, taskId });
    if (gapId) params.set("gapId", gapId);
    const href = "./review/?" + params.toString();
    const task = {
      taskId,
      taskSchemaVersion: 2,
      planId: "proactive-review:" + suffix,
      planDate: new Date(at).toISOString().slice(0, 10),
      actionId: "scheduled-review:" + suffix,
      taskType,
      title: gapId ? "针对性复习 · " + input.gapLabel : "间隔复习 · " + input.competencyTitle,
      competencyId: input.competencyId,
      competencyTitle: input.competencyTitle,
      topicId: input.topicId,
      topicTitle: input.topicTitle,
      linkedGoalIds: input.linkedGoalIds || [],
      priority: Number(input.priority) || 80,
      priorityReasons: input.reasons || ["复习调度引擎检测到该知识点需要再次验证"],
      estimatedMinutes: Math.max(5, Math.min(60, Number(input.estimatedMinutes) || (gapId ? 12 : 8))),
      href,
      resourceTitle: input.competencyTitle,
      resourceLabel: "打开复习工作台",
      resourceType: "review",
      variantId: input.lastFailureVariantId || null,
      workId: null,
      gapId,
      sourceEvidenceRefs: evidenceRefs.slice(0, 30),
      dependsOnTaskIds: [],
      evidencePolicy: "required_assessment",
      status: "ready",
      lockedReason: null,
      revision: 1,
      createdAt: at,
      updatedAt: at,
      startedAt: null,
      currentStartedAt: null,
      completedAt: null,
      timeSpentSeconds: 0,
      evidenceEventIds: [],
      pauseReason: null,
      dueAt,
      scheduleId: suffix,
      proactiveScheduleKey: cycleKey,
      proactiveScheduleTarget: targetKey,
      proactiveGenerated: true,
      scheduleStatus: input.scheduleStatus || "due",
      strategyDecisionId: input.strategyDecisionId || null,
      strategyProfileRevision: input.strategyProfileRevision || 0,
      learningIntervention: input.learningIntervention || null,
      strategyInstruction: input.strategyInstruction || null,
      difficultyLevel: input.difficultyLevel || "maintain",
      strategyEvidenceRefs: input.strategyEvidenceRefs || [],
    };
    const event = eventFor(task, "created", {
      taskStatus: "ready",
      taskType,
      taskRevision: 1,
      dueAt,
      scheduleId: suffix,
      scheduleStatus: task.scheduleStatus,
      evidenceRefs: evidenceRefs.slice(0, 20),
      strategyDecisionId: task.strategyDecisionId,
      strategyProfileRevision: task.strategyProfileRevision,
      learningIntervention: task.learningIntervention,
      strategyInstruction: task.strategyInstruction,
      difficultyLevel: task.difficultyLevel,
      strategyEvidenceRefs: task.strategyEvidenceRefs,
    }, at);
    try {
      await repository.commit({
        events: [event],
        documents: [{ type: TYPE, key: taskId, payload: task, expectedLocalRevision: 0 }],
      });
      return { ...task, localRevision: 1 };
    } catch (error) {
      // Another tab/device may have created the same deterministic task ID.
      const committed = await get(taskId);
      if (committed) return committed;
      throw error;
    }
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
      lastTransition: {
        from: previous.status, to: target, at, actor: options.actor || "learner",
        reason: options.reason ? String(options.reason).slice(0, 500) : null,
      },
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
    get, list, createForPlan, ensureScheduledReviewTask, transition, refreshUnlocks,
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
