import { createLearningTaskOrchestrator } from "./task-orchestrator.mjs";

/** Bind a routed, accepted challenge task to its real challenge event stream. */
export async function createChallengeTaskContext(challenge) {
  if (typeof location === "undefined") {
    return { strategyContext: null, async completeIfFinished() { return null; } };
  }
  const taskId = new URL(location.href).searchParams.get("taskId");
  if (!taskId) return { strategyContext: null, task: null, async completeIfFinished() { return null; } };

  const taskOrchestrator = createLearningTaskOrchestrator();
  let task = await taskOrchestrator.get(taskId);
  if (!task || !["challenge", "assessment"].includes(task.taskType) ||
      task.resourceType !== "challenge" ||
      (task.workId && challenge.workId && task.workId !== challenge.workId) ||
      (task.variantId && !task.variantId.startsWith(challenge.id + ":"))) {
    throw new Error("当前挑战与计划任务不匹配，不能关联学习结果。");
  }
  if (task.status === "failed") task = await taskOrchestrator.retry(task.taskId);
  if (task.status === "ready") task = await taskOrchestrator.start(task.taskId);
  else if (task.status === "paused") task = await taskOrchestrator.transition(task.taskId, "in_progress");
  if (task.status !== "in_progress") {
    throw new Error("该挑战任务当前状态为 " + task.status + "，不能开始新的挑战会话。");
  }

  const strategyContext = {
    taskId: task.taskId,
    planId: task.planId,
    strategyDecisionId: task.strategyDecisionId || null,
    strategyProfileRevision: task.strategyProfileRevision || null,
    learningIntervention: task.learningIntervention || null,
    strategyInstruction: task.strategyInstruction || null,
    difficultyLevel: task.difficultyLevel || "maintain",
    strategyEvidenceRefs: task.strategyEvidenceRefs || [],
  };
  return {
    task,
    strategyContext,
    async completeIfFinished(progress) {
      const targetStepId = task.variantId?.startsWith(challenge.id + ":")
        ? task.variantId.slice(challenge.id.length + 1) : null;
      const targetSteps = targetStepId
        ? progress?.steps?.filter(step => step.id === targetStepId) || []
        : progress?.steps || [];
      const completed = targetSteps.length > 0 &&
        targetSteps.every(step => step.status === "completed");
      if (!completed) return null;
      const current = await taskOrchestrator.get(task.taskId);
      if (current?.status === "in_progress") {
        task = await taskOrchestrator.complete(task.taskId);
        const url = new URL(location.href);
        url.searchParams.delete("taskId");
        history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
      return task;
    },
  };
}
