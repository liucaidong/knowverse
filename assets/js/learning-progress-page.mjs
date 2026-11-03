import { createLearningProgressStore, deriveLearningInsights } from "./learning-progress.mjs";
import { buildAdaptiveLearningPlan, createLearningPlanPreferencesStore, recordLearningPlanAction } from "./learning-planner.mjs";
import { mountBackendAccountPanel } from "./backend/account-panel.mjs";
import { getLearningRepository } from "./backend/learning-repository.mjs";
import { createLearnerProfileStore } from "./learning-agent/learner-profile.mjs";
import { createLearningGoalManager } from "./learning-agent/goal-manager.mjs";
import { createLearningTaskOrchestrator } from "./learning-agent/task-orchestrator.mjs";
import { createProactiveLearningEngine } from "./proactive-learning-engine.mjs";

const siteRoot = new URL("../../", import.meta.url);
const $ = id => document.getElementById(id);
const store = createLearningProgressStore();
const planPreferencesStore = createLearningPlanPreferencesStore();
let worksManifest;
let checkpointRegistry;
let planPreferences = { dailyMinutes: 25, focusTopicId: "all" };
let adaptivePlan;
let knowledge;
let learningMap;
let challengeRegistry;
let insights;
let selectedTopicId = null;
let selectedCompetencyId = null;
let proactiveEngine = null;
let proactiveRefreshTimer = null;
let proactiveProjection = null;
let proactiveTasks = [];
let taskOrchestrator = null;

const statusLabels = {
  unverified: "待验证",
  weak: "需要补强",
  building: "正在建立",
  initial: "初步掌握",
  stable: "稳定掌握",
};

