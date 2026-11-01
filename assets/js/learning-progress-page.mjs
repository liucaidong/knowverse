import { createLearningProgressStore, deriveLearningInsights } from "./learning-progress.mjs";
import { buildAdaptiveLearningPlan, createLearningPlanPreferencesStore, recordLearningPlanAction } from "./learning-planner.mjs";

const siteRoot = new URL("../../", import.meta.url);
const $ = id => document.getElementById(id);
const store = createLearningProgressStore();
const planPreferencesStore = createLearningPlanPreferencesStore();
let worksManifest;
let checkpointRegistry;
let planPreferences = planPreferencesStore.load();
let adaptivePlan;
let knowledge;
let learningMap;
let challengeRegistry;
let insights;
let selectedTopicId = null;
let selectedCompetencyId = null;

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
    ? "学习数据保存在当前浏览器的 localStorage。Mac 与 iPhone 暂不自动同步，可通过 JSON 导出后在另一台设备导入合并。"
    : "当前浏览器未开放本地存储，学习事件无法持久保存。请使用支持 localStorage 的常规浏览器窗口。";
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

function renderReviewPlan() {
  const host = $("review-list");
  host.replaceChildren();
  if (!insights.reviewQueue.length) {
    host.append(element("div", "lp-empty", "完成第一次挑战后，系统会按你的表现生成下一次复习日期。"));
    return;
  }
  const now = Date.now();
  const groups = [
    {
      title: "今天必须完成",
      description: "优先处理未纠正误区和已经到期的复习",
      items: insights.reviewQueue.filter(item => item.isDue),
    },
    {
      title: "近期建议",
      description: "未来 7 天内值得主动巩固的知识点",
      items: insights.reviewQueue.filter(item => {
        if (item.isDue || !item.nextReviewAt) return false;
        const days = (Date.parse(item.nextReviewAt) - now) / 86_400_000;
        return days <= 7;
      }),
    },
    {
      title: "后续安排",
      description: "已进入复习节奏、暂时不必今天处理的知识点",
      items: insights.reviewQueue.filter(item => {
        if (item.isDue || !item.nextReviewAt) return false;
        return (Date.parse(item.nextReviewAt) - now) / 86_400_000 > 7;
      }),
    },
  ];
  groups.forEach(group => {
    if (!group.items.length) return;
    const section = element("section", "lp-queue-group");
    const heading = element("div", "lp-queue-group-heading");
    heading.append(element("h3", "", group.title), element("p", "", group.description));
    section.append(heading);
    group.items.slice(0, 5).forEach(item => {
      const card = element("article", "lp-list-card");
      const copy = element("div");
      const tag = element("span", "lp-tag " + (item.isDue ? "" : "good"), item.isDue ? "现在应复习" : item.kind === "gap" ? "待独立确认" : "计划复习");
      const scoreText = item.masteryScore === null || item.masteryScore === undefined ? "尚无成功证据" : "掌握度 " + item.masteryScore + "%";
      const confidenceText = item.confidenceScore === undefined ? "" : " · 置信度 " + item.confidenceScore + "%";
      const reasons = Array.isArray(item.priorityReasons) && item.priorityReasons.length ? " · 优先原因：" + item.priorityReasons.join("、") : "";
      copy.append(tag, element("h3", "", item.title), element("p", "", item.topicTitle + " · " + scoreText + confidenceText + " · " + (item.kind === "gap" ? "针对性纠错" : item.intervalDays + " 天间隔") + " · " + formatDate(item.nextReviewAt) + reasons));
      const link = makeLink("开始再次验证", item.reviewHref || item.challengeHref || item.topicHref);
      card.append(copy);
      if (link) card.append(link);
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

function renderAdaptivePlan() {
  adaptivePlan = buildAdaptiveLearningPlan({
    learningMap, challengeRegistry, worksManifest, checkpointRegistry,
    snapshot: store.load(), preferences: planPreferences,
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
      link.addEventListener("click", () => {
        try { recordLearningPlanAction(store, action, "started"); }
        catch (error) { setText("plan-status", error.message); }
      });
      footer.append(link);
    }
    const done = element("button", "lp-data-button", action.startedToday ? "标记已完成" : "完成此学习步骤");
    done.type = "button";
    done.addEventListener("click", () => {
      try { recordLearningPlanAction(store, action, "completed"); refresh(); }
      catch (error) { window.alert(error.message || "无法保存学习计划进度。"); }
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

function refresh() {
  insights = deriveLearningInsights(learningMap, challengeRegistry, store.load());
  renderAdaptivePlan();
  renderMetrics();
  renderTopicOverview();
  renderTopicChoices();
  renderGraph();
  renderGapList();
  renderWeakSkills();
  renderReviewPlan();
  renderEvents();
}

function exportData() {
  const payload = store.exportJSON();
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
  $("export-progress").addEventListener("click", exportData);
  $("export-progress-bottom").addEventListener("click", exportData);
  $("import-progress").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = store.importJSON(await file.text(), { replace: false });
      window.alert("已合并 " + result.imported + " 条学习事件；当前共有 " + result.total + " 条记录。");
      refresh();
    } catch (error) {
      window.alert("导入失败：" + error.message);
    } finally {
      event.target.value = "";
    }
  });
  $("plan-time-budget").addEventListener("change", event => {
    planPreferences = { ...planPreferences, dailyMinutes: Number(event.target.value) };
    if (!planPreferencesStore.save(planPreferences)) window.alert("无法保存计划偏好；本次页面仍会使用当前选择。");
    refresh();
  });
  $("plan-focus-topic").addEventListener("change", event => {
    planPreferences = { ...planPreferences, focusTopicId: event.target.value };
    if (!planPreferencesStore.save(planPreferences)) window.alert("无法保存计划偏好；本次页面仍会使用当前选择。");
    refresh();
  });
  $("plan-rebuild").addEventListener("click", refresh);
  document.querySelectorAll("[data-scroll]").forEach(button => {
    button.addEventListener("click", () => {
      const target = document.querySelector(button.dataset.scroll);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.querySelectorAll(".lp-tab").forEach(item => item.setAttribute("aria-current", String(item === button)));
    });
  });
}

async function boot() {
  if (!store.available) {
    setText("storage-status", "当前浏览器未开放本地存储；学习事件无法持久保存。");
  }
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
  wireDataActions();
  refresh();
}

boot().catch(error => {
  console.error("[KNOWVERSE] learning progress unavailable:", error);
  ["plan-summary", "plan-actions", "plan-context", "topic-overview", "graph-canvas", "gap-list", "weak-skill-list", "review-list", "event-list"].forEach(id => {
    const host = $(id);
    if (host) host.replaceChildren(element("div", "lp-empty", "学习系统载入失败：" + error.message + "。请刷新页面或稍后重试。"));
  });
});
