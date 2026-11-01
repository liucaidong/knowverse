import { createLearningProgressStore, deriveLearningInsights } from "./learning-progress.mjs";
import { createReviewSessionEngine } from "./review-engine.mjs";

const root = new URL("../../", import.meta.url);
const $ = id => document.getElementById(id);
const storage = (() => { try { return localStorage; } catch { return null; } })();
const progressStore = createLearningProgressStore({ storage });
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
function insightsNow() {
  return deriveLearningInsights(map, registry, progressStore.load());
}
function renderHistory() {
  const host = $("history-list");
  host.replaceChildren();
  const rows = engine.getHistory().slice().sort((a,b) => Date.parse(b.startedAt)-Date.parse(a.startedAt)).slice(0,6);
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
    row.append(copy,el("em","",item.status==="passed"?"通过":item.status==="failed"?"未通过":"进行中"));
    host.append(row);
  });
}
function renderPicker() {
  const host = $("target-list");
  host.replaceChildren();
  const insight = insightsNow();
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
      button.addEventListener("click",()=>startSession({competencyId:competency.id}));
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
    button.addEventListener("click",()=>submitAnswer(option.id));
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
function startSession(input) {
  try {
    targetCompetencyId=input.competencyId;
    targetGapId=input.gapId || null;
    session=engine.start(input);
    renderSession();
    setFeedback("先独立推演，不要急着展开提示。选项提交后，本次会话会单独结束并记录验证结果。");
    $("hint-list").replaceChildren();
    $("answer-explanation").hidden=true;
    $("next-variant").hidden=true;
    renderHistory();
    $("review-session").scrollIntoView({behavior:"smooth",block:"start"});
  } catch(error) {
    window.alert(error.message);
  }
}
function revealHint() {
  try {
    const result=engine.revealHint(session.sessionId);
    session=result.session;
    if(result.hint) $("hint-list").append(el("li","",result.hint));
    renderSession();
    setFeedback("已展开提示。提示不会阻止完成本题，但本次通过会被标记为辅助验证。");
  } catch(error) { setFeedback(error.message,"bad"); }
}
function submitAnswer(optionId) {
  try {
    const result=engine.submit(session.sessionId,optionId);
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
      const latest=insightsNow();
      const resolved=targetGapId && !latest.gaps.some(gap=>gap.id===targetGapId && gap.competencyId===targetCompetencyId);
      setFeedback(resolved
        ? "独立验证通过，薄弱点「"+targetGapId+"」已由不同题型的无提示证据精确纠正。"
        : "独立验证通过，已记录新的知识掌握证据。再使用不同变体复核，可提高掌握置信度。","good");
    }
    renderPicker();
    renderHistory();
    $("next-variant").textContent="用另一个题型再次验证 →";
    $("next-variant").hidden=false;
  } catch(error) { setFeedback(error.message,"bad"); }
}
function wire() {
  $("reveal-hint").addEventListener("click",revealHint);
  $("next-variant").addEventListener("click",()=>startSession({competencyId:targetCompetencyId,gapId:targetGapId}));
}
async function boot() {
  if (!progressStore.available) throw new Error("当前浏览器未开放 localStorage，无法保存复习会话。");
  const [mapResponse,challengeResponse,assessmentResponse]=await Promise.all([
    fetch(new URL("content/learning-map.json",root)),
    fetch(new URL("content/challenges.json",root)),
    fetch(new URL("content/review-assessments.json",root)),
  ]);
  if(!mapResponse.ok||!challengeResponse.ok||!assessmentResponse.ok) throw new Error("复习注册表载入失败。");
  [map,registry,assessments]=await Promise.all([mapResponse.json(),challengeResponse.json(),assessmentResponse.json()]);
  engine=createReviewSessionEngine({storage,registry:assessments});
  wire();
  const competencyId=params.get("competencyId");
  const gapId=params.get("gapId");
  renderPicker();
  renderHistory();
  if(competencyId) startSession({competencyId,gapId});
}
boot().catch(error=>{
  console.error("[KNOWVERSE] review workspace unavailable:",error);
  $("target-list").replaceChildren(el("div","rw-empty","复习工作台载入失败："+error.message));
});
