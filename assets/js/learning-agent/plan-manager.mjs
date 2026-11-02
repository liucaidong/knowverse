import { buildAdaptiveLearningPlan, createLearningPlanPreferencesStore } from "../learning-planner.mjs";
import { getLearningRepository } from "../backend/learning-repository.mjs";
import { createLearningTaskOrchestrator, mapPlanActionToTask } from "./task-orchestrator.mjs";

const TYPE = "learning_plan";
const HEAD_TYPE = "learning_plan_head";
const HEAD_KEY = "current";
const makeId = () => globalThis.crypto?.randomUUID?.() || "plan-" + Date.now().toString(36) + Math.random().toString(36).slice(2);
const nowIso = () => new Date().toISOString();

function planEvent(plan, type, extra = {}, at = nowIso()) {
  return {
    id: "learning-plan:" + plan.planId + ":" + type,
    type,
    at,
    topicId: "unclassified",
    challengeId: "learning-agent",
    challengeTitle: "自适应学习规划",
    stepId: plan.planId,
    stepTitle: plan.headline || type,
    competencyIds: [],
    sessionId: plan.planId,
    sessionType: "planning",
    planId: plan.planId,
    planVersion: plan.version,
    planStatus: plan.status,
    reason: plan.reason || null,
    taskCount: plan.actions?.length || 0,
  };
}

