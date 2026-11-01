import {
  completeStep,
  createChallengeProgressStore,
  getStepProgress,
  recordAttempt,
  resetChallengeProgress,
  revealNextHint,
  setStepData,
  summarizeChallenge,
} from "./challenge-engine.mjs";
import { mountPromiseQuestWorld } from "./promise-quest-world.mjs";

const siteRoot = new URL("../../", import.meta.url);
const $ = id => document.getElementById(id);
let challenge;
let progress;
let store;
let world;
let currentIndex = 0;

function getCurrentIndex() {
  return challenge.steps.findIndex(step => getStepProgress(progress, step.id).status !== "completed");
}

function getCurrentStep() {
  const index = getCurrentIndex();
  return index < 0 ? null : challenge.steps[index];
}

function saveProgress() {
  const saved = store.save(progress);
  updateDashboard(saved);
}

function updateDashboard(saved = store?.available ?? false) {
  if (!challenge || !progress) return;
  const summary = summarizeChallenge(challenge, progress);
  $("stat-progress").textContent = summary.completedSteps + " / " + summary.totalSteps;
  $("stat-attempts").textContent = String(summary.attempts);
  $("stat-hints").textContent = String(summary.hintsUsed);
  $("stat-score").textContent = summary.earnedPoints + " / " + summary.maxPoints;
  $("save-status").textContent = saved
    ? "进度已保存在当前设备；关闭页面后仍可继续。"
    : "当前浏览器未开放本地存储；刷新后将无法恢复本次进度。";
  challenge.steps.forEach((step, index) => {
    const item = getStepProgress(progress, step.id);
    const bar = document.querySelector('[data-progress-step="' + index + '"]');
    bar?.classList.toggle("done", item.status === "completed");
    bar?.classList.toggle("active", item.status === "active");
  });
}

function makeLink(label, href) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  anchor.textContent = label + " ↗";
  return anchor;
}

function renderLinks(step) {
  const host = $("step-links");
  host.replaceChildren();
  if (step.lessonHref) host.append(makeLink("对应原理课", step.lessonHref));
  if (step.labHref) host.append(makeLink(step.labLabel || "打开原理实验", step.labHref));
}

function renderHints(step, state) {
  const list = $("hint-list");
  list.replaceChildren();
  const shown = (step.hints || []).slice(0, state.hintsUsed);
  if (!shown.length) {
    const item = document.createElement("li");
    item.textContent = "先独立分析；遇到阻碍时再展开提示。";
    list.append(item);
  } else {
    shown.forEach(hint => {
      const item = document.createElement("li");
      item.textContent = hint;
      list.append(item);
    });
  }
  const count = step.hints?.length || 0;
  const button = $("hint-next");
  button.disabled = state.status !== "active" || state.hintsUsed >= count;
  button.textContent = state.hintsUsed >= count
    ? "已展开全部提示"
    : "展开下一条提示 (" + state.hintsUsed + "/" + count + ")";
}

function renderStep(index) {
  currentIndex = index;
  const step = challenge.steps[index];
  const state = getStepProgress(progress, step.id);
  $("question-view").hidden = false;
  $("complete-view").hidden = true;
  $("step-eyebrow").textContent = "GATE " + String(index + 1).padStart(2, "0") + " / " + (step.focus?.[0] || "PROMISE");
  $("step-counter").textContent = String(index + 1).padStart(2, "0") + " / " + String(challenge.steps.length).padStart(2, "0");
  $("step-title").textContent = step.title;
  $("step-intro").textContent = step.intro || "";
  $("step-prompt").textContent = step.prompt || "";
  $("step-code").textContent = step.code || "";
  $("step-code").hidden = !step.code;

  const focus = $("step-focus");
  focus.replaceChildren();
  (step.focus || []).forEach(tag => {
    const chip = document.createElement("span");
    chip.textContent = tag;
    focus.append(chip);
  });

  const options = $("step-options");
  options.replaceChildren();
  step.options.forEach((option, optionIndex) => {
    const button = document.createElement("button");
    button.className = "pq-option";
    button.type = "button";
    button.dataset.optionId = option.id;

    const serial = document.createElement("span");
    serial.className = "pq-option-index";
    serial.textContent = String.fromCharCode(65 + optionIndex);

    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = option.label;
    copy.append(title);
    button.append(serial, copy);
    button.disabled = state.status !== "active";
    if (state.data?.misconceptions?.some(item => item.optionId === option.id)) {
      button.classList.add("was-wrong");
    }
    if (state.data?.correctOptionId === option.id) button.classList.add("is-correct");
    button.addEventListener("click", () => chooseOption(step, option));
    options.append(button);
  });

  const feedback = $("step-feedback");
  feedback.className = "pq-feedback";
  if (state.status === "active" && state.data?.lastFeedback) {
    feedback.textContent = state.data.lastFeedback;
    feedback.classList.add("is-bad");
  } else {
    feedback.textContent = "选择一个答案。系统会检查你的判断，并指出具体概念边界。";
  }

  renderHints(step, state);
  renderLinks(step);
  $("step-continue").hidden = state.status !== "completed";
  $("scene-mode").textContent = step.focus?.join(" / ").toUpperCase() || "PROMISE MECHANISM MAP";
  world?.setStage(index);
  updateDashboard();
}

