import { createLearningProgressStore, deriveLearningInsights } from "./learning-progress.mjs";
import { createReviewSessionEngine } from "./review-engine.mjs";
import { createLearningTaskOrchestrator } from "./learning-agent/task-orchestrator.mjs";
import { createLearningAgentProvider } from "./learning-agent/agent-provider.mjs";
import {
  createLearningPracticeCandidateStore,
  parseLearningPracticeCandidateReply,
} from "./learning-practice-candidates.mjs";

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
let practiceProvider = null;
let practiceCandidateStore = null;
let activePracticeCandidate = null;
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
    topic.competencies.forEach(competency => {
      const state = insight.competencyInsights.find(row=>row.id===competency.id);
      const button = el("button","rw-target");
      button.type = "button";
      const copy = el("span");
      copy.append(el("strong","",competency.title));
      const gapCount = state?.activeGaps?.length || 0;
      copy.append(el("small","",topic.title+" · "+(statusName[state?.status]||"待验证")+" · "+(gapCount?gapCount+" 个待纠正薄弱点":"无未解决薄弱点")));
      button.append(copy,el("em","",state?.masteryScore===null||state?.masteryScore===undefined?"开始验证":state.masteryScore+"% →"));
      button.addEventListener("click",()=>startSession({competencyId:competency.id}).catch(error=>setFeedback(error.message,"bad")));
      host.append(button);
    });
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
  $("session-title").textContent = competency?.title || session.title;
  $("session-context").textContent = session.targetGapId
    ? "目标薄弱点："+(map.gaps.find(item=>item.id===session.targetGapId)?.label || session.targetGapId)+" · 本次复习与原挑战完全隔离"
    : (competency?.topicTitle || session.topicId)+" · 独立知识点验证";
  $("session-status-label").textContent = session.status==="active"?"进行中":session.status==="passed"?"已通过":"未通过";
  $("session-variant").textContent = session.variantId.toUpperCase();
  $("question-topic").textContent = (session.topicId || "KNOWLEDGE").toUpperCase();
  $("question-progress").textContent = session.targetGapId ? "TARGETED GAP REVIEW" : "INDEPENDENT CHECK";
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
  if (!targetGapId || !targetCompetencyId || !practiceCandidateStore) {
    panel.hidden = true;
    return;
  }
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
  taskOrchestrator=createLearningTaskOrchestrator();
  practiceProvider=createLearningAgentProvider();
  practiceCandidateStore=createLearningPracticeCandidateStore({ registry: assessments });
  wire();
  const competencyId=params.get("competencyId");
  const gapId=params.get("gapId");
  activeTaskId=params.get("taskId") || null;
  if (activeTaskId) {
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
