import { getLearningRepository } from "./backend/learning-repository.mjs";
import { createLearningGoalManager } from "./learning-agent/goal-manager.mjs";
import { createLearningTaskOrchestrator } from "./learning-agent/task-orchestrator.mjs";
import { createLearningPlanManager } from "./learning-agent/plan-manager.mjs";

const $ = id => document.getElementById(id);
const root = new URL(document.body.dataset.root || "../", location.href);
const pendingStatuses = new Set(["in_progress", "ready", "paused", "failed"]);
const terminalStatuses = new Set(["completed", "skipped", "cancelled"]);

function setFocus({stage,title,description,actionLabel,actionHref,secondaryLabel="查看详细学习进度",secondaryHref="../progress/",note}) {
  $("ls-focus-stage").textContent = stage;
  $("ls-next-title").textContent = title;
  $("ls-next-description").textContent = description;
  const action = $("ls-next-action");
  action.textContent = actionLabel + " →";
  action.href = actionHref;
  $("ls-next-secondary").textContent = secondaryLabel;
  $("ls-next-secondary").href = secondaryHref;
  $("ls-next-note").textContent = note || "本地优先保存；云端同步需要同一已授权账户并处于联网状态。";
  $("ls-focus").setAttribute("aria-busy","false");
}

function setSteps({goalDone=false,planDone=false,taskDone=false,active=1}={}) {
  const states = {
    goal: goalDone ? "done" : active === 1 ? "current" : "locked",
    plan: planDone ? "done" : active === 2 ? "current" : "locked",
    task: taskDone ? "done" : active === 3 ? "current" : "locked",
    review: active === 4 ? "current" : "locked",
  };
  for (const [key,state] of Object.entries(states)) {
    const item = document.querySelector('[data-step="' + key + '"]');
    item?.setAttribute("data-state",state);
  }
}