function chooseOption(step, option) {
  const state = getStepProgress(progress, step.id);
  if (state.status !== "active") return;

  progress = recordAttempt(progress, step.id);
  const previousMistakes = getStepProgress(progress, step.id).data.misconceptions || [];

  if (option.id === step.answer) {
    progress = setStepData(progress, step.id, {
      correctOptionId: option.id,
      lastGapId: null,
      lastFeedback: "",
      misconceptions: previousMistakes,
    });
    progress = completeStep(progress, challenge, step.id);
    saveProgress();

    document.querySelectorAll(".pq-option").forEach(button => {
      button.disabled = true;
      if (button.dataset.optionId === option.id) button.classList.add("is-correct");
    });
    const feedback = $("step-feedback");
    feedback.className = "pq-feedback is-good";
    feedback.textContent = step.successFeedback || "正确。你已经通过这一机制关卡。";
    $("hint-next").disabled = true;
    $("step-continue").hidden = false;
    $("step-continue").textContent = currentIndex === challenge.steps.length - 1 ? "查看诊断报告 →" : "继续下一关 →";
  } else {
    const diagnosis = option.diagnosis || "这个判断遗漏了一个关键机制边界。";
    const gap = option.gap || "Promise 机制理解";
    const mistakes = [
      ...previousMistakes.filter(item => item.gap !== gap),
      { gap, optionId: option.id },
    ];
    progress = setStepData(progress, step.id, {
      lastFeedback: diagnosis,
      lastOptionId: option.id,
      lastGapId: option.gapId || null,
      misconceptions: mistakes,
    });
    saveProgress();

    document.querySelectorAll(".pq-option").forEach(button => {
      if (button.dataset.optionId === option.id) {
        button.classList.add("is-wrong");
        button.classList.add("was-wrong");
      }
    });
    const feedback = $("step-feedback");
    feedback.className = "pq-feedback is-bad";
    feedback.textContent = "薄弱点定位 · " + gap + "。 " + diagnosis;
  }
}

function revealHint() {
  const step = getCurrentStep();
  if (!step) return;
  const result = revealNextHint(progress, challenge, step.id);
  if (result.exhausted) return;
  progress = result.progress;
  saveProgress();
  renderHints(step, getStepProgress(progress, step.id));
}

function renderGapReport() {
  const host = $("gap-report");
  host.replaceChildren();
  const gaps = new Map();

  challenge.steps.forEach(step => {
    const state = getStepProgress(progress, step.id);
    (state.data?.misconceptions || []).forEach(item => {
      if (!gaps.has(item.gap)) gaps.set(item.gap, step);
    });
  });

  if (!gaps.size) {
    const item = document.createElement("p");
    item.textContent = "本次没有记录到需要纠正的概念误区。建议进入原理实验室，用单步方式再独立推演一次。";
    host.append(item);
    return;
  }

  gaps.forEach((step, gap) => {
    const item = document.createElement("p");
    item.append(document.createTextNode("需要复习：" + gap + "。 "));
    const lesson = document.createElement("a");
    lesson.href = step.lessonHref || "../../../knowledge/promise/";
    lesson.target = "_blank";
    lesson.rel = "noopener";
    lesson.textContent = "返回 " + step.title + " 对应课程";
    item.append(lesson);
    host.append(item);
  });
}

function showComplete() {
  $("question-view").hidden = true;
  $("complete-view").hidden = false;
  $("scene-mode").textContent = "ALL MECHANISM GATES CLEARED";
  world?.setStage(challenge.steps.length - 1);
  const summary = summarizeChallenge(challenge, progress);
  $("final-summary").textContent =
    "五道关卡全部完成。得分 " + summary.earnedPoints + " / " + summary.maxPoints +
    "；作答 " + summary.attempts + " 次；使用提示 " + summary.hintsUsed + " 条。" +
    "掌握率 " + Math.round(summary.completionRate * 100) + "%。";
  $("score-meter-fill").style.width = Math.round(summary.maxPoints ? summary.earnedPoints / summary.maxPoints * 100 : 0) + "%";
  renderGapReport();
  updateDashboard();
}

function continueQuest() {
  const next = getCurrentIndex();
  if (next < 0) {
    showComplete();
    return;
  }
  renderStep(next);
}

function resetQuest() {
  if (!window.confirm("确定要重置当前 Promise 挑战的关卡进度吗？历史作答、提示、已识别薄弱点和复习验证记录会保留，不会被删除。")) return;
  store.clear(challenge.id);
  progress = resetChallengeProgress(challenge);
  saveProgress();
  renderStep(0);
}

async function boot() {
  const response = await fetch(new URL("content/challenges.json", siteRoot), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Challenge registry HTTP " + response.status);
  const registry = await response.json();
  challenge = registry.challenges.find(item => item.id === "promise-mechanism-quest");
  if (!challenge || challenge.steps.length !== 5) {
    throw new Error("Promise challenge definition is missing or incomplete.");
  }
  store = createChallengeProgressStore();
  progress = store.load(challenge);

  world = mountPromiseQuestWorld($("promise-world"));
  if (!world.supported) $("scene-fallback").hidden = false;

  $("hint-next").addEventListener("click", revealHint);
  $("step-continue").addEventListener("click", continueQuest);
  $("reset-quest").addEventListener("click", resetQuest);
  $("restart-quest").addEventListener("click", resetQuest);

  updateDashboard(store.save(progress));
  const index = getCurrentIndex();
  if (index < 0) showComplete();
  else renderStep(index);
}

boot().catch(error => {
  console.error(error);
  $("step-title").textContent = "挑战载入失败";
  $("step-intro").textContent = "请检查页面资源是否已部署，然后刷新重试。";
  $("step-feedback").textContent = "错误：" + error.message;
  $("step-feedback").classList.add("is-bad");
  $("scene-fallback").hidden = false;
});