function safeHref(path) {
  if (typeof path !== "string" || !path.startsWith("./")) return null;
  const url = new URL(path.slice(2), siteRoot);
  return url.origin === siteRoot.origin && url.pathname.startsWith(siteRoot.pathname) ? url.href : null;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function makeLink(label, path) {
  const href = safeHref(path);
  if (!href) return null;
  const link = element("a", "", label + " ↗");
  link.href = href;
  return link;
}

function formatDate(value, includeTime = false) {
  if (!value) return "尚无记录";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "日期未知";
  return new Intl.DateTimeFormat("zh-CN", includeTime
    ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value;
}

function renderMetrics() {
  const summary = insights.summary;
  setText("hero-tested", summary.testedCount + " / " + summary.totalCount);
  setText("hero-stable", String(summary.stableCount));
  setText("hero-due", String(summary.dueCount));
  setText("hero-events", String(insights.eventsCount));
  setText("hero-verify", String(summary.pendingVerificationCount || 0));
  setText("metric-average", summary.averageScore === null ? "—" : summary.averageScore + "%");
  setText("metric-weak", String(summary.weakCount));
  setText("metric-completed", String(summary.completions));
  setText("metric-hints", String(summary.hints));
  const confidenceRows = insights.competencyInsights.filter(item => item.evidenceCount);
  const averageConfidence = confidenceRows.length
    ? Math.round(confidenceRows.reduce((total, item) => total + (item.confidenceScore || 0), 0) / confidenceRows.length)
    : null;
  setText("metric-confidence", averageConfidence === null ? "—" : averageConfidence + "%");
  $("first-run-callout").hidden = summary.attempts + summary.completions > 0;
  $("storage-status").textContent = store.available
    ? "学习事件先保存在本机，并镜像到 IndexedDB 同步队列。云端账户配置后可跨设备同步；JSON 导出仍可作为独立备份。"
    : "当前浏览器不支持 IndexedDB，学习事件无法持久保存。请使用支持 IndexedDB 的常规浏览器。";
}

function renderTopicOverview() {
  const host = $("topic-overview");
  host.replaceChildren();
  insights.topicInsights.forEach(topic => {
    const card = element("article", "lp-topic-card");
    const heading = element("strong", "", topic.title);
    const text = element("p", "", topic.testedCount
      ? topic.testedCount + " / " + topic.totalCount + " 个知识点已验证 · " + topic.stableCount + " 个稳定掌握"
      : "尚无挑战证据 · " + topic.totalCount + " 个可验证知识点");
    const track = element("div", "lp-topic-track");
    const fill = element("span");
    fill.style.width = (topic.totalCount ? topic.testedCount / topic.totalCount * 100 : 0) + "%";
    track.append(fill);
    card.append(heading, text, track);
    host.append(card);
  });
  const tracked = new Set(learningMap.topics.map(topic => topic.id));
  const notTracked = knowledge.topics.filter(topic => !tracked.has(topic.id));
  if (notTracked.length) {
    const card = element("article", "lp-topic-card");
    card.append(
      element("strong", "", "其他知识专题"),
      element("p", "", notTracked.length + " 个专题尚未接入可量化挑战；不计入掌握率。")
    );
    host.append(card);
  }
}

function renderTopicChoices() {
  const host = $("topic-choices");
  host.replaceChildren();
  learningMap.topics.forEach(topic => {
    const button = element("button", "lp-topic-choice", topic.title);
    button.type = "button";
    button.dataset.topicId = topic.id;
    button.setAttribute("aria-pressed", String(topic.id === selectedTopicId));
    button.addEventListener("click", () => {
      selectedTopicId = topic.id;
      selectedCompetencyId = topic.competencies[0]?.id || null;
      renderTopicChoices();
      renderGraph();
    });
    host.append(button);
  });
}

function pathBetween(a, b) {
  const startX = a.x + 188;
  const startY = a.y + 49;
  const endX = b.x;
  const endY = b.y + 49;
  const bend = Math.max(30, (endX - startX) * 0.45);
  return "M " + startX + " " + startY + " C " + (startX + bend) + " " + startY + ", " + (endX - bend) + " " + endY + ", " + endX + " " + endY;
}

function renderGraph() {
  const topic = learningMap.topics.find(item => item.id === selectedTopicId) || learningMap.topics[0];
  if (!topic) return;
  const competencyMap = new Map(topic.competencies.map(item => [item.id, insights.competencyInsights.find(row => row.id === item.id)]));
  const maxX = Math.max(topic.graph.width, ...topic.competencies.map(item => item.position.x + 188));
  const maxY = Math.max(topic.graph.height, ...topic.competencies.map(item => item.position.y + 110));
  const canvas = $("graph-canvas");
  canvas.replaceChildren();
  canvas.style.width = maxX + "px";
  canvas.style.height = maxY + "px";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 " + maxX + " " + maxY);
  svg.setAttribute("aria-hidden", "true");
  topic.competencies.forEach(competency => {
    competency.prerequisites.forEach(id => {
      const parent = topic.competencies.find(item => item.id === id);
      if (!parent) return;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathBetween(parent.position, competency.position));
      svg.append(path);
    });
  });
  canvas.append(svg);

  topic.competencies.forEach(competency => {
    const state = competencyMap.get(competency.id);
    const button = element("button", "lp-node");
    button.type = "button";
    button.dataset.status = state.status;
    button.setAttribute("aria-pressed", String(competency.id === selectedCompetencyId));
    button.style.left = competency.position.x + "px";
    button.style.top = competency.position.y + "px";
    const top = element("span", "lp-node-top");
    top.append(element("span", "lp-node-name", competency.title), element("span", "lp-node-state", statusLabels[state.status]));
    button.append(top, element("strong", "lp-node-score", state.masteryScore === null ? "待验证" : state.masteryScore + "%"));
    button.addEventListener("click", () => {
      selectedCompetencyId = competency.id;
      renderGraph();
    });
    canvas.append(button);
  });
  renderNodeDetail(topic, selectedCompetencyId || topic.competencies[0]?.id);
}

function renderNodeDetail(topic, competencyId) {
  const competency = topic.competencies.find(item => item.id === competencyId) || topic.competencies[0];
  const state = insights.competencyInsights.find(item => item.id === competency?.id);
  const host = $("node-detail");
  host.replaceChildren();
  if (!competency || !state) {
    host.append(element("p", "lp-empty", "暂无知识节点。"));
    return;
  }

  const main = element("div");
  main.append(element("h3", "", competency.title), element("p", "", competency.description));
  const meta = element("div", "lp-detail-meta");
  meta.append(
    element("span", "lp-chip", "状态 · " + state.statusLabel),
    element("span", "lp-chip", "掌握度 · " + (state.masteryScore === null ? "待验证" : state.masteryScore + "%")),
    element("span", "lp-chip", "置信度 · " + (state.confidenceScore ?? 0) + "%"),
    element("span", "lp-chip", "验证 · " + state.evidenceCount + " 次"),
    element("span", "lp-chip", "变体 · " + (state.variantCount || 0) + " 种"),
    element("span", "lp-chip", "无提示 · " + (state.hintFreeRatio ?? 0) + "%")
  );
  main.append(meta);
  main.append(element("p", "", state.lastEvidenceAt
    ? "最近一次验证：" + formatDate(state.lastEvidenceAt) + " · 建议复习：" + formatDate(state.nextReviewAt)
    : "尚无真实挑战证据。完成关联挑战后，掌握状态和复习时间会在这里更新。"));
  const prereqs = element("div", "lp-prereqs");
  const required = competency.prerequisites.map(id => topic.competencies.find(item => item.id === id)?.title).filter(Boolean);
  prereqs.append(element("span", "", required.length ? "前置知识：" + required.join("、") : "该节点没有登记前置知识"));
  main.append(prereqs);

  const side = element("div");
  const links = element("div", "lp-detail-links");
  const lesson = makeLink("看原理", competency.lessonHref || topic.href);
  const lab = makeLink("做实验", competency.labHref || "./lab/");
  const challenge = makeLink("进入原始挑战", competency.challengeHref || topic.challengeHref);
  const review = makeLink("立即复习", "./review/?competencyId=" + encodeURIComponent(competency.id));
  if (lesson) links.append(lesson);
  if (lab) links.append(lab);
  if (challenge) links.append(challenge);
  if (review) links.append(review);
  side.append(links);
  const recentGap = state.activeGaps[0];
  if (recentGap) side.append(element("p", "", "最近薄弱点：" + recentGap.label + " · " + recentGap.count + " 次"));
  host.append(main, side);
}

function renderGapList() {
  const host = $("gap-list");
  host.replaceChildren();
  if (!insights.gaps.length) {
    host.append(element("div", "lp-empty", insights.eventsCount
      ? "当前没有尚未纠正的概念误区。新的错误会在这里留下可追踪记录。"
      : "完成挑战后，这里会按错误概念识别薄弱点，并关联回课程和挑战。"));
    return;
  }
  insights.gaps.slice(0, 8).forEach(gap => {
    const card = element("article", "lp-list-card");
    const copy = element("div");
    copy.append(element("h3", "", gap.label), element("p", "", gap.description || gap.competencyTitle + " · 最近发生 " + formatDate(gap.lastSeenAt)));
    copy.append(element("span", "lp-tag", gap.lifecycleLabel || "待复习"));
    copy.append(element("span", "lp-tag info", "出现 " + gap.count + " 次"));
    const link = makeLink("针对性复习", "./review/?competencyId=" + encodeURIComponent(gap.competencyId) + "&gapId=" + encodeURIComponent(gap.id));
    card.append(copy);
    if (link) card.append(link);
    host.append(card);
  });
}

function renderWeakSkills() {
  const host = $("weak-skill-list");
  host.replaceChildren();
  const rows = insights.weakCompetencies.slice().sort((a, b) => (a.masteryScore ?? 100) - (b.masteryScore ?? 100));
  if (!rows.length) {
    host.append(element("div", "lp-empty", "目前没有足够证据判定某个知识点需要补强。待验证知识点不会被误报为薄弱点。"));
    return;
  }
  rows.forEach(item => {
    const card = element("article", "lp-list-card");
    const copy = element("div");
    const scoreText = item.masteryScore === null ? "尚无成功证据" : "掌握度 " + item.masteryScore + "%";
    copy.append(element("h3", "", item.title), element("p", "", item.topicTitle + " · " + scoreText + " · 置信度 " + (item.confidenceScore || 0) + "% · 最近验证 " + formatDate(item.lastEvidenceAt)));
    const targetGap = item.activeGaps[0];
    const reviewPath = targetGap
      ? "./review/?competencyId=" + encodeURIComponent(item.id) + "&gapId=" + encodeURIComponent(targetGap.id)
      : "./review/?competencyId=" + encodeURIComponent(item.id);
    const link = makeLink("进入复习工作台", reviewPath);
    card.append(copy);
    if (link) card.append(link);
    host.append(card);
  });
}

function renderProactiveDashboard() {
  const projection = proactiveProjection;
  const kpis = $("proactive-kpis");
  const actionsHost = $("proactive-actions");
  const queueHost = $("proactive-review-queue");
  const risksHost = $("proactive-risks");
  const trendsHost = $("proactive-trends");
  const diagnosticsHost = $("proactive-diagnostics");
  const forecastsHost = $("proactive-forecasts");
  const timelineHost = $("proactive-timeline");
  [kpis, actionsHost, queueHost, risksHost, trendsHost, diagnosticsHost, forecastsHost, timelineHost]
    .filter(Boolean).forEach(host => host.replaceChildren());
  if (!projection) {
    actionsHost?.append(element("div", "lp-empty", "主动学习引擎尚未生成投影。刷新页面后会从真实学习事件重建。"));
    return;
  }
  const summary = projection.summary || {};
  [
    ["到期复习", summary.dueCount || 0, "due / overdue / relearning"],
    ["高风险知识", summary.highRiskCount || 0, "high / critical"],
    ["未解决薄弱点", summary.activeGapCount || 0, "Learning Intelligence"],
    ["活动目标", summary.activeGoalCount || 0, "Goal Manager"],
    ["待执行任务", summary.taskBacklogCount || 0, "Task Orchestrator"],
  ].forEach(([label, value, note]) => {
    const card = element("article", "lp-proactive-kpi");
    card.append(element("span", "", label), element("strong", "", String(value)), element("small", "", note));
    kpis.append(card);
  });

  const confidenceText = value => value === "high" ? "证据充分" : value === "medium" ? "证据中等" : "初始估算";
  const actionList = projection.nextBestActions || [];
  if (!actionList.length) {
    actionsHost.append(element("div", "lp-empty", "当前没有可执行的优先行动。若尚无挑战证据，这是正常状态；完成一次真实挑战后，系统会重新评估。"));
  }
  actionList.slice(0, 5).forEach(action => {
    const card = element("article", "lp-proactive-action");
    const head = element("div", "lp-proactive-action-head");
    head.append(element("span", "lp-tag " + (action.type.includes("review") ? "" : "good"), action.type),
      element("span", "lp-plan-time", "排序分 " + action.score + " · " + confidenceText(action.confidence)));
    card.append(head, element("h3", "", action.title),
      element("p", "", action.topicTitle + " · 预计 " + action.estimatedMinutes + " 分钟"));
    (action.reasons || []).slice(0, 4).forEach(reason => card.append(element("p", "lp-proactive-reason", reason)));
    if (action.expectedOutcome) card.append(element("small", "lp-proactive-outcome", "预期：" + action.expectedOutcome));
    if (action.deferImpact) card.append(element("small", "lp-proactive-defer", "延后影响：" + action.deferImpact));
    const href = safeHref(action.href);
    if (href) {
      const button = element("button", "lp-data-button primary", action.taskId ? "执行关联任务 →" : "开始行动 →");
      button.type = "button";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          if (action.taskId) {
            let task = await taskOrchestrator.get(action.taskId);
            if (!task) throw new Error("推荐任务已不存在，请重新计算学习行动。");
            if (task.status === "failed") task = await taskOrchestrator.retry(task.taskId);
            if (task.status === "paused") task = await taskOrchestrator.transition(task.taskId, "in_progress");
            else if (task.status === "ready") task = await taskOrchestrator.start(task.taskId);
            if (!["in_progress", "completed"].includes(task.status)) {
              throw new Error("任务当前状态为 " + task.status + "，无法进入执行。");
            }
          }
          await refresh();
          window.location.assign(href);
        } catch (error) {
          button.disabled = false;
          window.alert(error.message || "无法启动该学习行动。");
        }
      });
      card.append(button);
      if (action.taskId && ["ready", "paused"].includes(action.taskStatus) &&
          ["spaced-review", "targeted-review", "continue-task"].includes(action.type)) {
        const skip = element("button", "lp-data-button", "暂时跳过");
        skip.type = "button";
        skip.addEventListener("click", async () => {
          const reason = window.prompt("请记录本次跳过原因（例如：今天时间不足，改到明天复习）：");
          if (reason === null) return;
          if (!reason.trim()) {
            window.alert("请填写跳过原因，系统才能保留可追溯记录。");
            return;
          }
          skip.disabled = true;
          try {
            await taskOrchestrator.skip(action.taskId, { reason: reason.trim().slice(0, 500) });
            await refresh();
          } catch (error) {
            skip.disabled = false;
            window.alert(error.message || "无法记录跳过原因。");
          }
        });
        card.append(skip);
      }
    } else {
      card.append(element("small", "lp-proactive-muted", "尚未注册可直接打开的学习资源入口。"));
    }
    actionsHost.append(card);
  });

  const schedules = projection.schedules || [];
  const due = schedules.filter(item => ["due", "overdue", "relearning"].includes(item.status))
    .sort((a,b) => (b.overdueDays||0)-(a.overdueDays||0));
  if (!due.length) queueHost.append(element("div", "lp-empty", "目前没有到期或逾期复习。未来复习时间由独立验证质量动态计算。"));
  due.slice(0, 12).forEach(item => {
    const task = proactiveTasks.find(row => row.proactiveScheduleTarget === item.competencyId + "::competency" &&
      !["completed","skipped","cancelled"].includes(row.status)) ||
      proactiveTasks.find(row => row.competencyId === item.competencyId && row.gapId &&
        !["completed","skipped","cancelled"].includes(row.status));
    const skippedTask = proactiveTasks.find(row => row.competencyId === item.competencyId &&
      row.status === "skipped");
    const card = element("article", "lp-list-card");
    const copy = element("div");
    const label = item.status === "overdue" ? "已逾期" : item.status === "relearning" ? "重新学习" : "现在应复习";
    copy.append(element("span", "lp-tag", label),
      element("h3", "", item.competencyTitle),
      element("p", "", item.topicTitle + " · 稳定间隔 " + (item.stabilityDays ?? "—") +
        " 天 · 上次验证 " + formatDate(item.lastEvidenceAt) +
        (item.overdueDays ? " · 逾期 " + item.overdueDays + " 天" : "") +
        " · " + confidenceText(item.confidence)));
    if (item.latestQualityReason) copy.append(element("small", "lp-proactive-muted", item.latestQualityReason));
    if (skippedTask?.lastTransition?.reason) {
      copy.append(element("small", "lp-proactive-muted", "上次跳过原因：" + skippedTask.lastTransition.reason));
    }
    card.append(copy);
    const reviewHref = task?.href || "./review/?competencyId=" + encodeURIComponent(item.competencyId) +
      (item.activeGapIds?.[0] ? "&gapId=" + encodeURIComponent(item.activeGapIds[0]) : "");
    const link = makeLink(task ? "继续复习任务" : "开始再次验证", reviewHref);
    if (link) card.append(link);
    queueHost.append(card);
  });

  const highRisks = (projection.risks || []).filter(item => ["high", "critical"].includes(item.level))
    .sort((a,b) => b.score-a.score);
  if (!highRisks.length) risksHost.append(element("div", "lp-empty", "没有检测到高风险知识节点。低风险并不代表永久掌握，系统仍会按计划安排再次验证。"));
  highRisks.slice(0, 8).forEach(item => {
    const schedule = schedules.find(row => row.competencyId === item.competencyId);
    const card = element("article", "lp-list-card");
    const copy = element("div");
    copy.append(element("span", "lp-tag", item.level === "critical" ? "紧急" : "高风险"),
      element("h3", "", schedule?.competencyTitle || item.competencyId),
      element("p", "", (item.reasons || []).join("；")));
    card.append(copy);
    const link = makeLink("查看节点", "./review/?competencyId=" + encodeURIComponent(item.competencyId));
    if (link) card.append(link);
    risksHost.append(card);
  });

  const trendRows = (projection.trends || []).filter(item =>
    item.direction !== "stable" || item.activeGapIds?.length).slice(0, 10);
  if (!trendRows.length) trendsHost.append(element("div", "lp-empty", "当前没有足够的时间序列证据判断薄弱点趋势。"));
  trendRows.forEach(item => {
    const direction = {
      improving: "正在改善", declining: "近期退化", emerging: "新出现",
      stable: "变化不明显", "insufficient-data": "证据不足",
    }[item.direction] || item.direction;
    const card = element("article", "lp-list-card");
    const copy = element("div");
    copy.append(element("h3", "", item.competencyTitle),
      element("p", "", direction + " · 最近均分 " + (item.recentAverage ?? "—") +
        " · 变化 " + (item.delta === null ? "—" : item.delta + " 分") +
        (item.activeGapIds?.length ? " · 未解决误区 " + item.activeGapIds.length : "")));
    card.append(copy);
    trendsHost.append(card);
  });

  const diagnostics = projection.diagnostics || [];
  if (!diagnostics.length) diagnosticsHost.append(element("div", "lp-empty", "当前没有达到诊断阈值的停滞、过载或目标偏差。"));
  diagnostics.forEach(item => {
    const card = element("article", "lp-proactive-diagnostic");
    card.append(element("span", "lp-tag " + (item.severity === "high" ? "" : "info"), item.severity === "high" ? "需要处理" : "关注"),
      element("h3", "", item.title),
      element("p", "", item.reason),
      element("small", "", "影响：" + item.impact),
      element("small", "", "建议：" + item.recommendation),
      element("small", "lp-proactive-muted", "证据：" + (item.evidenceRefs || []).slice(0, 4).join("、")));
    diagnosticsHost.append(card);
  });

  const forecasts = projection.goalForecasts || [];
  if (!forecasts.length) forecastsHost.append(element("div", "lp-empty", "还没有活动的长期学习目标。建立目标后会显示预计时间范围。"));
  forecasts.forEach(item => {
    const card = element("article", "lp-proactive-forecast");
    const head = element("div", "lp-inline-between");
    head.append(element("strong", "", item.title),
      element("span", "lp-tag info", confidenceText(item.confidence)));
    card.append(head,
      element("p", "", "稳定掌握 " + item.stableCount + " / " + item.targetCount + " 个能力节点 · 当前进度 " + item.progress + "%"),
      element("p", "", "预计完成区间：" + formatDate(item.earliestDate) + " – " + formatDate(item.latestDate)),
      element("p", "", "剩余工作量估算：" + item.remainingMinutesEstimate + " 分钟"));
    (item.blockers || []).slice(0, 4).forEach(blocker =>
      card.append(element("small", "lp-proactive-muted", "阻碍：" + blocker.title)));
    (item.milestones || []).forEach(milestone => {
      const stage = element("div", "lp-milestone");
      const stageHead = element("div", "lp-inline-between");
      stageHead.append(
        element("strong", "", "阶段 " + milestone.stage + " · " + milestone.title),
        element("span", "lp-tag info", milestone.status === "completed" ? "已完成" :
          milestone.status === "blocked" ? "存在阻碍" :
          milestone.status === "in-progress" ? "进行中" : "待开始")
      );
      stage.append(stageHead,
        element("small", "lp-proactive-muted", milestone.stableCount + " / " +
          milestone.competencyCount + " 个能力节点稳定掌握 · " + milestone.progress + "%"));
      const meter = element("div", "lp-milestone-meter");
      const fill = element("span");
      fill.style.width = milestone.progress + "%";
      meter.append(fill);
      stage.append(meter);
      (milestone.blockers || []).slice(0, 3).forEach(blocker =>
        stage.append(element("small", "lp-proactive-muted", "阻碍：" + blocker.title)));
      card.append(stage);
    });
    (item.variables || []).forEach(variable =>
      card.append(element("small", "lp-proactive-muted", variable)));
    forecastsHost.append(card);
  });

  const timeline = projection.timeline || [];
  if (!timeline.length) timelineHost.append(element("div", "lp-empty", "还没有学习轨迹事件。完成目标、挑战或复习后会在这里留下真实记录。"));
  timeline.forEach(item => {
    const row = element("article", "lp-timeline-row");
    const marker = element("span", "lp-timeline-marker" + (item.source === "derived" ? " derived" : ""));
    const copy = element("div", "lp-timeline-copy");
    const head = element("div", "lp-inline-between");
    head.append(element("strong", "", item.title),
      element("time", "", formatDate(item.at, true)));
    copy.append(head,
      element("p", "", item.detail || item.competencyTitle || item.type),
      element("small", "lp-proactive-muted",
        (item.source === "derived" ? "系统计算 · " : "原始事件 · ") +
        (item.competencyTitle || item.topicId || "学习过程") +
        (item.goalId ? " · 目标 " + item.goalId : "") +
        (item.taskId ? " · 任务 " + item.taskId : "")));
    row.append(marker, copy);
    timelineHost.append(row);
  });
}

