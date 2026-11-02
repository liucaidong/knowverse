import { getLearningRepository } from "../backend/learning-repository.mjs";
import { createLearningProgressStore, deriveLearningInsights } from "../learning-progress.mjs";
import { createLearnerProfileStore, deriveLearnerProfile } from "./learner-profile.mjs";
import { createLearningGoalManager } from "./goal-manager.mjs";
import { createLearningPlanManager } from "./plan-manager.mjs";
import { createLearningTaskOrchestrator } from "./task-orchestrator.mjs";
import { createLearningAgentProvider } from "./agent-provider.mjs";
import { createAgentSessionStore } from "./agent-session-store.mjs";
import { executeAgentTool } from "./agent-tools.mjs";
import { answerWithLocalRules } from "./local-agent.mjs";

const root = new URL("../../../", import.meta.url);
const $ = id => document.getElementById(id);
const create = (tag, className, ...children) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
};
const readJSON = async relative => {
  const response = await fetch(new URL(relative, import.meta.url), { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取知识注册表：" + relative + " (" + response.status + ")");
  return response.json();
};
const formatDate = value => value ? new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "short", day: "numeric",
}).format(new Date(value)) : "未设置截止日期";
const safeHref = value => {
  if (typeof value !== "string" || !value.startsWith("./")) return null;
  const url = new URL(value.slice(2), root);
  return url.origin === root.origin && url.pathname.startsWith(root.pathname) ? url.href : null;
};
const STATUS = {
  unverified: "待验证", weak: "需要补强", building: "正在建立",
  initial: "初步掌握", stable: "稳定掌握",
  proposed: "待确认", accepted: "执行中", rejected: "已拒绝",
  locked: "等待前置任务", ready: "待开始", in_progress: "进行中",
  completed: "已完成", paused: "已暂停", skipped: "已跳过", failed: "失败", cancelled: "已取消",
};
const escapeLines = value => String(value || "").split("\n").join(" ");
let services;
let session;
let messages = [];
let lastProposal = null;
let loading = false;
let mutationInFlight = false;
let pendingReplanEvents = [];
let autoReplanInFlight = false;
let lastAutoReplanCause = null;
let state = { goals: [], profile: null, insights: null, current: null, tasks: [] };

function siteLink(label, href, className = "la-link") {
  const url = safeHref(href);
  if (!url) return null;
  const link = create("a", className, label);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}

async function refreshState() {
  const [events, preferences, goals, current] = await Promise.all([
    services.repository.events.list(),
    services.profileStore.loadPreferences(),
    services.goalManager.list(),
    services.planManager.current(),
  ]);
  const snapshot = { events };
  const insights = deriveLearningInsights(services.learningMap, services.challengeRegistry, snapshot, new Date());
  const profile = deriveLearnerProfile({
    learningMap: services.learningMap,
    challengeRegistry: services.challengeRegistry,
    snapshot, preferences, goals,
  });
  if (current.active) await services.taskOrchestrator.refreshUnlocks(current.active.planId);
  const tasks = current.active ? await services.taskOrchestrator.list(current.active.planId) : [];
  state = { events, preferences, goals, current, insights, profile, tasks };
  if (services?.context) services.context.profilePreferences = preferences;
  return state;
}

const REPLAN_EVENT_TYPES = new Set([
  "attempt", "completed", "assessment_passed",
  "learning_task_completed", "learning_task_failed",
  "learner_preferences_updated",
  "learning_goal_created", "learning_goal_updated",
  "learning_goal_paused", "learning_goal_resumed",
  "learning_goal_completed", "learning_goal_cancelled",
]);

