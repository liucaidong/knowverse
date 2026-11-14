import { createLearningProgressStore, deriveLearningInsights } from "./learning-progress.mjs";
import { createReviewSessionEngine } from "./review-engine.mjs";

const root = new URL("../../", import.meta.url);
const $ = id => document.getElementById(id);
const progressStore = createLearningProgressStore();
let map;
let registry;
let assessments;
let engine;
let session = null;
let targetCompetencyId = null;
let targetGapId = null;
let activeTaskId = null;
let taskOrchestrator = null;
let taskOrchestratorPromise = null;
let practiceRuntimePromise = null;
let practiceProvider = null;
let practiceCandidateStore = null;
let parseLearningPracticeCandidateReply = null;
let activePracticeCandidate = null;
let practiceQualityClient = null;
let activePracticeQualityHistory = null;
let practiceHintCount = 0;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const params = new URLSearchParams(location.search);
const statusName = { unverified:"待验证", weak:"需要补强", building:"正在建立", initial:"初步掌握", stable:"稳定掌握" };
const fmt = value => value ? new Intl.DateTimeFormat("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(value)) : "—";

function competencyFor(id) {
  for (const topic of map.topics) {
    const item = topic.competencies.find(row => row.id === id);
    if (item) return { ...item, topicTitle: topic.title, topicId: topic.id };
  }
  return null;
}
async function insightsNow() {
  return deriveLearningInsights(map, registry, await progressStore.load());
}
function updateWorkspaceNav() {
  document.querySelectorAll(".rw-workspace-nav a[data-target]").forEach(link => {
    const target = $(link.dataset.target);
    link.hidden = !target || target.hidden;
  });
}
async function ensureTaskOrchestrator() {
  if (taskOrchestrator) return taskOrchestrator;
  if (!taskOrchestratorPromise) {
    taskOrchestratorPromise = import("./learning-agent/task-orchestrator.mjs")
      .then(module => {
        taskOrchestrator = module.createLearningTaskOrchestrator();
        return taskOrchestrator;
      })
      .catch(error => {
        taskOrchestratorPromise = null;
        throw error;
      });
  }
  return taskOrchestratorPromise;
}

async function ensurePracticeRuntime() {
  if (practiceCandidateStore && practiceProvider && practiceQualityClient) return;
  if (!practiceRuntimePromise) {
    practiceRuntimePromise = Promise.all([
      import("./learning-agent/agent-provider.mjs"),
      import("./learning-practice-candidates.mjs"),
      import("./learning-practice-quality-review.mjs"),
    ]).then(([providerModule, candidateModule, qualityModule]) => {
      practiceProvider = providerModule.createLearningAgentProvider();
      practiceCandidateStore = candidateModule.createLearningPracticeCandidateStore({ registry: assessments });
      parseLearningPracticeCandidateReply = candidateModule.parseLearningPracticeCandidateReply;
      practiceQualityClient = qualityModule.createLearningPracticeQualityReviewClient();
    }).catch(error => {
      practiceRuntimePromise = null;
      throw error;
    });
  }
  await practiceRuntimePromise;
}
async function renderHistory() {
  const host = $("history-list");
  host.replaceChildren();
  const rows = (await engine.getHistory()).slice().sort((a,b) => Date.parse(b.startedAt)-Date.parse(a.startedAt)).slice(0,6);
  if (!rows.length) {
    host.append(el("div","rw-empty","当前设备还没有复习会话。"));
    return;
  }
  rows.forEach(item => {
    const row = el("div","rw-history-row");
    row.append(el("time","",fmt(item.startedAt)));
    const copy = el("div");
    const competency = competencyFor(item.competencyId);
    copy.append(el("strong","",competency?.title || item.competencyId));
    copy.append(el("small","",(item.targetGapId ? "薄弱点 · "+item.targetGapId : "知识点巩固")+" · "+item.variantId));
    row.append(copy);
    if (item.status === "active") {
      const resume = el("button", "rw-history-resume", "继续复习 →");
      resume.type = "button";
      resume.addEventListener("click", async () => {
        try {
          session = await engine.get(item.sessionId);
          if (!session) throw new Error("这条复习现场已结束或不存在。");
          targetCompetencyId = session.competencyId;
          targetGapId = session.targetGapId || null;
          renderSession();
          setFeedback("已恢复上次复习现场。你的选项、提示进度和作答状态均已从学习数据库读取。");
        } catch (error) { setFeedback(error.message, "bad"); }
      });
      row.append(resume);
    } else {
      row.append(el("em","",item.status==="passed"?"通过":"未通过"));
    }
    host.append(row);
  });
}
async function renderPicker() {
  const host = $("target-list");
  host.replaceChildren();
  const insight = await insightsNow();
  map.topics.forEach(topic => {
    const group = el("section", "rw-topic-group");
    group.setAttribute("aria-label", topic.title + "复习目标");
    const heading = el("div", "rw-topic-heading");
    const activeGapCount = topic.competencies.reduce((count, competency) => {
      const state = insight.competencyInsights.find(row => row.id === competency.id);
      return count + (state?.activeGaps?.length || 0);
    }, 0);
    heading.append(
      el("h3", "", topic.title),
      el("span", "", topic.competencies.length + " 个知识能力点 · " + activeGapCount + " 个待纠正薄弱点"),
    );
    const grid = el("div", "rw-topic-targets");
    topic.competencies.forEach(competency => {
      const state = insight.competencyInsights.find(row=>row.id===competency.id);
      const button = el("button","rw-target");
      button.type = "button";
      const copy = el("span");
      copy.append(el("strong","",competency.title));
      const gapCount = state?.activeGaps?.length || 0;
      copy.append(el("small","",(statusName[state?.status]||"待验证")+" · "+(gapCount?gapCount+" 个待纠正薄弱点":"无未解决薄弱点")));
      button.append(copy,el("em","",state?.masteryScore===null||state?.masteryScore===undefined?"开始验证":state.masteryScore+"% →"));
      button.addEventListener("click",()=>startSession({competencyId:competency.id}).catch(error=>setFeedback(error.message,"bad")));
      grid.append(button);
    });
    group.append(heading, grid);
    host.append(group);
  });
}
function updateSideState() {
  $("hint-state").textContent = session.hintsUsed ? "已使用 "+session.hintsUsed+" 条提示" : "未使用提示";
  $("hint-explain").textContent = session.hintsUsed
    ? "本次通过属于提示辅助证据，需要换一个题型并在无提示状态下独立通过。"
    : "无提示独立通过会形成更强的掌握证据；如果是不同变体，还可精确纠正薄弱点。";
}
function renderSession() {
  const competency = competencyFor(session.competencyId);
  $("review-picker").hidden = true;
  $("review-session").hidden = false;
  updateWorkspaceNav();
  $("session-title").textContent = competency?.title || session.title;
  $("session-context").textContent = session.targetGapId
    ? "目标薄弱点："+(map.gaps.find(item=>item.id===session.targetGapId)?.label || session.targetGapId)+" · 本次复习与原挑战完全隔离"
    : (competency?.topicTitle || session.topicId)+" · 独立知识点验证";
  $("session-status-label").textContent = session.status==="active"?"进行中":session.status==="passed"?"已通过":"未通过";
  $("session-variant").textContent = session.variantId.toUpperCase();
  $("question-topic").textContent = (session.topicId || "KNOWLEDGE").toUpperCase();
  $("question-progress").textContent = session.targetGapId ? "TARGETED GAP REVIEW" : "INDEPENDENT CHECK";
  const difficultyLabels = { foundation: "基础", intermediate: "进阶", stretch: "挑战" };
  const difficulty = $("question-difficulty");
  difficulty.hidden = !session.difficulty;
  difficulty.textContent = session.difficulty ? "难度 · " + (difficultyLabels[session.difficulty] || session.difficulty) : "";
  const source = $("question-source");
  source.replaceChildren();
  source.hidden = !session.sourceHref;
  if (!source.hidden) {
    const link = el("a", "", (session.sourceLabel || "课程来源") + " ↗");
    link.href = new URL(session.sourceHref, root).href;
    source.append(link);
  }
  $("question-title").textContent = session.title;
  $("question-prompt").textContent = session.prompt;
  const code = $("question-code");
  code.textContent = session.code || "";
  code.hidden = !session.code;
  const host = $("answer-options");
  host.replaceChildren();
  session.options.forEach((option,index) => {
    const button = el("button","rw-option");
    button.type="button";
    button.disabled = session.status!=="active";
    button.dataset.optionId=option.id;
    button.append(el("span","rw-option-mark",String.fromCharCode(65+index)),el("span","",option.label));
    if (session.status!=="active" && option.id===session.answer) button.classList.add("correct");
    else if (option.id===session.selectedOptionId && session.status==="failed") button.classList.add("wrong");
    button.addEventListener("click",()=>submitAnswer(option.id).catch(error=>console.error("[KNOWVERSE] Review submission failed:",error)));
    host.append(button);
  });
  $("reveal-hint").disabled = session.status!=="active" || session.hintsUsed >= session.hints.length;
  $("reveal-hint").textContent = session.hintsUsed >= session.hints.length ? "提示已全部展开" : "展开下一条提示 ("+session.hintsUsed+"/"+session.hints.length+")";
  $("hint-list").replaceChildren();
  session.hints.slice(0,session.hintsUsed).forEach(hint=>$("hint-list").append(el("li","",hint)));
  $("next-variant").hidden = session.status==="active";
  updateSideState();
}
function setFeedback(message,kind) {
  const node=$("answer-feedback");
  node.textContent=message;
  node.className="rw-feedback"+(kind?" "+kind:"");
}
async function startSession(input) {
  try {
    targetCompetencyId=input.competencyId;
    targetGapId=input.gapId || null;
    if (activeTaskId && taskOrchestrator) {
      let task = await taskOrchestrator.get(activeTaskId);
      if (!task) throw new Error("关联的学习任务不存在，未开始复习。");
      if (task.status === "failed") task = await taskOrchestrator.retry(activeTaskId);
      if (task.status === "paused") task = await taskOrchestrator.transition(activeTaskId, "in_progress");
      else if (task.status === "ready") task = await taskOrchestrator.start(activeTaskId);
      if (task.status !== "in_progress") throw new Error("该复习任务当前状态为 " + task.status + "，不能启动新的复习会话。");
      targetGapId = task.gapId || targetGapId;
      input = {
        ...input,
        taskId: task.taskId,
        planId: task.planId,
        strategyDecisionId: task.strategyDecisionId || null,
        strategyProfileRevision: task.strategyProfileRevision || null,
        learningIntervention: task.learningIntervention || null,
        strategyInstruction: task.strategyInstruction || null,
        difficultyLevel: task.difficultyLevel || "maintain",
      };
    }
    session=await engine.start({ ...input, gapId: targetGapId });
    renderSession();
    setFeedback("先独立推演，不要急着展开提示。选项提交后，本次会话会单独结束并记录验证结果。");
    $("hint-list").replaceChildren();
    $("answer-explanation").hidden=true;
    $("next-variant").hidden=true;
    await renderHistory();
    await renderPracticeWorkbench();
    $("review-session").scrollIntoView({behavior:"smooth",block:"start"});
  } catch(error) {
    window.alert(error.message);
    throw error;
  }
}
async function revealHint() {
  try {
    const result=await engine.revealHint(session.sessionId);
    session=result.session;
    if(result.hint) $("hint-list").append(el("li","",result.hint));
    renderSession();
    setFeedback("已展开提示。提示不会阻止完成本题，但本次通过会被标记为辅助验证。");
  } catch(error) { setFeedback(error.message,"bad"); throw error; }
}
async function submitAnswer(optionId) {
  try {
    const result=await engine.submit(session.sessionId,optionId);
    session=result.session;
    if (activeTaskId && taskOrchestrator) {
      const task = await taskOrchestrator.get(activeTaskId);
      if (task?.status === "in_progress") {
        if (!result.correct) {
          await taskOrchestrator.fail(activeTaskId, { reason: "本轮复习验证未通过" });
        } else if (task.taskType === "review" && Number(session.hintsUsed) > 0) {
          await taskOrchestrator.fail(activeTaskId, { reason: "提示辅助通过，尚未满足无提示独立验证条件" });
        } else {
          await taskOrchestrator.complete(activeTaskId);
          activeTaskId = null;
          const clean = new URL(location.href);
          clean.searchParams.delete("taskId");
          clean.searchParams.delete("competencyId");
          clean.searchParams.delete("gapId");
          history.replaceState(null, "", clean.pathname);
        }
      }
    }
    renderSession();
    const explanation=$("answer-explanation");
    explanation.textContent=result.explanation;
    explanation.hidden=false;
    if (!result.correct) {
      setFeedback("这次判断还不正确。错误概念已经写入薄弱点记录；本次会话结束，请换一个变体重新推演。","bad");
    } else if (session.hintsUsed) {
      setFeedback("本题通过，得分 "+result.scorePct+"%。这是提示辅助证据；薄弱点会保持“待独立确认”，请使用另一个变体且不展开提示。","good");
    } else {
      const latest=await insightsNow();
      const resolved=targetGapId && !latest.gaps.some(gap=>gap.id===targetGapId && gap.competencyId===targetCompetencyId);
      setFeedback(resolved
        ? "独立验证通过，薄弱点「"+targetGapId+"」已由不同题型的无提示证据精确纠正。"
        : "独立验证通过，已记录新的知识掌握证据。再使用不同变体复核，可提高掌握置信度。","good");
    }
    await renderPicker();
    await renderHistory();
    await renderPracticeWorkbench();
    $("next-variant").textContent="用另一个题型再次验证 →";
    $("next-variant").hidden=false;
  } catch(error) { setFeedback(error.message,"bad"); throw error; }
}
function setPracticeStatus(message, error = false) {
  const node = $("practice-candidate-status");
  node.textContent = message;
  node.classList.toggle("bad", error);
}

async function currentPracticeTarget() {
  if (!targetCompetencyId || !targetGapId) return null;
  const insight = await insightsNow();
  const gap = insight.gaps.find(item =>
    item.competencyId === targetCompetencyId && item.id === targetGapId
  );
  const competency = competencyFor(targetCompetencyId);
  const sources = assessments.assessments.filter(item =>
    item.competencyId === targetCompetencyId && (item.gapIds || []).includes(targetGapId)
  );
  if (!competency || sources.length < 2) return { gap, competency, sources, snapshot: null, recentlyUsedVariantIds: [] };
  const snapshot = await progressStore.load();
  const cutoff = Date.now() - 30 * 86_400_000;
  const recentlyUsedVariantIds = [...new Set(snapshot.events.filter(event =>
    event.competencyIds?.includes(targetCompetencyId) &&
    event.gapId === targetGapId &&
    event.variantId &&
    Date.parse(event.at) >= cutoff
  ).map(event => event.variantId))];
  return { gap, competency, sources, snapshot, recentlyUsedVariantIds };
}


const qualityStatusName = {
  draft: "未校验草案",
  validation: "确定性校验已通过",
  machine_review: "AI 正在审查",
  machine_reviewed: "机器审查通过 · 等待人工批准",
  needs_revision: "需要修改",
  approved: "人工已批准 · 待发布",
  registration_pending: "发布请求已生成 · 待合并",
  registered: "已进入正式题库",
  rejected: "已拒绝",
  deleted: "已删除",
};
const qualityRecordName = {
  validation: "确定性校验",
  review: "独立 AI 审查",
  review_error: "AI 审查异常",
  approval: "人工批准",
  rejection: "人工拒绝",
  registration_pending: "正式题库待发布",
  publication_pr: "发布 PR",
  registered: "正式题库注册",
  state: "生命周期变更",
};

function setPracticeQualityStatus(message, error = false) {
  const node = $("practice-quality-status");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("bad", error);
}

function appendQualityText(host, label, value, className = "") {
  const row = el("div", className || "rw-quality-row");
  if (label) row.append(el("strong", "", label));
  row.append(el("p", "", typeof value === "string" ? value : JSON.stringify(value, null, 2)));
  host.append(row);
}

function renderQualityValidation(report) {
  const host = $("practice-quality-validation");
  host.replaceChildren();
  host.hidden = !report;
  if (!report) return;
  host.append(el("h5", "", "确定性校验报告 · " + (report.validationStatus === "passed" ? "通过" : "未通过")));
  host.append(el("p", "rw-quality-meta", "版本 " + report.validatorVersion + " · " + fmt(report.evaluatedAt)));
  const checks = el("ul", "rw-quality-checks");
  (report.checks || []).forEach(item => {
    const row = el("li", item.status === "failed" ? "bad" : item.status === "warning" ? "warning" : "");
    row.append(el("strong", "", (item.status === "passed" ? "通过" : item.status === "warning" ? "警告" : item.status === "not_applicable" ? "不适用" : "失败") + " · " + item.label));
    row.append(el("p", "", item.detail));
    checks.append(row);
  });
  host.append(checks);
  if (report.errors?.length) {
    const errors = el("div", "rw-quality-findings");
    errors.append(el("strong", "", "阻断问题"));
    report.errors.forEach(item => errors.append(el("p", "", item.message)));
    host.append(errors);
  }
  if (report.warnings?.length) {
    const warnings = el("div", "rw-quality-findings warning");
    warnings.append(el("strong", "", "未阻断警告"));
    report.warnings.forEach(item => warnings.append(el("p", "", item.message)));
    host.append(warnings);
  }
  if (report.duplicateMatches?.length) {
    appendQualityText(host, "相似题目匹配", report.duplicateMatches
      .map(item => item.title + " · " + item.source + " · 相似度 " + item.similarity).join("\n"));
  }
}

function renderQualityReview(review) {
  const host = $("practice-quality-review-report");
  host.replaceChildren();
  host.hidden = !review;
  if (!review) return;
  host.append(el("h5", "", "独立 AI Reviewer 报告 · " +
    (review.verdict === "pass" ? "未发现阻断问题" : review.verdict === "needs_revision" ? "需要修改" : "拒绝") +
    " · 风险 " + review.riskLevel));
  host.append(el("p", "rw-quality-meta", "Reviewer " + review.reviewerVersion +
    " / " + review.reviewerModel + " · " + fmt(review.reviewedAt) + " · " + review.reviewId));
  appendQualityText(host, "总体评估", review.overallAssessment);
  const dimensions = [
    ["教学目标与来源一致性", review.sourceAlignment],
    ["题目可解性", review.solvability],
    ["答案一致性", review.answerConsistency],
    ["教学质量", review.pedagogicalQuality],
  ];
  const dimensionHost = el("div", "rw-quality-dimensions");
  dimensions.forEach(([label, dimension]) => {
    const node = el("article", "rw-quality-dimension");
    node.append(el("strong", "", label + " · " + (dimension?.status || "unverified")));
    node.append(el("p", "", dimension?.assessment || "未提供审查结论"));
    (dimension?.evidence || []).forEach(item => node.append(el("small", "", "证据 / 依据：" + item)));
    dimensionHost.append(node);
  });
  host.append(dimensionHost);
  const findings = el("div", "rw-quality-findings");
  findings.append(el("strong", "", "发现的问题 · " + (review.findings?.length || 0)));
  if (!review.findings?.length) findings.append(el("p", "", "Reviewer 未报告具体阻断问题；这不等于题目已被证明正确。"));
  (review.findings || []).forEach(item => {
    const node = el("article", "rw-quality-finding " + (["high", "critical"].includes(item.severity) ? "bad" : ""));
    node.append(el("strong", "", item.severity + " · " + item.category));
    node.append(el("p", "", item.description));
    node.append(el("small", "", "依据：" + item.evidence));
    if (item.suggestedFix) node.append(el("small", "", "建议：" + item.suggestedFix));
    findings.append(node);
  });
  host.append(findings);
  if (review.suggestedRevisions?.length) {
    const revisions = el("div", "rw-quality-findings");
    revisions.append(el("strong", "", "建议修改"));
    review.suggestedRevisions.forEach(item => {
      const node = el("p", "");
      node.textContent = item.field + "： " + item.reason + " 建议：" + item.proposal;
      revisions.append(node);
    });
    host.append(revisions);
  }
  appendQualityText(host, "Reviewer 局限性", (review.reviewerLimitations || []).join("\n"));
  if (review.registrationAssessment) {
    const proposal = el("details", "rw-quality-companion");
    proposal.append(el("summary", "", "与现有正式测评引擎兼容的选择题版本（仍需人工审核）"));
    appendQualityText(proposal, "题目", review.registrationAssessment.title + "\n" + review.registrationAssessment.prompt);
    if (review.registrationAssessment.code) appendQualityText(proposal, "代码 / 材料", review.registrationAssessment.code);
    (review.registrationAssessment.options || []).forEach(option =>
      appendQualityText(proposal, "选项 " + option.id, option.label));
    appendQualityText(proposal, "机器建议答案", review.registrationAssessment.answer);
    appendQualityText(proposal, "解释", review.registrationAssessment.explanation);
    host.append(proposal);
  }
}

function renderPracticeQualityHistory(records = []) {
  const host = $("practice-quality-history-list");
  host.replaceChildren();
  if (!records.length) {
    host.append(el("li", "rw-empty", "尚无服务器端质量审查记录。"));
    return;
  }
  records.forEach(record => {
    const row = el("li", "rw-quality-history-row");
    const type = qualityRecordName[record.recordType] || record.recordType;
    const result = record.payload?.verdict || record.payload?.validationStatus || record.payload?.to || record.payload?.publicationStatus || "";
    row.append(el("strong", "", type + (result ? " · " + result : "")));
    row.append(el("small", "", fmt(record.createdAt) + " · " + record.recordId));
    if (record.payload?.message) row.append(el("p", "", record.payload.message));
    if (record.payload?.reason) row.append(el("p", "", record.payload.reason));
    host.append(row);
  });
}

async function renderPracticeQualityPanel(item) {
  const panel = $("practice-quality-panel");
  if (!panel || !item) return;
  panel.hidden = false;
  const sourceHost = $("practice-quality-source-list");
  sourceHost.replaceChildren();
  (item.exercise.sourceVariantIds || []).forEach(id => {
    const source = assessments.assessments.find(row => row.id === id);
    const article = el("article", "rw-quality-source");
    article.append(el("strong", "", (source?.title || "未知官方来源") + " · " + id));
    if (source) {
      article.append(el("p", "", source.prompt || ""));
      if (source.code) article.append(el("pre", "", source.code));
      appendQualityText(article, "官方答案 ID", source.answer || "—");
      appendQualityText(article, "官方解释", source.explanation || "—");
      (source.options || []).forEach(option => appendQualityText(article, "选项 " + option.id, option.label));
    } else {
      article.append(el("p", "bad", "此来源 ID 当前不在已加载的正式题库中。"));
    }
    sourceHost.append(article);
  });

  const validationButton = $("practice-quality-validate");
  const reviewButton = $("practice-quality-review");
  const approvalPanel = $("practice-quality-approval");
  const registrationPanel = $("practice-quality-registration");
  const editor = $("practice-quality-editor");
  validationButton.disabled = true;
  reviewButton.disabled = true;
  approvalPanel.hidden = true;
  registrationPanel.hidden = true;
  editor.hidden = true;
  $("practice-quality-validation").hidden = true;
  $("practice-quality-review-report").hidden = true;
  $("practice-quality-state").textContent = "读取服务器端审查记录…";
  $("practice-quality-history-list").replaceChildren(el("li", "rw-empty", "正在读取…"));
  try {
    const history = await practiceQualityClient.history(item.candidateId);
    activePracticeQualityHistory = history;
    const records = history.records || [];
    const status = history.status || "draft";
    const canApprove = history.canApprove === true;
    const latestValidation = records.filter(record => record.recordType === "validation").at(-1);
    const latestReview = records.filter(record => record.recordType === "review").at(-1);
    const validation = latestValidation?.payload;
    const review = latestReview?.payload;
    $("practice-quality-state").textContent = qualityStatusName[status] || status;
    $("practice-candidate-state").textContent =
      (item.status === "attempted" ? "已作答 · 不计分 · " : "未评分草案 · ") +
      (qualityStatusName[status] || status);

    renderQualityValidation(validation);
    renderQualityReview(review);
    renderPracticeQualityHistory(records);

    validationButton.disabled = !["draft", "validation", "needs_revision"].includes(status);
    reviewButton.disabled = !(status === "validation" && validation?.validationStatus === "passed");
    // No approval is possible unless the server confirms an out-of-band role.
    approvalPanel.hidden = !(canApprove || ["machine_reviewed", "approved", "registration_pending", "registered"].includes(status));
    $("practice-quality-approval-gate").textContent = canApprove
      ? "已验证 content_admin 权限。审批仍要求明确勾选风险告知并由后端再次核验。"
      : "当前账户没有 content_admin 权限。人工批准与拒绝操作已锁定，不能通过前端身份字段绕过。";
    $("practice-quality-approval-confirm").checked = false;
    $("practice-quality-approval-confirm").disabled = !canApprove || status !== "machine_reviewed";
    $("practice-quality-approve").disabled = true;
    $("practice-quality-approve").hidden = !canApprove || status !== "machine_reviewed";
    $("practice-quality-reject").disabled = !canApprove || ["approved", "registration_pending", "registered", "rejected", "deleted"].includes(status);
    $("practice-quality-reject").hidden = !canApprove || ["approved", "registration_pending", "registered", "rejected", "deleted"].includes(status);
    registrationPanel.hidden = !canApprove || !["approved", "registration_pending", "registered"].includes(status);
    $("practice-quality-prepare-registration").disabled = status !== "approved";
    $("practice-quality-prepare-registration").hidden = status !== "approved";
    $("practice-quality-registration-status").textContent =
      status === "registered" ? "已确认 GitHub Pages 正式部署，注册记录已完成。" :
      status === "registration_pending" ? "发布请求已生成，等待 GitHub PR 审查、合并和 Pages 部署验证。" :
      "已人工批准，但尚未进入正式测评题库。";
    $("practice-quality-workflow-link").hidden = status !== "registration_pending";
    editor.hidden = !["draft", "validation", "needs_revision"].includes(status);
    $("practice-quality-edit-json").value = JSON.stringify(item.exercise, null, 2);
    setPracticeQualityStatus(
      canApprove ? "该账户拥有独立内容审核权限；批准前仍需人工确认。" :
        status === "machine_reviewed" ? "机器审查已通过，但当前账户没有 content_admin 权限，批准入口保持禁用。" :
        status === "approved" ? "题目已批准；等待授权的发布流程，尚未进入正式题库。" :
        "审查历史由服务端保存。AI 生成、AI 审查和候选练习均不会产生 Learning Events V3。",
    );
  } catch (error) {
    activePracticeQualityHistory = null;
    $("practice-quality-state").textContent = "尚未连接质量审查服务";
    renderPracticeQualityHistory([]);
    setPracticeQualityStatus(error.message || "需要登录并获得 KNOWVERSE 云端学习档案授权后才能查看质量审查记录。", true);
  }
}

async function validateActivePracticeCandidate() {
  if (!activePracticeCandidate) return;
  const button = $("practice-quality-validate");
  button.disabled = true;
  setPracticeQualityStatus("服务器正在校验官方 competency、Gap、来源题、重复度、内容结构和安全风险…");
  try {
    const result = await practiceQualityClient.validate(activePracticeCandidate);
    setPracticeQualityStatus(result.report?.validationStatus === "passed"
      ? "确定性校验通过。只有现在才能运行独立 AI 审查；通过结果仍不代表题目已被证明正确。"
      : "确定性校验未通过，已阻断 AI 审查。请先查看错误并修改候选内容。", result.report?.validationStatus !== "passed");
    await renderPracticeQualityPanel(activePracticeCandidate);
  } catch (error) {
    setPracticeQualityStatus(error.message || "确定性校验失败。", true);
  } finally {
    button.disabled = false;
  }
}

async function reviewActivePracticeCandidate() {
  if (!activePracticeCandidate) return;
  const button = $("practice-quality-review");
  button.disabled = true;
  setPracticeQualityStatus("正在调用与生成模型隔离的 Reviewer。没有执行候选代码，审查结论不构成事实证明。");
  try {
    const result = await practiceQualityClient.review(activePracticeCandidate);
    setPracticeQualityStatus(
      result.status === "machine_reviewed"
        ? "机器审查未发现阻断问题，已进入 machine_reviewed。仍需真实授权的人工审批。"
        : result.status === "rejected" ? "Reviewer 判定该候选不应继续使用。"
        : "Reviewer 发现需要处理的问题；请查看 findings、修改后重新校验和审查。",
      result.status !== "machine_reviewed",
    );
    await renderPracticeQualityPanel(activePracticeCandidate);
  } catch (error) {
    setPracticeQualityStatus(error.message || "独立 AI 审查失败；历史记录不会被覆盖。", true);
  } finally {
    button.disabled = false;
  }
}

async function savePracticeQualityEdit() {
  if (!activePracticeCandidate) return;
  const button = $("practice-quality-save-edit");
  button.disabled = true;
  try {
    const exercise = JSON.parse($("practice-quality-edit-json").value);
    activePracticeCandidate = await practiceCandidateStore.updateExercise(activePracticeCandidate.candidateId, exercise);
    showPracticeCandidate(activePracticeCandidate);
    setPracticeQualityStatus("候选内容已保存为新版本。历史审查记录仍保留；请重新运行确定性校验。");
  } catch (error) {
    setPracticeQualityStatus(error.message || "无法保存候选修改。", true);
  } finally {
    button.disabled = false;
  }
}

async function approveActivePracticeCandidate() {
  if (!activePracticeCandidate || !$("practice-quality-approval-confirm").checked) return;
  const history = activePracticeQualityHistory;
  const review = history?.records?.filter(record => record.recordType === "review").at(-1);
  if (!review?.payload?.reviewId || review.payload.verdict !== "pass") {
    setPracticeQualityStatus("没有匹配当前版本的 pass 审查记录，禁止批准。", true);
    return;
  }
  const button = $("practice-quality-approve");
  button.disabled = true;
  try {
    const result = await practiceQualityClient.approve(activePracticeCandidate.candidateId, review.payload.reviewId, true);
    setPracticeQualityStatus("人工批准已记录。题目尚未发布到正式题库。");
    await renderPracticeQualityPanel(activePracticeCandidate);
  } catch (error) {
    setPracticeQualityStatus(error.message || "人工批准失败。", true);
  } finally {
    button.disabled = false;
  }
}

async function rejectActivePracticeCandidate() {
  if (!activePracticeCandidate) return;
  const reason = $("practice-quality-reject-reason").value.trim();
  if (reason.length < 8) {
    setPracticeQualityStatus("请填写至少 8 个字符的拒绝原因。", true);
    return;
  }
  const button = $("practice-quality-reject");
  button.disabled = true;
  try {
    await practiceQualityClient.reject(activePracticeCandidate.candidateId, reason);
    setPracticeQualityStatus("拒绝原因和审批主体已记录，审查历史仍保留。");
    await renderPracticeQualityPanel(activePracticeCandidate);
  } catch (error) {
    setPracticeQualityStatus(error.message || "拒绝操作失败。", true);
  } finally {
    button.disabled = false;
  }
}

async function prepareActivePracticeRegistration() {
  if (!activePracticeCandidate) return;
  const button = $("practice-quality-prepare-registration");
  button.disabled = true;
  try {
    const result = await practiceQualityClient.prepareRegistration(activePracticeCandidate.candidateId);
    $("practice-quality-workflow-link").hidden = false;
    $("practice-quality-workflow-link").href = result.workflowUrl;
    setPracticeQualityStatus("已生成正式题库待发布记录 " + result.assessmentId +
      "。PR 尚待人工审查，合并并验证 Pages 后才会标记 registered。");
    await renderPracticeQualityPanel(activePracticeCandidate);
  } catch (error) {
    setPracticeQualityStatus(error.message || "正式题库发布请求生成失败。", true);
  } finally {
    button.disabled = false;
  }
}

function showPracticeCandidate(item) {
  activePracticeCandidate = item;
  practiceHintCount = 0;
  const card = $("practice-candidate-active");
  card.hidden = false;
  $("practice-candidate-state").textContent = item.status === "attempted" ? "已尝试 · 不计分" : "未评分草案";
  $("practice-candidate-title").textContent = item.exercise.title;
  $("practice-candidate-prompt").textContent = item.exercise.prompt;
  const stimulus = $("practice-candidate-stimulus");
  stimulus.textContent = item.exercise.stimulus || "";
  stimulus.hidden = !item.exercise.stimulus;
  const sourceNames = item.exercise.sourceVariantIds.map(id =>
    assessments.assessments.find(row => row.id === id)?.title || id
  );
  $("practice-candidate-sources").textContent = sourceNames.join(" · ");
  $("practice-candidate-answer").value = item.learnerResponse || "";
  $("practice-candidate-answer").disabled = item.status === "attempted";
  $("practice-candidate-submit").hidden = item.status === "attempted";
  $("practice-candidate-submit").disabled = false;
  $("practice-candidate-delete").hidden = false;
  $("practice-candidate-hint-list").replaceChildren();
  $("practice-candidate-hint").disabled = item.status === "attempted";
  $("practice-candidate-hint").textContent = "展开第一级提示";
  const saved = $("practice-candidate-answer-saved");
  const reference = $("practice-candidate-reference-answer");
  const rubric = $("practice-candidate-rubric");
  saved.hidden = item.status !== "attempted";
  reference.hidden = item.status !== "attempted";
  rubric.hidden = item.status !== "attempted";
  saved.textContent = item.status === "attempted"
    ? "你的原始推理已保存：\n" + item.learnerResponse
    : "";
  reference.textContent = item.status === "attempted"
    ? "预期推理：\n" + item.exercise.expectedReasoning +
      "\n\n参考答案（AI 草案，未独立审核）：\n" + item.exercise.exemplarAnswer +
      "\n\n常见误区：\n" + item.exercise.commonTrap
    : "";
  rubric.replaceChildren();
  if (item.status === "attempted") {
    const title = el("strong", "", "自我检查要点");
    const list = el("ol");
    item.exercise.rubric.forEach(row => {
      list.append(el("li", "", row.criterion + "： " + row.expectedSignal));
    });
    rubric.append(title, list);
  }
  renderPracticeCandidateList().catch(error => setPracticeStatus(error.message, true));
  renderPracticeQualityPanel(item).catch(error => setPracticeQualityStatus(error.message, true));
}

async function renderPracticeCandidateList() {
  const host = $("practice-candidate-list");
  if (!practiceCandidateStore || !targetCompetencyId || !targetGapId) return;
  const rows = await practiceCandidateStore.list({
    competencyId: targetCompetencyId,
    gapId: targetGapId,
    limit: 8,
  });
  host.replaceChildren();
  if (!rows.length) {
    host.append(el("div", "rw-empty", "当前 Gap 还没有补充练习草案。"));
    return;
  }
  rows.forEach(item => {
    const button = el("button", "rw-candidate-row");
    button.type = "button";
    button.setAttribute("aria-current", item.candidateId === activePracticeCandidate?.candidateId ? "true" : "false");
    button.append(
      el("strong", "", item.exercise.title),
      el("small", "", (item.status === "attempted" ? "已作答 · " : "未作答 · ") + fmt(item.updatedAt)),
    );
    button.addEventListener("click", () => showPracticeCandidate(item));
    host.append(button);
  });
}

async function renderPracticeWorkbench() {
  const panel = $("practice-candidate-workbench");
  if (!panel) return;
  if (!targetGapId || !targetCompetencyId) {
    panel.hidden = true;
    return;
  }
  await ensurePracticeRuntime();
  panel.hidden = false;
  const target = await currentPracticeTarget();
  const generationButton = $("generate-practice-candidate");
  $("practice-gap-label").textContent = target?.gap?.label || target?.competency?.title || targetGapId;
  generationButton.disabled = !target?.gap || target.sources.length < 2;
  if (!target?.gap) {
    setPracticeStatus("当前 Gap 已由正式评估纠正，不能再生成针对它的新草案；历史草案仍可查看。");
  } else if (target.sources.length < 2) {
    setPracticeStatus("当前 Gap 尚无两个正式题目锚点；请先使用现有课程或作品中的练习。", true);
  } else {
    setPracticeStatus("AI 参考思路未经独立审核；这类练习不计分，也不会影响掌握度。");
  }
  const rows = await practiceCandidateStore.list({
    competencyId: targetCompetencyId,
    gapId: targetGapId,
    limit: 8,
  });
  if (activePracticeCandidate) {
    const latest = rows.find(item => item.candidateId === activePracticeCandidate.candidateId);
    if (latest) activePracticeCandidate = latest;
    else activePracticeCandidate = null;
  }
  await renderPracticeCandidateList();
  if (activePracticeCandidate) showPracticeCandidate(activePracticeCandidate);
  else if (rows.length) showPracticeCandidate(rows[0]);
  else $("practice-candidate-active").hidden = true;
}

async function generatePracticeCandidate() {
  if (!$("practice-ai-consent").checked) {
    setPracticeStatus("请先明确授权本轮 AI 请求；没有发送任何数据。", true);
    return;
  }
  const button = $("generate-practice-candidate");
  button.disabled = true;
  button.textContent = "正在生成并校验…";
  setPracticeStatus("正在核对当前 Gap、正式题目锚点和近期使用记录。");
  try {
    const target = await currentPracticeTarget();
    if (!target?.gap) throw new Error("当前 Gap 已不存在或已被正式评估纠正，未生成新练习。");
    if (target.sources.length < 2) throw new Error("当前 Gap 没有两个正式题目锚点，不能生成候选练习。");
    const recentlyUsed = new Set(target.recentlyUsedVariantIds);
    const freshAnchor = target.sources.find(item => !recentlyUsed.has(item.id));
    const primaryAnchor = freshAnchor || target.sources[0];
    const secondaryAnchor = target.sources.find(item => item.id !== primaryAnchor.id);
    const selectedSources = [primaryAnchor, secondaryAnchor];
    if (selectedSources.some(item => !item)) {
      throw new Error("无法为当前 Gap 选择两个不同的正式题目锚点。");
    }
    const sourceRows = selectedSources.map(item => ({
      id: item.id,
      title: item.title,
      prompt: item.prompt,
      code: item.code || "",
      options: (item.options || []).map(option => ({ id: option.id, label: option.label })),
      answer: item.answer,
      explanation: item.explanation || "",
    }));
    const context = {
      competencyId: target.competency.id,
      competencyTitle: target.competency.title,
      topicId: target.competency.topicId,
      topicTitle: target.competency.topicTitle,
      gapId: targetGapId,
      gapLabel: target.gap.label,
      registry: assessments,
      allowedSourceVariantIds: sourceRows.map(item => item.id),
      recentlyUsedVariantIds: target.recentlyUsedVariantIds,
      existingCandidates: await practiceCandidateStore.list({
        competencyId: targetCompetencyId, gapId: targetGapId, limit: 30,
      }),
    };
    const learningScene = {
      page: { title: "针对性复习工作台", path: location.pathname },
      topics: [{ id: context.topicId, title: context.topicTitle }],
      competencies: [{ id: context.competencyId, title: context.competencyTitle, topicId: context.topicId }],
      gaps: [{ id: context.gapId, label: context.gapLabel, competencyId: context.competencyId }],
      practiceGeneration: {
        instruction: "仅生成一个开放式、无评分的补充练习。必须准确引用下面两个正式题目 ID。",
        officialSources: sourceRows,
        recentlyUsedVariantIds: context.recentlyUsedVariantIds,
        schemaVersion: 1,
      },
    };
    const response = await practiceProvider.ask({
      mode: "tutor",
      tutorMode: "practice",
      message: [
        "请为当前仍未解决的 Gap 生成一份额外的开放式练习草案。",
        "题目必须改变场景并要求真实推理，不得照抄正式题目；不要生成选择题或正式答案判分机制。",
        "参考思路必须与给定的两个正式来源一致。仅在 reply 字段返回符合系统 schema 的纯 JSON，不要 Markdown。",
      ].join("\n"),
      context: { learningScene, recentConversation: [] },
    });
    const exercise = parseLearningPracticeCandidateReply(response.reply, context);
    const saved = await practiceCandidateStore.saveDraft({
      exercise,
      context,
      recentlyUsedVariantIds: context.recentlyUsedVariantIds,
    });
    activePracticeCandidate = saved;
    showPracticeCandidate(saved);
    setPracticeStatus("候选练习已保存到你的私有学习档案。它仍是未评分草案，不会创建学习事件。");
  } catch (error) {
    setPracticeStatus(error.message || "练习候选生成失败；没有写入草案。", true);
  } finally {
    $("practice-ai-consent").checked = false;
    button.disabled = false;
    button.textContent = "生成一份练习草案";
    const target = await currentPracticeTarget().catch(() => null);
    if (!target?.gap) button.disabled = true;
  }
}

async function submitPracticeCandidate() {
  if (!activePracticeCandidate) return;
  const button = $("practice-candidate-submit");
  button.disabled = true;
  try {
    const saved = await practiceCandidateStore.markAttempted(
      activePracticeCandidate.candidateId,
      $("practice-candidate-answer").value,
    );
    activePracticeCandidate = saved;
    showPracticeCandidate(saved);
    setPracticeStatus("已保存你的作答并展开参考思路。没有生成评分、掌握证据或 Gap 关闭记录。");
  } catch (error) {
    setPracticeStatus(error.message || "保存练习作答失败。", true);
  } finally {
    button.disabled = false;
  }
}

async function deletePracticeCandidate() {
  if (!activePracticeCandidate) return;
  try {
    const qualityHistory = await practiceQualityClient.history(activePracticeCandidate.candidateId).catch(() => null);
    const qualityStatus = qualityHistory?.status || "draft";
    if (["machine_reviewed", "approved", "registration_pending", "registered", "rejected"].includes(qualityStatus)) {
      throw new Error("候选题已进入质量审查或审批阶段，不能通过删除原始草案清除审查历史。");
    }
    if (qualityHistory?.records?.length) {
      await practiceQualityClient.delete(activePracticeCandidate.candidateId);
    }
    await practiceCandidateStore.remove(activePracticeCandidate.candidateId);
    activePracticeCandidate = null;
    $("practice-candidate-active").hidden = true;
    await renderPracticeWorkbench();
    setPracticeStatus("练习草案已从个人学习档案中删除。");
  } catch (error) {
    setPracticeStatus(error.message || "删除练习草案失败。", true);
  }
}

function revealPracticeHint() {
  if (!activePracticeCandidate || activePracticeCandidate.status !== "draft") return;
  const hints = activePracticeCandidate.exercise.hints;
  if (practiceHintCount >= hints.length) return;
  $("practice-candidate-hint-list").append(el("li", "", hints[practiceHintCount]));
  practiceHintCount += 1;
  $("practice-candidate-hint").textContent = practiceHintCount >= hints.length
    ? "提示已全部展开"
    : "展开第二级提示";
  $("practice-candidate-hint").disabled = practiceHintCount >= hints.length;
}

function wire() {
  $("reveal-hint").addEventListener("click",()=>revealHint().catch(error=>console.error("[KNOWVERSE] Hint save failed:",error)));
  $("next-variant").addEventListener("click",()=>startSession({competencyId:targetCompetencyId,gapId:targetGapId}).catch(error=>console.error("[KNOWVERSE] Review start failed:",error)));
  $("generate-practice-candidate").addEventListener("click", () => generatePracticeCandidate());
  $("practice-candidate-submit").addEventListener("click", () => submitPracticeCandidate());
  $("practice-candidate-delete").addEventListener("click", () => deletePracticeCandidate());
  $("practice-candidate-hint").addEventListener("click", () => revealPracticeHint());
  $("practice-quality-validate").addEventListener("click", () => validateActivePracticeCandidate());
  $("practice-quality-review").addEventListener("click", () => reviewActivePracticeCandidate());
  $("practice-quality-save-edit").addEventListener("click", () => savePracticeQualityEdit());
  $("practice-quality-approval-confirm").addEventListener("change", event => {
    $("practice-quality-approve").disabled = !event.currentTarget.checked ||
      !activePracticeQualityHistory?.canApprove ||
      activePracticeQualityHistory?.status !== "machine_reviewed";
  });
  $("practice-quality-approve").addEventListener("click", () => approveActivePracticeCandidate());
  $("practice-quality-reject").addEventListener("click", () => rejectActivePracticeCandidate());
  $("practice-quality-prepare-registration").addEventListener("click", () => prepareActivePracticeRegistration());
}
async function boot() {
  if (!progressStore.available) throw new Error("当前浏览器不支持 IndexedDB，无法保存复习会话。");
  await progressStore.load(); // Opens the repository and completes the Phase C migration before rendering.
  const [mapResponse,challengeResponse,assessmentResponse]=await Promise.all([
    fetch(new URL("content/learning-map.json",root)),
    fetch(new URL("content/challenges.json",root)),
    fetch(new URL("content/review-assessments.json",root)),
  ]);
  if(!mapResponse.ok||!challengeResponse.ok||!assessmentResponse.ok) throw new Error("复习注册表载入失败。");
  [map,registry,assessments]=await Promise.all([mapResponse.json(),challengeResponse.json(),assessmentResponse.json()]);
  engine=createReviewSessionEngine({registry:assessments});
  wire();
  const competencyId=params.get("competencyId");
  const gapId=params.get("gapId");
  activeTaskId=params.get("taskId") || null;
  if (activeTaskId) {
    await ensureTaskOrchestrator();
    const task = await taskOrchestrator.get(activeTaskId);
    if (!task || task.taskType !== "review" && task.taskType !== "assessment") {
      throw new Error("复习入口关联的任务无效。");
    }
    if (task.competencyId !== competencyId) throw new Error("复习任务与 URL 知识节点不匹配。");
    if ((task.gapId || null) !== (gapId || null)) throw new Error("复习任务与 URL 薄弱点不匹配。");
    if (["completed", "skipped", "cancelled"].includes(task.status)) activeTaskId = null;
  }
  await renderPicker();
  await renderHistory();
  updateWorkspaceNav();
  if(competencyId) {
    if (activeTaskId) {
      const active = await engine.getActiveSessions();
      const existing = active.find(item => item.competencyId === competencyId &&
        (item.targetGapId || null) === (gapId || null));
      if (existing) {
        session = existing;
        targetCompetencyId = existing.competencyId;
        targetGapId = existing.targetGapId || null;
        renderSession();
        setFeedback("已恢复与当前任务关联的复习现场。");
        await renderPracticeWorkbench();
      } else {
        await startSession({competencyId,gapId});
      }
    } else {
      await startSession({competencyId,gapId});
    }
  } else {
    const active = await engine.getActiveSessions();
    if (active.length) {
      session = active[0];
      targetCompetencyId = session.competencyId;
      targetGapId = session.targetGapId || null;
      renderSession();
      setFeedback("已从学习数据库自动恢复最近一次未完成的复习现场。");
      await renderPracticeWorkbench();
    }
  }
}
boot().catch(error=>{
  console.error("[KNOWVERSE] review workspace unavailable:",error);
  $("target-list").replaceChildren(el("div","rw-empty","复习工作台载入失败："+error.message));
});