export function createLearningPlanManager(options = {}) {
  const repositoryPromise = options.repository ? Promise.resolve(options.repository) : getLearningRepository();
  const taskOrchestrator = options.taskOrchestrator || createLearningTaskOrchestrator({ repository: options.repository });
  const preferenceStore = options.preferenceStore || createLearningPlanPreferencesStore({ repository: options.repository });

  async function row(type, key) {
    const repository = await repositoryPromise;
    return repository.documents.get(type, key);
  }
  async function get(planId) {
    const item = await row(TYPE, planId);
    return item && !item.payload?._deleted ? { ...item.payload, localRevision: item.localRevision } : null;
  }
  async function head() {
    const item = await row(HEAD_TYPE, HEAD_KEY);
    return item?.payload?._deleted ? null : item ? { ...item.payload, localRevision: item.localRevision } : null;
  }
  async function current() {
    const currentHead = await head();
    const active = currentHead?.activePlanId ? await get(currentHead.activePlanId) : null;
    const proposal = currentHead?.proposedPlanId ? await get(currentHead.proposedPlanId) : null;
    return { head: currentHead, active, proposal };
  }
  async function history() {
    const repository = await repositoryPromise;
    const rows = await repository.documents.list(1000);
    return rows.filter(item => item.type === TYPE && !item.payload?._deleted)
      .map(item => ({ ...item.payload, localRevision: item.localRevision }))
      .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
  }

  async function generate(context, reason = "根据当前学习证据生成计划", requestOptions = {}) {
    const repository = await repositoryPromise;
    const [preferences, goals, events, currentPlan, prior] = await Promise.all([
      preferenceStore.load(),
      context.goalManager.list(),
      repository.events.list(),
      current(),
      history(),
    ]);
    const profilePreferences = context.profilePreferences || {};
    const mergedPreferences = {
      ...preferences,
      dailyMinutes: Number(profilePreferences.dailyMinutes) || preferences.dailyMinutes,
      focusTopicId: profilePreferences.preferredTopicIds?.[0] || preferences.focusTopicId,
    };
    const horizonDays = Math.max(1, Math.min(14, Number(requestOptions.horizonDays) || 1));
    const weeklyDays = Math.max(1, Math.min(7, Number(profilePreferences.weeklyDays) || 5));
    const startDate = context.now ? new Date(context.now) : new Date();
    const studyOffsets = [];
    for (let week = 0; week < horizonDays; week += 7) {
      for (let slot = 0; slot < weeklyDays; slot += 1) {
        const offset = week + Math.round(slot * 7 / weeklyDays);
        if (offset < horizonDays && !studyOffsets.includes(offset)) studyOffsets.push(offset);
      }
    }
    const totalBudgetMinutes = mergedPreferences.dailyMinutes * studyOffsets.length;
    const deterministic = buildAdaptiveLearningPlan({
      learningMap: context.learningMap,
      challengeRegistry: context.challengeRegistry,
      worksManifest: context.worksManifest,
      checkpointRegistry: context.checkpointRegistry,
      snapshot: { events },
      preferences: mergedPreferences,
      budgetMinutes: totalBudgetMinutes,
      maxActions: Math.min(30, Math.max(3, studyOffsets.length * 3)),
      goals,
      now: context.now || new Date(),
    });
    const generatedAt = deterministic.generatedAt;
    const planId = makeId();
    const scheduledActions = [];
    const schedule = studyOffsets.map((offset, index) => {
      const date = new Date(startDate);
      date.setDate(date.getDate() + offset);
      return {
        date: [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
          String(date.getDate()).padStart(2, "0")].join("-"),
        dayNumber: offset + 1,
        studyDayNumber: index + 1,
        dailyBudgetMinutes: mergedPreferences.dailyMinutes,
        plannedMinutes: 0,
        actionIds: [],
      };
    });
    const remainingByDay = schedule.map(() => mergedPreferences.dailyMinutes);
    if (remainingByDay.length) {
      remainingByDay[0] = Math.max(0, mergedPreferences.dailyMinutes - deterministic.completedMinutesToday);
      schedule[0].plannedMinutes = 0;
    }
    const countByDay = schedule.map(() => 0);
    for (const candidate of deterministic.actions) {
      let assigned = -1;
      for (let index = 0; index < schedule.length; index += 1) {
        if (countByDay[index] < 3 && candidate.estimatedMinutes <= remainingByDay[index]) {
          assigned = index;
          break;
        }
      }
      if (assigned < 0) continue;
      const action = {
        ...candidate,
        sequence: scheduledActions.length + 1,
        planDate: schedule[assigned].date,
        studyDayNumber: schedule[assigned].studyDayNumber,
      };
      scheduledActions.push(action);
      schedule[assigned].plannedMinutes += action.estimatedMinutes;
      schedule[assigned].actionIds.push(action.actionId);
      remainingByDay[assigned] -= action.estimatedMinutes;
      countByDay[assigned] += 1;
    }
    const goalAllocations = goals.filter(goal => goal.status === "active").map(goal => {
      const allocation = scheduledActions.filter(action => action.linkedGoalIds?.includes(goal.goalId))
        .reduce((sum, action) => sum + action.estimatedMinutes / Math.max(1, action.linkedGoalIds.length), 0);
      return {
        goalId: goal.goalId,
        title: goal.title,
        priority: goal.priority,
        dailyTargetMinutes: goal.dailyMinutes,
        allocatedMinutes: Math.round(allocation),
        linkedTaskCount: scheduledActions.filter(action => action.linkedGoalIds?.includes(goal.goalId)).length,
      };
    });
    const plan = {
      planId,
      version: prior.length + 1,
      date: deterministic.date,
      horizonDays,
      activeStudyDays: schedule.length,
      schedule,
      generatedAt,
      status: "proposed",
      reason: String(reason || "根据当前学习证据生成计划").slice(0, 1000),
      supersedesPlanId: currentPlan.active?.planId || null,
      supersedesProposalId: currentPlan.proposal?.planId || null,
      proposedAfterPlanId: currentPlan.active?.planId || null,
      planner: "deterministic",
      plannerVersion: 2,
      preferences: mergedPreferences,
      linkedGoalIds: goals.filter(goal => goal.status === "active").map(goal => goal.goalId),
      goalAllocations,
      headline: deterministic.headline,
      dailyMinutes: mergedPreferences.dailyMinutes,
      totalBudgetMinutes,
      plannedMinutes: scheduledActions.reduce((sum, item) => sum + item.estimatedMinutes, 0),
      remainingMinutes: Math.max(0, totalBudgetMinutes - scheduledActions.reduce((sum, item) => sum + item.estimatedMinutes, 0)),
      candidateCount: deterministic.candidateCount,
      blockedCompetencies: deterministic.blockedCompetencies,
      upcomingReviews: deterministic.upcomingReviews,
      actions: scheduledActions.map(action => ({
        ...action,
        dependsOnActionIds: action.dependsOnActionIds || [],
      })),
      createdBy: "planner",
      acceptedAt: null,
      rejectedAt: null,
    };
    const headRow = await row(HEAD_TYPE, HEAD_KEY);
    const currentHead = headRow?.payload || { activePlanId: null, proposedPlanId: null, version: 0 };
    const nextHead = {
      activePlanId: currentHead.activePlanId || null,
      proposedPlanId: planId,
      version: (Number(currentHead.version) || 0) + 1,
      updatedAt: generatedAt,
      lastReason: plan.reason,
    };
    const documents = [
      { type: TYPE, key: planId, payload: plan, expectedLocalRevision: 0 },
      { type: HEAD_TYPE, key: HEAD_KEY, payload: nextHead, expectedLocalRevision: Number(headRow?.localRevision) || 0 },
    ];
    const planEvents = [planEvent(plan, "learning_plan_generated")];
    if (currentPlan.proposal) {
      const previousProposal = await row(TYPE, currentPlan.proposal.planId);
      if (previousProposal && previousProposal.payload.status === "proposed") {
        const superseded = {
          ...previousProposal.payload,
          status: "superseded",
          supersededAt: generatedAt,
          supersededByPlanId: planId,
        };
        documents.push({
          type: TYPE, key: currentPlan.proposal.planId, payload: superseded,
          expectedLocalRevision: Number(previousProposal.localRevision) || 0,
        });
        planEvents.push(planEvent(superseded, "learning_plan_superseded", { supersededByPlanId: planId }, generatedAt));
      }
    }
    await repository.commit({ events: planEvents, documents });
    return { ...plan, localRevision: 1 };
  }

  async function accept(planId) {
    const repository = await repositoryPromise;
    const planRow = await row(TYPE, planId);
    if (!planRow || planRow.payload?._deleted) throw new Error("计划提案不存在。");
    const plan = planRow.payload;
    if (plan.status === "accepted") return { ...plan, tasks: await taskOrchestrator.list(planId), idempotent: true };
    if (plan.status !== "proposed") throw new Error("只有待接受的计划提案可以被接受。");
    const headRow = await row(HEAD_TYPE, HEAD_KEY);
    const currentHead = headRow?.payload || { activePlanId: null, proposedPlanId: planId, version: 0 };
    if (currentHead.proposedPlanId !== planId) throw new Error("该提案已被更新的计划替代，请先查看最新提案。");
    const acceptedAt = nowIso();
    const acceptedPlan = { ...plan, status: "accepted", acceptedAt, acceptedBy: "learner" };
    const nextHead = {
      ...currentHead,
      activePlanId: planId,
      proposedPlanId: null,
      version: (Number(currentHead.version) || 0) + 1,
      updatedAt: acceptedAt,
    };
    // Create the task documents before updating the head; all writes and the
    // acceptance fact are still one atomic repository transaction.
    const taskIdsByAction = new Map();
    const taskRows = plan.actions.map((action, index) => {
      const dependsOnTaskIds = (action.dependsOnActionIds || [])
        .map(actionId => taskIdsByAction.get(actionId))
        .filter(Boolean);
      const task = mapPlanActionToTask(action, planId, { dependsOnTaskIds });
      task.sequence = index + 1;
      task.createdAt = acceptedAt;
      task.updatedAt = acceptedAt;
      taskIdsByAction.set(action.actionId, task.taskId);
      return task;
    });
    const event = planEvent(acceptedPlan, "learning_plan_accepted", { actor: "learner", taskCount: taskRows.length }, acceptedAt);
    const events = [event, ...taskRows.map(task => ({
      id: "learning-task:" + task.taskId + ":created",
      type: "learning_task_created",
      at: acceptedAt,
      topicId: task.topicId,
      challengeId: "learning-agent",
      challengeTitle: "学习任务编排",
      stepId: task.taskId,
      stepTitle: task.title,
      competencyIds: task.competencyId ? [task.competencyId] : [],
      sessionId: planId,
      sessionType: "orchestration",
      planId,
      taskId: task.taskId,
      taskStatus: task.status,
      taskType: task.taskType,
      actionId: task.actionId,
      planDate: task.planDate,
      estimatedMinutes: task.estimatedMinutes,
    }))];
    await repository.commit({
      events,
      documents: [
        { type: TYPE, key: planId, payload: acceptedPlan, expectedLocalRevision: Number(planRow.localRevision) || 0 },
        ...taskRows.map(task => ({ type: "learning_task", key: task.taskId, payload: task, expectedLocalRevision: 0 })),
        { type: HEAD_TYPE, key: HEAD_KEY, payload: nextHead, expectedLocalRevision: Number(headRow?.localRevision) || 0 },
      ],
    });
    return { ...acceptedPlan, tasks: taskRows };
  }

  async function reject(planId, reason = "学习者拒绝该计划") {
    const repository = await repositoryPromise;
    const planRow = await row(TYPE, planId);
    if (!planRow || planRow.payload?._deleted || planRow.payload.status !== "proposed") {
      throw new Error("只有待接受的计划提案可以被拒绝。");
    }
    const at = nowIso();
    const rejected = { ...planRow.payload, status: "rejected", rejectedAt: at, rejectionReason: String(reason).slice(0, 1000) };
    const headRow = await row(HEAD_TYPE, HEAD_KEY);
    const head = headRow?.payload || {};
    const nextHead = head.proposedPlanId === planId
      ? { ...head, proposedPlanId: null, version: (head.version || 0) + 1, updatedAt: at }
      : head;
    await repository.commit({
      events: [planEvent(rejected, "learning_plan_rejected", { reason: rejected.rejectionReason }, at)],
      documents: [
        { type: TYPE, key: planId, payload: rejected, expectedLocalRevision: Number(planRow.localRevision) || 0 },
        ...(headRow && head.proposedPlanId === planId
          ? [{ type: HEAD_TYPE, key: HEAD_KEY, payload: nextHead, expectedLocalRevision: Number(headRow.localRevision) || 0 }]
          : []),
      ],
    });
    return rejected;
  }

  return { get, head, current, history, generate, accept, reject, tasks: taskOrchestrator };
}