async function maybeAutoReplan(incomingEvents = []) {
  if (autoReplanInFlight || !services) return;
  const relevant = incomingEvents.filter(event => REPLAN_EVENT_TYPES.has(event.type));
  if (!relevant.length) return;
  const cause = relevant.map(event => event.id).sort().join("|");
  if (cause === lastAutoReplanCause) return;
  autoReplanInFlight = true;
  try {
    const current = await services.planManager.current();
    const history = await services.planManager.history();
    const latestPlan = history.sort((a, b) =>
      Date.parse(b.generatedAt || b.updatedAt || 0) - Date.parse(a.generatedAt || a.updatedAt || 0)
    )[0];
    const planFactTimes = history.flatMap(plan =>
      [plan.generatedAt, plan.acceptedAt, plan.rejectedAt, plan.supersededAt]
        .filter(Boolean).map(value => Date.parse(value)).filter(Number.isFinite)
    );
    const baselineAt = planFactTimes.length ? Math.max(...planFactTimes) : 0;
    const newer = relevant.filter(event => Number.isFinite(Date.parse(event.at)) && Date.parse(event.at) > baselineAt);
    if (!newer.length) return;
    const activeGoals = state.goals.filter(goal => goal.status === "active");
    if (!current.active && !current.proposal && !activeGoals.length &&
        !newer.some(event => event.type === "attempt" || event.type === "assessment_passed" || event.type === "completed")) return;
    lastAutoReplanCause = cause;
    const reason = "检测到新的学习事实（" + newer.map(event => event.type).join("、") +
      "），按当前目标、掌握证据与任务执行情况重新评估；原计划继续保留。";
    const generated = await services.planManager.generate(services.context, reason, {
      horizonDays: current.active?.horizonDays || current.proposal?.horizonDays || 1,
    });
    await refreshAll();
    $("la-chat-status").textContent = "已根据新学习事实生成待确认计划 V" + generated.version + "；当前已接受计划未被覆盖。";
  } catch (error) {
    $("la-chat-status").textContent = "自动重规划暂未完成：" + (error.message || "未知错误") + "。原计划与学习记录保持不变。";
  } finally {
    autoReplanInFlight = false;
  }
}

function receiveLearningEvents(event) {
  const incoming = event.detail?.events || [];
  if (!incoming.length) return;
  pendingReplanEvents.push(...incoming);
  if (mutationInFlight || autoReplanInFlight) return;
  const next = pendingReplanEvents.splice(0);
  void maybeAutoReplan(next);
}

function renderMetrics() {
  const data = state.profile;
  const summary = data.mastery.summary;
  const metrics = [
    ["验证知识点", summary.testedCount + " / " + summary.totalCount, "有真实评估证据"],
    ["稳定掌握", summary.stableCount, "通过独立验证标准"],
    ["待补强", summary.weakCount, "含未解决薄弱点"],
    ["近 7 日证据", data.growth.evidenceLast7Days, "评估通过事件"],
  ];
  const host = $("la-metrics");
  host.replaceChildren();
  metrics.forEach(([label, value, note]) => {
    const card = create("article", "la-metric");
    card.append(create("span", "", label), create("strong", "", String(value)), create("small", "", note));
    host.append(card);
  });
}

function renderProfile() {
  const host = $("la-profile-summary");
  host.replaceChildren();
  const data = state.profile;
  const rows = [
    ["学习活跃度", data.behavior.learningDaysLast7 + " 天 / 最近 7 天"],
    ["挑战提示依赖", data.behavior.hintDependencyRate === null ? "暂无尝试记录" : Math.round(data.behavior.hintDependencyRate * 100) + "%"],
    ["任务完成率", data.behavior.taskCompletionRate === null ? "暂无任务记录" : Math.round(data.behavior.taskCompletionRate * 100) + "%"],
    ["学习频率目标", data.preferences.weeklyDays + " 天 / 周"],
    ["每日时间预算", data.preferences.dailyMinutes + " 分钟"],
  ];
  rows.forEach(([label, value]) => {
    const row = create("div", "la-profile-row");
    row.append(create("span", "", label), create("strong", "", value));
    host.append(row);
  });
  const gaps = $("la-gaps");
  gaps.replaceChildren();
  if (!data.mastery.activeGaps.length) gaps.append(create("p", "la-empty-small", "目前没有尚未解决的薄弱点记录。"));
  data.mastery.activeGaps.slice(0, 8).forEach(gap => {
    const item = create("article", "la-gap-item");
    item.append(create("strong", "", gap.label), create("span", "la-muted", gap.lifecycle + " · " + gap.count + " 次错误线索"));
    const link = siteLink("针对性复习", "./review/?competencyId=" + encodeURIComponent(gap.competencyId) + "&gapId=" + encodeURIComponent(gap.id));
    if (link) item.append(link);
    gaps.append(item);
  });
  const goals = $("la-profile-goals");
  goals.replaceChildren();
  state.profile.goals.forEach(goal => {
    const item = create("div", "la-goal-progress");
    const head = create("div", "la-inline-between");
    head.append(create("strong", "", goal.title), create("span", "la-muted", goal.stableCount + " / " + goal.targetCount + " 稳定掌握"));
    const track = create("div", "la-progress-track");
    const fill = create("span");
    fill.style.width = goal.progress + "%";
    track.append(fill);
    item.append(head, track);
    goals.append(item);
  });
  if (!state.profile.goals.length) goals.append(create("p", "la-empty-small", "创建目标后，这里会按知识掌握证据显示目标进度。"));
}