async function readJson(relative) {
  const response = await fetch(new URL(relative, root), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("无法读取知识注册表：" + relative);
  return response.json();
}

async function boot() {
  const [repository, learningMap] = await Promise.all([
    getLearningRepository(),
    readJson("content/learning-map.json"),
  ]);
  const goalManager = createLearningGoalManager({ repository, learningMap });
  const taskOrchestrator = createLearningTaskOrchestrator({ repository });
  const planManager = createLearningPlanManager({ repository, taskOrchestrator });
  const [goals,current] = await Promise.all([goalManager.list(),planManager.current()]);
  const activeGoals = goals.filter(goal => goal.status === "active");
  const allTasks = current.active ? await taskOrchestrator.list(current.active.planId) : [];
  const nextTask = allTasks
    .filter(task => pendingStatuses.has(task.status))
    .sort((a,b) => {
      // Do not interrupt a task the learner has already started merely because
      // a newer plan proposal was generated in parallel.
      const priority = status => status === "in_progress" ? 0 :
        status === "failed" ? 1 : status === "paused" ? 2 : 3;
      return priority(a.status) - priority(b.status) ||
        (a.sequence || 0) - (b.sequence || 0);
    })[0];
  const lockedTask = allTasks
    .filter(task => task.status === "locked")
    .sort((a,b) => (a.sequence || 0) - (b.sequence || 0))[0];
  const tasksComplete = Boolean(current.active && allTasks.length &&
    allTasks.every(task => terminalStatuses.has(task.status)) &&
    allTasks.some(task => task.status === "completed"));

  if (nextTask?.status === "in_progress") {
    const taskHref = nextTask.href
      ? new URL(nextTask.href, root).href
      : new URL("agent/#la-active-tasks", root).href;
    setSteps({ goalDone: activeGoals.length > 0, planDone: Boolean(current.active), active: 3 });
    setFocus({
      stage: "第 3 步 · 继续正在进行的任务",
      title: nextTask.title || "继续当前学习任务",
      description: (nextTask.topicTitle || "当前专题") + " · " +
        (nextTask.competencyTitle || "知识能力训练") + " · 预计 " +
        (nextTask.estimatedMinutes || 10) + " 分钟。你已经开始这项任务，先完成或暂停当前任务，再处理新生成的计划提案。",
      actionLabel: "继续当前任务",
      actionHref: taskHref,
      secondaryLabel: current.proposal ? "查看待确认的新计划" : "查看本计划的全部任务",
      secondaryHref: current.proposal
        ? new URL("agent/#la-adaptive-plan", root).href
        : new URL("agent/#la-active-tasks", root).href,
      note: "新计划提案不会自动中断当前任务；接受新计划前，当前执行状态和学习记录保持不变。",
    });
    return;
  }

  if (current.proposal) {
    setSteps({ goalDone: activeGoals.length > 0, planDone: false, active: 2 });
    setFocus({
      stage: "第 2 步 · 等待你确认",
      title: "学习计划已经生成，先检查安排再开始",
      description: "系统为你准备了 " + (current.proposal.actions?.length || 0) +
        " 项学习行动。先确认专题顺序、每日时间和推荐原因；只有点击接受，正式任务才会创建。",
      actionLabel: "检查并接受计划",
      actionHref: new URL("agent/#la-adaptive-plan", root).href,
      secondaryLabel: "查看学习目标",
      secondaryHref: new URL("agent/#la-learning-goals", root).href,
      note: "拒绝或重新规划不会删除旧版本；计划由你确认后才会生效。",
    });
    return;
  }

  if (nextTask) {
    const taskHref = nextTask.href ? new URL(nextTask.href, root).href : new URL("agent/#la-active-tasks", root).href;
    const actionText = nextTask.status === "in_progress" ? "继续当前任务" :
      nextTask.status === "paused" ? "恢复当前任务" :
        nextTask.status === "failed" ? "重新开始任务" : "开始今天的第一项任务";
    setSteps({ goalDone: activeGoals.length > 0, planDone: Boolean(current.active), active: 3 });
    setFocus({
      stage: "第 3 步 · 执行学习任务",
      title: nextTask.title || "继续今天的学习",
      description: (nextTask.topicTitle || "当前专题") + " · " +
        (nextTask.competencyTitle || "知识能力训练") + " · 预计 " +
        (nextTask.estimatedMinutes || 10) + " 分钟。打开对应课程、挑战或复习后，页面会显示这项任务的执行入口。",
      actionLabel: actionText,
      actionHref: taskHref,
      secondaryLabel: "查看本计划的全部任务",
      secondaryHref: new URL("agent/#la-active-tasks", root).href,
      note: "完成任务只代表执行状态；只有有效挑战和无提示独立验证才会改变掌握判断。",
    });
    return;
  }

  if (lockedTask) {
    setSteps({ goalDone: activeGoals.length > 0, planDone: Boolean(current.active), active: 3 });
    const reason = lockedTask.lockedReason === "scheduled-date"
      ? "该任务还没有到计划日期，系统会在到期后开放。"
      : "该任务需要先完成前置学习任务；请在计划中查看当前依赖。";
    setFocus({
      stage: "第 3 步 · 等待任务解锁",
      title: lockedTask.title || "下一项学习任务暂时锁定",
      description: reason + "当前计划已经保存，不需要重新创建目标或重复生成计划。",
      actionLabel: "查看任务与前置步骤",
      actionHref: new URL("agent/#la-active-tasks", root).href,
      secondaryLabel: "查看学习计划",
      secondaryHref: new URL("agent/#la-adaptive-plan", root).href,
      note: "前置任务和计划日期由任务状态机管理；不会因为页面打开就自动解锁。",
    });
    return;
  }

  if (!activeGoals.length) {
    const pausedGoals = goals.filter(goal => goal.status === "paused");
    setSteps({ active: 1 });
    setFocus({
      stage: "第 1 步 · 建立学习目标",
      title: pausedGoals.length ? "先恢复一个已有目标，或建立新的学习目标" : "先告诉 KNOWVERSE，你想掌握什么",
      description: "选择一个知识专题，写下目标，并设定真实可投入的时间。系统会用这个目标组织后面的学习计划，不需要先配置 AI。",
      actionLabel: pausedGoals.length ? "管理或恢复学习目标" : "创建我的第一个学习目标",
      actionHref: new URL("agent/#la-learning-goals", root).href,
      secondaryLabel: "先浏览知识专题",
      secondaryHref: new URL("knowledge/", root).href,
      note: "创建目标不会自动启动计划；下一步会先给你一份可检查、可拒绝的计划提案。",
    });
    return;
  }

  if (!current.active) {
    setSteps({ goalDone: true, active: 2 });
    setFocus({
      stage: "第 2 步 · 生成学习计划",
      title: "目标已经明确，现在生成一份可执行计划",
      description: "规划器会检查前置知识、时间预算和已有学习证据。计划先以提案形式呈现，不会在你确认前创建执行任务。",
      actionLabel: "生成并检查学习计划",
      actionHref: new URL("agent/#la-adaptive-plan", root).href,
      secondaryLabel: "修改学习目标",
      secondaryHref: new URL("agent/#la-learning-goals", root).href,
    });
    return;
  }

  setSteps({ goalDone: true, planDone: true, taskDone: tasksComplete, active: 4 });
  setFocus({
    stage: "第 4 步 · 复习与再次验证",
    title: tasksComplete ? "当前计划的任务已完成，下一步是验证是否真正掌握" : "当前没有待执行任务，可以检查需要巩固的知识",
    description: "进入薄弱点和复习区域，优先处理真实错误；使用不同题型、无提示的独立验证来确认理解。",
    actionLabel: "查看薄弱点与复习安排",
    actionHref: new URL("progress/#weak-points", root).href,
    secondaryLabel: "重新规划下一阶段",
    secondaryHref: new URL("agent/#la-adaptive-plan", root).href,
    note: "首次访问没有证据时，知识节点会保持“未验证”，不会被默认判定为薄弱或已掌握。",
  });
}

boot().catch(error => {
  console.error("[KNOWVERSE] learning start page failed:", error);
  setFocus({
    stage: "学习档案暂时不可用",
    title: "无法读取当前浏览器的学习状态",
    description: error?.message || "请确认浏览器支持 IndexedDB，然后重新打开本页。",
    actionLabel: "打开学习目标管理",
    actionHref: new URL("agent/#la-learning-goals", root).href,
    secondaryLabel: "查看学习进度",
    secondaryHref: new URL("progress/", root).href,
    note: "没有删除或覆盖任何现有学习数据。",
  });
});