function renderReviewPlan() {
  const host = $("review-list");
  host.replaceChildren();
  const rows = (proactiveProjection?.schedules || []).filter(item => item.dueAt)
    .sort((a,b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  if (!rows.length) {
    host.append(element("div", "lp-empty", "目前还没有有效验证证据，或尚未生成下一次复习安排。"));
    return;
  }
  const groups = [
    { title: "需要现在处理", description: "薄弱点重新学习、到期和逾期节点",
      items: rows.filter(item => ["due","overdue","relearning"].includes(item.status)) },
    { title: "未来 7 天", description: "即将进入复习窗口的知识点",
      items: rows.filter(item => !["due","overdue","relearning"].includes(item.status) &&
        Date.parse(item.dueAt) > Date.now() && Date.parse(item.dueAt) <= Date.now()+7*86_400_000) },
    { title: "后续复习", description: "更长期的再次验证安排",
      items: rows.filter(item => Date.parse(item.dueAt) > Date.now()+7*86_400_000) },
  ];
  groups.forEach(group => {
    if (!group.items.length) return;
    const section = element("section", "lp-queue-group");
    const heading = element("div", "lp-queue-group-heading");
    heading.append(element("h3", "", group.title), element("p", "", group.description));
    section.append(heading);
    group.items.slice(0,10).forEach(item => {
      const card = element("article", "lp-list-card");
      const copy = element("div");
      const dueNow = ["due","overdue","relearning"].includes(item.status);
      const tag = item.status === "overdue" ? "已逾期" : item.status === "relearning"
        ? "重新学习" : dueNow ? "现在应复习" : item.status === "stable" ? "稳定 · 定期复核" : "已安排";
      copy.append(element("span","lp-tag "+(dueNow?"":"good"),tag),
        element("h3","",item.competencyTitle),
        element("p","",item.topicTitle+" · 稳定间隔 "+(item.stabilityDays??"—")+
          " 天 · 下次复习 "+formatDate(item.dueAt,true)+
          " · 上次有效验证 "+formatDate(item.lastEvidenceAt)+
          " · 置信程度 "+(item.confidenceLabel||item.confidence)));
      if(item.latestQualityReason)copy.append(element("small","lp-proactive-muted",item.latestQualityReason));
      const skippedTask=proactiveTasks.find(row=>row.competencyId===item.competencyId&&row.status==="skipped");
      if(skippedTask?.lastTransition?.reason) {
        copy.append(element("small","lp-proactive-muted","上次跳过原因："+skippedTask.lastTransition.reason));
      }
      card.append(copy);
      const task=proactiveTasks.find(row=>row.competencyId===item.competencyId&&
        !["completed","skipped","cancelled"].includes(row.status));
      const href=task?.href||"./review/?competencyId="+encodeURIComponent(item.competencyId);
      const link=makeLink(task?"继续复习任务":"开始复习",href);
      if(link)card.append(link);
      section.append(card);
    });
    host.append(section);
  });
}

function renderEvents() {
  const host = $("event-list");
  host.replaceChildren();
  if (!insights.recentEvents.length) {
    host.append(element("div", "lp-empty", "还没有挑战记录。第一次完成或尝试一个挑战后，历史事件会出现在这里。"));
    return;
  }
  insights.recentEvents.forEach(event => {
    const row = element("div", "lp-event");
    const time = element("time", "", formatDate(event.at, true));
    const copy = element("div");
    const type = event.type === "completed" || event.type === "assessment_passed"
      ? (event.sessionType === "review" ? "独立复习通过" : "知识点验证通过")
      : event.type === "attempt" ? (event.correct ? "作答正确" : "错误概念记录")
      : event.type === "hint" || event.type === "hint_revealed" ? "使用渐进提示"
      : event.type === "review_started" ? "开始独立复习"
      : event.type === "checkpoint_started" ? "开始知识检查"
      : event.type === "plan_action_started" ? "开始计划行动"
      : event.type === "plan_action_completed" ? "标记计划步骤完成"
      : event.type === "activity" ? "产品线探索活动" : "学习事件";
    copy.append(element("strong", "", type + " · " + (event.stepTitle || event.challengeTitle || event.activity || "学习活动")));
    copy.append(element("small", "", (event.challengeTitle || event.pagePath || event.challengeId) + " · " + (event.topicId || event.sessionType || "未分类")));
    const value = element("span", "lp-event-score",
      event.scorePct !== undefined ? event.scorePct + "%" :
      event.type === "hint" || event.type === "hint_revealed" ? "提示 " + (event.hintNumber || 1) :
      event.correct === false ? "待纠正" : event.correct === true ? "正确" : "记录");
    row.append(time, copy, value);
    host.append(row);
  });
}

function renderAdaptivePlan(snapshot) {
  adaptivePlan = buildAdaptiveLearningPlan({
    learningMap, challengeRegistry, worksManifest, checkpointRegistry,
    snapshot, preferences: planPreferences,
    reviewSchedules: proactiveProjection?.schedules || [],
    existingTasks: proactiveTasks,
  });
  const summary = $("plan-summary");
  const host = $("plan-actions");
  const context = $("plan-context");
  if (!summary || !host || !context) return;
  summary.replaceChildren();
  summary.append(element("strong", "lp-plan-headline", adaptivePlan.headline));
  summary.append(element("span", "lp-plan-meta",
    adaptivePlan.actions.length
      ? "今日安排 " + adaptivePlan.plannedMinutes + " 分钟 · 已完成计划耗时 " + adaptivePlan.completedMinutesToday + " / " + adaptivePlan.dailyMinutes + " 分钟 · " +
        adaptivePlan.actions.length + " 个行动 · 已完成 " + adaptivePlan.completedTodayCount + " 步"
      : "今日预算 " + adaptivePlan.dailyMinutes + " 分钟 · 已完成计划耗时 " + adaptivePlan.completedMinutesToday + " 分钟 · 已完成 " + adaptivePlan.completedTodayCount + " 步"));
  $("plan-time-budget").value = String(planPreferences.dailyMinutes);
  $("plan-focus-topic").value = planPreferences.focusTopicId;
  host.replaceChildren();

  if (!adaptivePlan.actions.length) {
    const message = adaptivePlan.nextScheduledAt
      ? "目前没有需要立即处理的行动。下一次计划复习：" + formatDate(adaptivePlan.nextScheduledAt) + "。可以继续探索其他知识专题，不会因为浏览行为增加掌握度。"
      : adaptivePlan.completedTodayCount
        ? "今天安排的行动已经完成。完成真正的挑战或检查后，系统会根据新增证据重新计算下一步。"
        : "当前没有满足前置条件的行动。请先检查知识图谱中的前置节点，或选择一个专题开始基础学习。";
    host.append(element("div", "lp-empty", message));
  }

  adaptivePlan.actions.forEach(action => {
    const card = element("article", "lp-plan-card");
    const top = element("div", "lp-plan-card-top");
    top.append(element("span", "lp-plan-number", String(action.sequence).padStart(2, "0")));
    top.append(element("span", "lp-tag " + (action.type === "repair" ? "" : "good"), action.typeLabel));
    top.append(element("span", "lp-plan-time", action.estimatedMinutes + " 分钟"));
    const copy = element("div", "lp-plan-copy");
    copy.append(element("h3", "", action.competencyTitle));
    copy.append(element("p", "", action.topicTitle + " · " +
      (action.masteryScore === null ? "尚无掌握证据" : "掌握度 " + action.masteryScore + "%") +
      " · 置信度 " + action.confidenceScore + "%"));
    const reasons = element("ul", "lp-plan-reasons");
    action.priorityReasons.forEach(reason => reasons.append(element("li", "", reason)));
    copy.append(reasons);
    const footer = element("div", "lp-plan-card-actions");
    const link = makeLink(action.resourceLabel, action.href);
    if (link) {
      link.classList.add("lp-plan-link");
      if (action.startedToday) link.textContent = "继续打开学习资源 ↗";
      link.addEventListener("click", async () => {
        try { await recordLearningPlanAction(store, action, "started"); }
        catch (error) { setText("plan-status", "保存失败：" + error.message); }
      });
      footer.append(link);
    }
    const done = element("button", "lp-data-button", action.startedToday ? "标记已完成" : "完成此学习步骤");
    done.type = "button";
    done.addEventListener("click", async () => {
      done.disabled = true;
      try { await recordLearningPlanAction(store, action, "completed"); await refresh(); }
      catch (error) { done.disabled = false; window.alert(error.message || "无法保存学习计划进度。"); }
    });
    footer.append(done);
    if (action.startedToday) footer.append(element("span", "lp-plan-started", "进行中"));
    card.append(top, copy, footer);
    host.append(card);
  });

  context.replaceChildren();
  if (adaptivePlan.blockedCompetencies.length) {
    const blocked = element("div", "lp-plan-context-block");
    blocked.append(element("strong", "", "前置知识保护"));
    const unique = new Map();
    adaptivePlan.blockedCompetencies.forEach(item => unique.set(item.competencyId, item));
    [...unique.values()].slice(0, 3).forEach(item =>
      blocked.append(element("p", "", item.competencyTitle + " 暂缓推进：先补齐 " + item.blockedBy.join("、") + "。"))
    );
    context.append(blocked);
  }
  if (adaptivePlan.upcomingReviews.length) {
    const scheduled = element("div", "lp-plan-context-block");
    scheduled.append(element("strong", "", "接下来将到期的复习"));
    adaptivePlan.upcomingReviews.forEach(item =>
      scheduled.append(element("p", "", item.topicTitle + " · " + item.competencyTitle + " · " + formatDate(item.nextReviewAt)))
    );
    context.append(scheduled);
  }
}

let pageRefreshPromise = null;
let pageRefreshAgain = false;

async function refresh() {
  if (pageRefreshPromise) {
    pageRefreshAgain = true;
    return pageRefreshPromise;
  }
  pageRefreshPromise = (async () => {
    do {
      pageRefreshAgain = false;
      if (proactiveEngine) {
        proactiveProjection = await proactiveEngine.refresh();
        proactiveTasks = taskOrchestrator ? await taskOrchestrator.list() : [];
      }
      const snapshot = await store.load();
      insights = deriveLearningInsights(learningMap, challengeRegistry, snapshot);
      renderAdaptivePlan(snapshot);
      renderMetrics();
      renderTopicOverview();
      renderTopicChoices();
      renderGraph();
      renderGapList();
      renderWeakSkills();
      renderReviewPlan();
      renderProactiveDashboard();
      renderEvents();
      scheduleProactiveRefresh();
    } while (pageRefreshAgain);
  })();
  try {
    await pageRefreshPromise;
  } finally {
    pageRefreshPromise = null;
    pageRefreshAgain = false;
  }
}

function scheduleProactiveRefresh() {
  if (proactiveRefreshTimer) clearTimeout(proactiveRefreshTimer);
  const now = Date.now();
  const nextDue = (proactiveProjection?.schedules || [])
    .map(item => Date.parse(item.dueAt))
    .filter(value => Number.isFinite(value) && value > now)
    .sort((a,b) => a-b)[0];
  const delay = nextDue
    ? Math.min(24 * 60 * 60 * 1000, Math.max(1000, nextDue - now + 250))
    : 6 * 60 * 60 * 1000;
  proactiveRefreshTimer = setTimeout(() => {
    refresh().catch(error => console.warn("[KNOWVERSE] scheduled proactive refresh failed", error));
  }, delay);
}

let proactiveRefreshQueued = false;
const proactiveEventTypes = new Set([
  "attempt", "assessment_passed", "completed", "review_started", "hint", "hint_revealed",
  "learning_goal_created", "learning_goal_updated", "learning_goal_paused",
  "learning_goal_resumed", "learning_goal_completed", "learning_goal_cancelled",
  "learner_preferences_updated", "learning_task_in_progress", "learning_task_paused",
  "learning_task_completed", "learning_task_failed", "learning_task_skipped",
  "learning_task_cancelled",
]);
window.addEventListener("knowverse:learning-events-appended", event => {
  if (!proactiveEngine || proactiveRefreshQueued ||
      !(event.detail?.events || []).some(item => proactiveEventTypes.has(item.type))) return;
  proactiveRefreshQueued = true;
  queueMicrotask(() => {
    proactiveRefreshQueued = false;
    refresh().catch(error => {
      const status = $("proactive-actions");
      if (status) status.prepend(element("p", "lp-error", "学习状态刷新失败：" + error.message));
    });
  });
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && proactiveEngine) {
    refresh().catch(error => console.warn("[KNOWVERSE] proactive refresh failed", error));
  }
});

async function exportData() {
  const payload = await store.exportJSON();
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = element("a");
  anchor.href = url;
  anchor.download = "knowverse-learning-progress-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function wireDataActions() {
  $("export-progress").addEventListener("click", () => exportData().catch(error => window.alert("导出失败：" + error.message)));
  $("export-progress-bottom").addEventListener("click", () => exportData().catch(error => window.alert("导出失败：" + error.message)));
  $("import-progress").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await store.importJSON(await file.text(), { replace: false });
      window.alert("已合并 " + result.imported + " 条学习事件；当前共有 " + result.total + " 条记录。");
      await refresh();
    } catch (error) {
      window.alert("导入失败：" + error.message);
    } finally {
      event.target.value = "";
    }
  });
  $("plan-time-budget").addEventListener("change", async event => {
    planPreferences = { ...planPreferences, dailyMinutes: Number(event.target.value) };
    try { await planPreferencesStore.save(planPreferences); await refresh(); }
    catch (error) { window.alert("无法保存计划偏好：" + error.message); }
  });
  $("plan-focus-topic").addEventListener("change", async event => {
    planPreferences = { ...planPreferences, focusTopicId: event.target.value };
    try { await planPreferencesStore.save(planPreferences); await refresh(); }
    catch (error) { window.alert("无法保存计划偏好：" + error.message); }
  });
  $("plan-rebuild").addEventListener("click", () => refresh().catch(error => setText("plan-status", error.message)));
  document.querySelectorAll("[data-scroll]").forEach(button => {
    button.addEventListener("click", () => {
      const target = document.querySelector(button.dataset.scroll);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.querySelectorAll(".lp-tab").forEach(item => item.setAttribute("aria-current", String(item === button)));
    });
  });
}