function renderGoals() {
  const host = $("la-goals-list");
  host.replaceChildren();
  if (!state.goals.length) {
    host.append(create("p", "la-empty-small", "目前还没有学习目标。创建目标后，Planner 将根据它的优先级和知识范围调整每日任务。"));
    return;
  }
  state.goals.forEach(goal => {
    const card = create("article", "la-goal-card");
    const top = create("div", "la-inline-between");
    const name = create("div");
    name.append(create("strong", "", goal.title),
      create("span", "la-goal-meta", (STATUS[goal.status] || goal.status) + " · 优先级 " + goal.priority + " · " + goal.dailyMinutes + " 分钟 / 日"));
    top.append(name, create("span", "la-state la-state-" + goal.status, STATUS[goal.status] || goal.status));
    const description = create("p", "la-body-small", goal.description || "未填写目标描述");
    const scope = create("div", "la-goal-scope", goal.topicIds.map(id => state.insights.topicInsights.find(topic => topic.id === id)?.title || id).join(" · "));
    card.append(top, description, scope);
    if (goal.targetAt) card.append(create("p", "la-goal-meta", "目标日期 · " + formatDate(goal.targetAt)));
    const progress = state.profile.goals.find(item => item.goalId === goal.goalId);
    if (progress) {
      const p = create("div", "la-progress-track");
      const fill = create("span");
      fill.style.width = progress.progress + "%";
      p.append(fill);
      card.append(p, create("span", "la-goal-meta", "稳定掌握 " + progress.stableCount + " / " + progress.targetCount + " · " + progress.progress + "%"));
    }
    const actions = create("div", "la-action-row");
    const edit = create("button", "la-button subtle", "编辑");
    edit.type = "button";
    edit.addEventListener("click", () => openGoalEditor(card, goal));
    actions.append(edit);
    if (goal.status === "active") {
      const pause = create("button", "la-button subtle", "暂停");
      pause.type = "button";
      pause.addEventListener("click", async () => runAction(() => services.goalManager.pause(goal.goalId)));
      actions.append(pause);
      const completed = create("button", "la-button subtle", "完成目标");
      completed.type = "button";
      completed.disabled = progress?.status !== "ready-to-complete";
      completed.title = completed.disabled ? "关联知识点尚未全部达到稳定掌握" : "根据当前 Learning Intelligence 状态验收";
      completed.addEventListener("click", async () => runAction(() => services.goalManager.complete(goal.goalId, state.profile)));
      actions.append(completed);
    } else if (goal.status === "paused") {
      const resume = create("button", "la-button subtle", "恢复");
      resume.type = "button";
      resume.addEventListener("click", async () => runAction(() => services.goalManager.resume(goal.goalId)));
      actions.append(resume);
    }
    if (["active", "paused"].includes(goal.status)) {
      const cancel = create("button", "la-button danger-ghost", "取消");
      cancel.type = "button";
      cancel.addEventListener("click", async () => {
        if (!window.confirm("取消目标？历史目标事件会保留。")) return;
        await runAction(() => services.goalManager.cancel(goal.goalId));
      });
      actions.append(cancel);
    }
    const remove = create("button", "la-button danger-ghost", "归档");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!window.confirm("归档该目标？系统会追加删除审计事件，不会删除学习历史。")) return;
      await runAction(() => services.goalManager.remove(goal.goalId));
    });
    actions.append(remove);
    card.append(actions);
    host.append(card);
  });
}

