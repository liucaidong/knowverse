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
    session=await engine.start(input);
    renderSession();
    setFeedback("先独立推演，不要急着展开提示。选项提交后，本次会话会单独结束并记录验证结果。");
    $("hint-list").replaceChildren();
    $("answer-explanation").hidden=true;
    $("next-variant").hidden=true;
    await renderHistory();
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
    $("next-variant").textContent="用另一个题型再次验证 →";
    $("next-variant").hidden=false;
  } catch(error) { setFeedback(error.message,"bad"); throw error; }
}
function wire() {
  $("reveal-hint").addEventListener("click",()=>revealHint().catch(error=>console.error("[KNOWVERSE] Hint save failed:",error)));
  $("next-variant").addEventListener("click",()=>startSession({competencyId:targetCompetencyId,gapId:targetGapId}).catch(error=>console.error("[KNOWVERSE] Review start failed:",error)));
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
  await renderPicker();
  await renderHistory();
  if(competencyId) {
    await startSession({competencyId,gapId});
  } else {
    const active = await engine.getActiveSessions();
    if (active.length) {
      session = active[0];
      targetCompetencyId = session.competencyId;
      targetGapId = session.targetGapId || null;
      renderSession();
      setFeedback("已从学习数据库自动恢复最近一次未完成的复习现场。");
    }
  }
}
boot().catch(error=>{
  console.error("[KNOWVERSE] review workspace unavailable:",error);
  $("target-list").replaceChildren(el("div","rw-empty","复习工作台载入失败："+error.message));
});