async function boot() {
  const backendPanel = document.getElementById("backend-account-panel");
  if (backendPanel) {
    mountBackendAccountPanel(backendPanel, { store }).catch(error => {
      backendPanel.textContent = "云端账户面板初始化失败：" + error.message;
    });
  }
  if (!store.available) {
    setText("storage-status", "当前浏览器不支持 IndexedDB；学习事件无法持久保存。");
  }
  await store.load();
  planPreferences = await planPreferencesStore.load();
  const [knowledgeResponse, mapResponse, challengeResponse, worksResponse, checkpointResponse] = await Promise.all([
    fetch(new URL("content/knowledge.json", siteRoot), { headers: { Accept: "application/json" } }),
    fetch(new URL("content/learning-map.json", siteRoot), { headers: { Accept: "application/json" } }),
    fetch(new URL("content/challenges.json", siteRoot), { headers: { Accept: "application/json" } }),
    fetch(new URL("content/works.json", siteRoot), { headers: { Accept: "application/json" } }),
    fetch(new URL("content/learning-checkpoints.json", siteRoot), { headers: { Accept: "application/json" } }),
  ]);
  if ([knowledgeResponse, mapResponse, challengeResponse, worksResponse, checkpointResponse].some(response => !response.ok)) {
    throw new Error("学习系统注册表加载失败。");
  }
  [knowledge, learningMap, challengeRegistry, worksManifest, checkpointRegistry] = await Promise.all([
    knowledgeResponse.json(), mapResponse.json(), challengeResponse.json(), worksResponse.json(), checkpointResponse.json(),
  ]);
  if (!Array.isArray(knowledge.topics) || !Array.isArray(learningMap.topics) || !Array.isArray(challengeRegistry.challenges)) {
    throw new Error("学习系统注册表格式无效。");
  }
  selectedTopicId = learningMap.topics[0]?.id || null;
  selectedCompetencyId = learningMap.topics[0]?.competencies[0]?.id || null;
  const repository = await getLearningRepository();
  const profileStore = createLearnerProfileStore({ repository });
  const goalManager = createLearningGoalManager({ repository, learningMap });
  taskOrchestrator = createLearningTaskOrchestrator({ repository });
  proactiveEngine = createProactiveLearningEngine({
    repository, learningMap, challengeRegistry, goalManager, taskOrchestrator, profileStore,
  });
  wireDataActions();
  await refresh();
}

boot().catch(error => {
  console.error("[KNOWVERSE] learning progress unavailable:", error);
  ["plan-summary", "plan-actions", "plan-context", "topic-overview", "graph-canvas", "gap-list", "weak-skill-list", "review-list", "event-list"].forEach(id => {
    const host = $(id);
    if (host) host.replaceChildren(element("div", "lp-empty", "学习系统载入失败：" + error.message + "。请刷新页面或稍后重试。"));
  });
});