function openGoalEditor(card, goal) {
  const existing = card.querySelector(".la-goal-editor");
  if (existing) { existing.remove(); return; }
  const form = create("form", "la-goal-editor");
  const title = create("input");
  title.type = "text"; title.maxLength = 120; title.required = true; title.value = goal.title;
  const description = create("textarea");
  description.maxLength = 2000; description.rows = 2; description.value = goal.description;
  const priority = create("select");
  [1,2,3,4,5].forEach(n => { const o=create("option"); o.value=String(n); o.textContent="优先级 "+n; o.selected=n===goal.priority; priority.append(o); });
  const target = create("input");
  target.type = "date"; target.value = goal.targetAt ? new Date(goal.targetAt).toISOString().slice(0,10) : "";
  form.append(create("label", "", "目标名称"), title, create("label", "", "描述"), description,
    create("label", "", "优先级"), priority, create("label", "", "截止日期"), target);
  const actions = create("div", "la-action-row");
  const save = create("button", "la-button primary", "保存修改"); save.type = "submit";
  const cancel = create("button", "la-button subtle", "取消"); cancel.type="button"; cancel.addEventListener("click", () => form.remove());
  actions.append(save,cancel); form.append(actions);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const targetAt = target.value ? new Date(target.value + "T23:59:59").toISOString() : null;
    await runAction(() => services.goalManager.update(goal.goalId, {
      title: title.value, description: description.value, priority: Number(priority.value), targetAt,
    }));
  });
  card.append(form);
}

function renderPlan() {
  const proposalHost = $("la-plan-proposal");
  const activeHost = $("la-active-tasks");
  proposalHost.replaceChildren();
  activeHost.replaceChildren();
  const proposal = state.current?.proposal;
  if (proposal) {
    const card = create("article", "la-proposal-card");
    card.append(create("div", "la-inline-between",
      create("span", "la-state la-state-proposed", "待你确认"),
      create("span", "la-goal-meta", "计划版本 " + proposal.version + " · " + formatDate(proposal.generatedAt))));
    card.append(create("h3", "", proposal.headline),
      create("p", "la-body-small", proposal.reason),
      create("div", "la-plan-time", proposal.plannedMinutes + " / " + proposal.totalBudgetMinutes +
        " 分钟 · " + proposal.actions.length + " 项任务 · " + proposal.horizonDays + " 天 / " + proposal.activeStudyDays + " 个学习日"));
    if (proposal.blockedCompetencies?.length) {
      const blocked = create("div", "la-blocked-box");
      blocked.append(create("strong", "", "暂缓高级知识：前置知识尚未满足"));
      proposal.blockedCompetencies.slice(0, 8).forEach(item => {
        blocked.append(create("p", "la-muted", item.competencyTitle + " ← " + item.blockedBy.join("、")));
      });
      card.append(blocked);
    }
    proposal.actions.forEach((action, index) => {
      const item = create("div", "la-plan-action");
      item.append(create("span", "la-sequence", String(index + 1).padStart(2, "0")),
        create("div", "la-plan-action-main",
          create("strong", "", action.title || action.competencyTitle),
          create("p", "la-muted", action.topicTitle + " · " + action.planDate + " · " + action.estimatedMinutes + " 分钟"),
          create("p", "la-reason", (action.priorityReasons || []).join("；"))));
      const link = siteLink(action.resourceLabel || "查看学习入口", action.href, "la-link");
      if (link) item.append(link);
      card.append(item);
    });
    const buttons = create("div", "la-action-row");
    const accept = create("button", "la-button primary", "接受计划并创建任务"); accept.type="button";
    accept.addEventListener("click", async () => runAction(() => services.planManager.accept(proposal.planId)));
    const reject = create("button", "la-button subtle", "拒绝提案"); reject.type="button";
    reject.addEventListener("click", async () => runAction(() => services.planManager.reject(proposal.planId)));
    buttons.append(accept,reject); card.append(buttons);
    proposalHost.append(card);
  } else {
    proposalHost.append(create("p", "la-empty-small", "当前没有待确认的计划提案。生成新计划后，会先在这里展示推荐理由，不会自动覆盖已接受计划。"));
  }

  if (!state.current?.active) {
    activeHost.append(create("p", "la-empty-small", "尚无已接受的计划。接受提案后，系统会创建持久化任务并开放执行。"));
    return;
  }
  const heading = create("div", "la-plan-active-head");
  heading.append(create("div", "", create("strong", "", "当前执行计划 · V" + state.current.active.version)),
    create("span", "la-goal-meta", state.current.active.plannedMinutes + " / " +
      state.current.active.totalBudgetMinutes + " 分钟 · " + state.current.active.horizonDays + " 天"));
  activeHost.append(heading);
  if (!state.tasks.length) {
    activeHost.append(create("p", "la-empty-small", "这个计划没有任务；可生成新版本计划。"));
    return;
  }
  state.tasks.forEach(task => {
    const card = create("article", "la-task-card");
    const header = create("div", "la-inline-between");
    header.append(create("strong", "", task.title),
      create("span", "la-state la-state-" + task.status, STATUS[task.status] || task.status));
    card.append(header,
      create("p", "la-muted", task.topicTitle + " · " + task.planDate + " · 预计 " + task.estimatedMinutes + " 分钟"),
      create("p", "la-reason", (task.priorityReasons || []).join("；")));
    if (task.pauseReason) card.append(create("p", "la-muted", "暂停原因：" + task.pauseReason));
    const resource = siteLink(task.resourceLabel || task.resourceTitle || "打开对应学习内容", task.href, "la-link");
    if (resource) card.append(resource);
    const buttons = create("div", "la-action-row");
    const addAction = (label, css, callback) => {
      const button = create("button", "la-button " + css, label); button.type="button";
      button.addEventListener("click", async () => runAction(callback));
      buttons.append(button);
    };
    if (task.status === "ready") addAction("开始任务", "primary", () => services.taskOrchestrator.start(task.taskId));
    if (task.status === "in_progress") {
      addAction("暂停", "subtle", () => services.taskOrchestrator.pause(task.taskId));
      addAction(task.evidencePolicy === "required_assessment" ? "验证并完成" : "完成阅读任务", "primary",
        () => services.taskOrchestrator.complete(task.taskId));
    }
    if (task.status === "paused") addAction("继续执行", "primary", () => services.taskOrchestrator.transition(task.taskId, "in_progress"));
    if (task.status === "failed") addAction("重试", "subtle", () => services.taskOrchestrator.retry(task.taskId));
    if (["ready", "paused"].includes(task.status)) addAction("跳过", "danger-ghost", () => services.taskOrchestrator.skip(task.taskId));
    card.append(buttons);
    if (task.status === "completed") {
      card.append(create("p", "la-success-note", "任务完成已记录。掌握状态仍由真实挑战和独立验证证据单独决定。"));
    }
    activeHost.append(card);
  });
}

function renderMessages() {
  const host = $("la-messages");
  host.replaceChildren();
  messages.forEach(message => {
    const article = create("article", "la-message la-message-" + message.role);
    const head = create("div", "la-message-head");
    head.append(create("strong", "", message.role === "user" ? "你" : "KNOWVERSE Agent"),
      create("time", "", new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))));
    const body = create("p", "", message.content);
    article.append(head, body);
    (message.metadata?.suggestions || []).forEach(suggestion => {
      const action = create("button", "la-button primary la-suggestion-button", "确认：" + suggestion.label);
      action.type = "button";
      action.addEventListener("click", async () => {
        action.disabled = true;
        try {
          await runAction(() => executeAgentTool(suggestion.toolName, suggestion.input, services.context, {
            origin: "learner", confirmed: true,
          }));
          await sessionStoreMessage("assistant", "已按你的确认执行「" + suggestion.label + "」。结果已保存并可在对应面板查看。", {
            mode: "rules", resultType: suggestion.toolName,
          });
        } catch (error) {
          action.disabled = false;
          await sessionStoreMessage("assistant", "执行失败：" + (error.message || "未知错误") + "。未执行的操作不会被视为成功。", { mode: "rules" });
        }
      });
      article.append(action);
    });
    host.append(article);
  });
  host.scrollTop = host.scrollHeight;
}

async function sessionStoreMessage(role, content, metadata) {
  const message = await services.sessionStore.appendMessage(session.sessionId, role, content, metadata);
  messages.push(message);
  renderMessages();
  return message;
}

function compactAgentToolResult(toolName, result) {
  if (toolName === "get_learner_profile") {
    return {
      generatedAt: result.generatedAt,
      goals: result.goals.slice(0, 10),
      mastery: {
        summary: result.mastery.summary,
        weakCompetencies: result.mastery.weakCompetencies.slice(0, 12),
        unverifiedCompetencies: result.mastery.unverifiedCompetencies.slice(0, 12),
        activeGaps: result.mastery.activeGaps.slice(0, 12),
        prerequisiteGaps: result.mastery.prerequisiteGaps.slice(0, 12),
      },
      behavior: {
        learningDaysLast7: result.behavior.learningDaysLast7,
        learningDaysLast30: result.behavior.learningDaysLast30,
        taskCompletionRate: result.behavior.taskCompletionRate,
        hintDependencyRate: result.behavior.hintDependencyRate,
        attempts: result.behavior.attempts,
        topicPerformance: result.behavior.topicPerformance.slice(0, 12),
      },
      growth: {
        recentActivityAt: result.growth.recentActivityAt,
        evidenceLast7Days: result.growth.evidenceLast7Days,
        recentEvents: result.growth.recentEvents.slice(-12),
      },
      evidenceRefs: {
        mastery: result.evidenceRefs.mastery.slice(-20),
        gaps: result.evidenceRefs.gaps.slice(-20),
      },
    };
  }
  if (toolName === "get_learning_history") {
    return result.slice(0, 30).map(event => ({
      id: event.id, type: event.type, at: event.at,
      topicId: event.topicId, competencyIds: event.competencyIds,
      challengeTitle: event.challengeTitle, stepTitle: event.stepTitle,
      correct: event.correct, hintsUsed: event.hintsUsed,
      gapId: event.gapId, variantId: event.variantId,
    }));
  }
  if (toolName === "get_learning_graph") {
    const topics = Array.isArray(result) ? result : result.topics || [];
    return topics.slice(0, 10).map(topic => ({
      id: topic.id, title: topic.title,
      prerequisites: topic.prerequisites || [],
      competencies: (topic.competencies || []).slice(0, 30).map(item => ({
        id: item.id, title: item.title, prerequisites: item.prerequisites || [],
      })),
    }));
  }
  if (toolName === "get_learning_goals") {
    return result.slice(0, 20).map(goal => ({
      goalId: goal.goalId, title: goal.title, status: goal.status,
      topicIds: goal.topicIds, competencyIds: goal.competencyIds,
      targetAt: goal.targetAt, priority: goal.priority,
      dailyMinutes: goal.dailyMinutes,
    }));
  }
  if (toolName === "get_mastery_snapshot") return result.slice(0, 20);
  if (toolName === "get_active_gaps") return result.slice(0, 12);
  if (toolName === "get_review_recommendations") return result.slice(0, 12);
  return result;
}

async function sendMessage(text) {
  if (loading) return;
  loading = true;
  $("la-send").disabled = true;
  $("la-chat-status").textContent = "正在分析当前学习状态…";
  try {
    await sessionStoreMessage("user", text, { mode: "rules" });
    let response;
    if ($("la-ai-consent").checked) {
      const selected = {
        goals: state.goals.filter(goal => goal.status === "active").map(goal => ({
          goalId: goal.goalId, title: goal.title, topicIds: goal.topicIds,
          competencyIds: goal.competencyIds, priority: goal.priority,
          targetAt: goal.targetAt, dailyMinutes: goal.dailyMinutes,
        })),
        mastery: state.profile.mastery.summary,
        weakPoints: state.profile.mastery.activeGaps.slice(0, 20),
        recentConversation: messages.slice(-6).map(item => ({
          role: item.role, content: item.content.slice(0, 1000),
        })),
        competencyStates: state.insights.competencyInsights.slice(0, 30).map(item => ({
          id: item.id, title: item.title, topicId: item.topicId, status: item.status,
          masteryScore: item.masteryScore, confidenceScore: item.confidenceScore,
          evidenceCount: item.evidenceCount, nextReviewAt: item.nextReviewAt,
        })),
        activePlan: state.current.active ? {
          planId: state.current.active.planId, version: state.current.active.version,
          headline: state.current.active.headline,
        } : null,
      };
      try {
        const firstPass = await services.provider.ask({ message: text, context: selected });
        let result = firstPass;
        if (firstPass.dataRequests.length) {
          const toolResults = await Promise.all(firstPass.dataRequests.map(async request => {
            const data = await executeAgentTool(request.toolName, request.input, services.context, {
              origin: "model", confirmed: false,
            });
            return {
              toolName: request.toolName,
              input: request.input,
              result: compactAgentToolResult(request.toolName, data),
            };
          }));
          const retrievedContext = {
            ...selected,
            requestedToolResults: toolResults,
          };
          result = await services.provider.ask({ message: text, context: retrievedContext });
          if (result.dataRequests.length) {
            result.reply += "\n\n（我已完成一轮只读资料检索；更多资料请求需要你提出后续问题，以避免无限检索。）";
          }
        }
        response = { mode: "ai", reply: result.reply, suggestions: result.suggestions };
      } catch (error) {
        const fallback = await answerWithLocalRules(text, services.context);
        const unavailable = error.code === "AI_PROVIDER_NOT_CONFIGURED"
          ? "云端 AI Provider 尚未配置 API Key；"
          : error.code === "AI_AUTH_REQUIRED"
            ? "当前尚未完成 GitHub 登录；"
            : error.code === "AI_TIMEOUT"
              ? "云端 AI 请求超时；"
              : "云端 AI 暂不可用（" + (error.code || error.status || "连接错误") + "）；";
        response = {
          mode: "rules",
          reply: unavailable + "我已切换到本地确定性规则模式。\n\n" + fallback.reply,
          proposal: fallback.proposal,
        };
      }
    } else {
      response = await answerWithLocalRules(text, services.context);
    }
    if (response.proposal?.kind === "plan") lastProposal = response.proposal.planId;
    await sessionStoreMessage("assistant", response.reply, {
      mode: response.mode || "rules",
      suggestions: response.suggestions || [],
    });
    await refreshAll();
    $("la-chat-status").textContent = response.mode === "ai"
      ? "云端 AI 已回复 · 所有工具建议都需你确认"
      : "本地规则模式 · 学习数据保留在当前学习档案";
  } catch (error) {
    await sessionStoreMessage("assistant", "本次操作未完成：" + (error.message || "未知错误"), { mode: "rules", errorCode: error.code || null });
    $("la-chat-status").textContent = "发生错误，学习记录未被静默覆盖";
  } finally {
    loading = false;
    $("la-send").disabled = false;
  }
}

async function runAction(callback) {
  mutationInFlight = true;
  try {
    await callback();
    await refreshAll();
    $("la-chat-status").textContent = "已保存 · 本机 IndexedDB 是当前学习记录的权威副本";
  } catch (error) {
    window.alert(error.message || "操作失败，原有学习状态保持不变。");
  } finally {
    mutationInFlight = false;
    if (pendingReplanEvents.length) {
      const next = pendingReplanEvents.splice(0);
      await maybeAutoReplan(next);
    }
  }
}

async function refreshAll() {
  await refreshState();
  renderMetrics();
  renderProfile();
  renderGoals();
  renderPlan();
}

function bindGoalForm() {
  const form = $("la-create-goal");
  const topicSelect = $("la-goal-topics");
  state.insights.topicInsights.forEach(topic => {
    const option = create("option");
    option.value = topic.id; option.textContent = topic.title;
    topicSelect.append(option);
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const topicIds = [...topicSelect.selectedOptions].map(option => option.value);
    if (!topicIds.length) { window.alert("请至少选择一个知识专题。"); return; }
    const target = $("la-goal-date").value;
    const goal = {
      title: $("la-goal-title").value,
      description: $("la-goal-description").value,
      topicIds,
      competencyIds: [],
      targetAt: target ? new Date(target + "T23:59:59").toISOString() : null,
      dailyMinutes: Number($("la-goal-minutes").value),
      priority: Number($("la-goal-priority").value),
      acceptanceCriteria: $("la-goal-criteria").value,
    };
    await runAction(() => services.goalManager.create(goal));
    form.reset();
    $("la-goal-minutes").value = "25";
    $("la-goal-priority").value = "3";
  });
}

function bindPreferences() {
  const focusSelect = $("la-pref-topics");
  const saveButton = $("la-save-preferences");
  const replanButton = $("la-regenerate-plan");
  state.insights.topicInsights.forEach(topic => {
    const option = create("option");
    option.value = topic.id;
    option.textContent = topic.title;
    focusSelect.append(option);
  });
  $("la-daily-minutes").value = String(state.profile.preferences.dailyMinutes);
  $("la-weekly-days").value = String(state.profile.preferences.weeklyDays);
  $("la-pref-topics").value = state.profile.preferences.preferredTopicIds[0] || "all";
  saveButton.addEventListener("click", async () => {
    if (saveButton.disabled || replanButton.disabled) return;
    const topics = $("la-pref-topics").value;
    saveButton.disabled = true;
    replanButton.disabled = true;
    try {
      await runAction(async () => {
        await services.profileStore.savePreferences({
          ...state.profile.preferences,
          dailyMinutes: Number($("la-daily-minutes").value),
          weeklyDays: Number($("la-weekly-days").value),
          preferredTopicIds: topics === "all" ? [] : [topics],
        });
      });
    } finally {
      saveButton.disabled = false;
      replanButton.disabled = false;
    }
  });
  replanButton.addEventListener("click", async () => {
    if (saveButton.disabled || replanButton.disabled) return;
    saveButton.disabled = true;
    replanButton.disabled = true;
    replanButton.textContent = "正在重新计算…";
    try {
      const plan = await services.planManager.generate(services.context, "学习者在工作区点击重新规划");
      await refreshAll();
      $("la-chat-status").textContent = "已生成计划提案 V" + plan.version + "，尚未生效。";
      document.getElementById("la-plan-proposal").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      $("la-chat-status").textContent = "重新规划失败：" + (error.message || "未知错误") + "；原计划保持不变。";
    } finally {
      saveButton.disabled = false;
      replanButton.disabled = false;
      replanButton.textContent = "重新分析并规划 ↻";
    }
  });
}

function bindChat() {
  const form = $("la-chat-form");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const input = $("la-chat-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await sendMessage(text);
  });
  $("la-ai-consent").addEventListener("change", () => {
    $("la-ai-consent-note").textContent = $("la-ai-consent").checked
      ? "本轮将把你输入的问题和上方显示的最小学习摘要发送至 Supabase Edge Function；不会发送原始答题日志、整份档案或身份凭据。"
      : "未勾选时只在本机运行规则引擎，不向模型发送学习数据。";
  });
}

async function initialize() {
  const [learningMap, worksManifest, challengeRegistry, checkpointRegistry] = await Promise.all([
    readJSON("../../../content/learning-map.json"),
    readJSON("../../../content/works.json"),
    readJSON("../../../content/challenges.json"),
    readJSON("../../../content/learning-checkpoints.json"),
  ]);
  const repository = await getLearningRepository();
  const progressStore = createLearningProgressStore({ repository });
  const profileStore = createLearnerProfileStore({ repository });
  const goalManager = createLearningGoalManager({ repository, learningMap });
  const taskOrchestrator = createLearningTaskOrchestrator({ repository });
  const planManager = createLearningPlanManager({ repository, taskOrchestrator });
  const sessionStore = createAgentSessionStore({ repository });
  const provider = createLearningAgentProvider();
  services = {
    repository, progressStore, profileStore, goalManager, taskOrchestrator,
    planManager, sessionStore, provider,
    learningMap, worksManifest, challengeRegistry, checkpointRegistry,
  };
  services.context = {
    ...services,
    repository, profileStore, goalManager, taskOrchestrator, planManager,
    learningMap, worksManifest, challengeRegistry, checkpointRegistry,
  };
  session = await sessionStore.latestSession();
  messages = await sessionStore.listMessages(session.sessionId);
  if (!messages.length) {
    const welcome = await sessionStore.appendMessage(session.sessionId, "assistant",
      "我已经连接到你的本地学习档案。可以先创建一个目标，或让我分析当前掌握证据并生成一份待确认计划。规则模式不会把任务完成当成知识掌握。", { mode: "rules" });
    messages = [welcome];
  }
  await refreshAll();
  bindGoalForm();
  bindPreferences();
  bindChat();
  renderMessages();
  window.addEventListener("knowverse:learning-events-appended", receiveLearningEvents);
  await maybeAutoReplan(state.events);
  $("la-ai-availability").textContent = provider.configured
    ? "Supabase 已配置 · 云端 AI 需要登录并完成本轮数据授权"
    : "当前为本地规则模式 · 可使用目标、计划和任务管理";
  $("la-workspace-loading").hidden = true;
  $("la-workspace").hidden = false;
}

initialize().catch(error => {
  $("la-workspace-loading").textContent = "学习工作区初始化失败：" + (error.message || "未知错误") +
    "。请检查浏览器是否支持 IndexedDB，以及知识注册表是否正常部署。";
  $("la-workspace-loading").classList.add("la-error");
});
