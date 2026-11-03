import { createLearningProgressStore } from "./learning-progress.mjs";
import { createLearningCheckpointEngine } from "./learning-checkpoint-engine.mjs";
import { createLearningTaskOrchestrator } from "./learning-agent/task-orchestrator.mjs";
import { startLearningActivityTelemetry } from "./learning-activity.mjs";
import { mountLearningTutor } from "./learning-tutor.mjs";

const siteRoot = new URL("../../", import.meta.url);
const normalizePath = value => {
  let decoded = decodeURI(value || "/");
  if (decoded.endsWith("index.html")) decoded = decoded.slice(0, -10);
  while (decoded.length > 1 && decoded.endsWith("/")) decoded = decoded.slice(0, -1);
  return decoded || "/";
};
const readJSON = async relative => {
  const response = await fetch(new URL(relative, import.meta.url), { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取学习注册表：" + relative + " (" + response.status + ")");
  return response.json();
};
const create = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function injectStyles() {
  if (document.getElementById("kv-learning-integration-style")) return;
  const style = create("style");
  style.id = "kv-learning-integration-style";
  style.textContent = `
    .kv-li-launcher{position:fixed;z-index:9000;right:18px;bottom:18px;border:1px solid #b8dcd4;border-radius:999px;padding:11px 16px;background:#123b43;color:#fff;font:700 12px/1.2 system-ui,sans-serif;box-shadow:0 8px 28px #102f3533;cursor:pointer}
    .kv-li-launcher:hover{background:#18545a}
    .kv-li-overlay{position:fixed;z-index:10000;inset:0;display:grid;place-items:center;padding:18px;background:#071c22b8;backdrop-filter:blur(7px)}
    .kv-li-overlay[hidden]{display:none}
    .kv-li-card{width:min(620px,100%);max-height:min(88vh,760px);overflow:auto;border:1px solid #dbe8e4;border-radius:20px;background:#fbfdfc;color:#203b42;box-shadow:0 28px 90px #06191b66;font:14px/1.7 system-ui,sans-serif}
    .kv-li-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:22px 24px 15px;border-bottom:1px solid #e5eeeb}
    .kv-li-kicker{color:#17877b;font-size:10px;font-weight:850;letter-spacing:.14em}
    .kv-li-title{margin:5px 0 0;font-size:21px;line-height:1.3;color:#173a41}
    .kv-li-close{border:1px solid #d5e3df;border-radius:50%;width:34px;height:34px;background:#fff;color:#38575a;font-size:19px;cursor:pointer}
    .kv-li-content{padding:20px 24px 24px}
    .kv-li-prompt{margin:0 0 13px;color:#405d62;font-size:14px}
    .kv-li-code{margin:0 0 16px;padding:14px;border-radius:11px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#112d39;color:#e2f1ed;font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace}
    .kv-li-options{display:grid;gap:9px}
    .kv-li-option{width:100%;padding:13px 15px;border:1px solid #d9e6e2;border-radius:12px;background:#fff;color:#29474e;text-align:left;font:inherit;line-height:1.65;cursor:pointer}
    .kv-li-option:hover{border-color:#7ab9aa;background:#f4faf7}
    .kv-li-option:disabled{cursor:default;opacity:.78}
    .kv-li-feedback{margin-top:15px;padding:13px 15px;border-radius:11px;background:#f0f5f3;color:#425d5e}
    .kv-li-feedback.good{background:#eaf6ef;color:#286344}
    .kv-li-feedback.bad{background:#fff2eb;color:#8d523b}
    .kv-li-explanation{margin-top:8px;color:#526d70}
    .kv-li-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
    .kv-li-link,.kv-li-done{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:999px;padding:10px 15px;background:#153e47;color:#fff;text-decoration:none;font:700 11px system-ui,sans-serif;cursor:pointer}
    .kv-li-secondary{background:#edf4f1;color:#31585a}
    @media(max-width:560px){.kv-li-launcher{right:12px;bottom:12px}.kv-li-head{padding:18px 18px 13px}.kv-li-content{padding:17px 18px 20px}.kv-li-title{font-size:18px}}
  `;
  document.head.append(style);
}
function mountCheckpoint(work, checkpoint, store, taskOrchestrator) {
  injectStyles();
  const engine = createLearningCheckpointEngine({ store, registry: [checkpoint] });
  const launcher = create("button", "kv-li-launcher", "知识检查 · 1 题");
  launcher.id = "kv-learning-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-haspopup", "dialog");
  launcher.setAttribute("data-learning-action", "checkpoint_open");
  const overlay = create("div", "kv-li-overlay");
  overlay.id = "kv-learning-checkpoint";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  const card = create("section", "kv-li-card");
  const head = create("header", "kv-li-head");
  const heading = create("div");
  heading.append(create("div", "kv-li-kicker", "KNOWVERSE · INDEPENDENT CHECKPOINT"));
  heading.append(create("h2", "kv-li-title", "检查是否真正理解"));
  const close = create("button", "kv-li-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "关闭知识检查");
  head.append(heading, close);
  const content = create("div", "kv-li-content");
  card.append(head, content);
  overlay.append(card);
  document.body.append(launcher, overlay);

  let activeSession = null;
  let activeTask = null;
  const closeDialog = () => { overlay.hidden = true; launcher.focus(); };
  close.addEventListener("click", closeDialog);
  overlay.addEventListener("click", event => { if (event.target === overlay) closeDialog(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !overlay.hidden) closeDialog(); });

  function renderQuestion() {
    content.replaceChildren();
    content.append(create("p", "kv-li-prompt", checkpoint.prompt));
    if (checkpoint.code) {
      const code = create("pre", "kv-li-code");
      code.textContent = checkpoint.code;
      content.append(code);
    }
    const options = create("div", "kv-li-options");
    for (const option of checkpoint.options) {
      const button = create("button", "kv-li-option", option.label);
      button.type = "button";
      button.dataset.optionId = option.id;
      button.addEventListener("click", async () => {
        for (const item of options.querySelectorAll("button")) item.disabled = true;
        try {
          const result = await engine.submit(activeSession.sessionId, option.id);
          if (activeTask) {
            activeTask = result.correct
              ? await taskOrchestrator.complete(activeTask.taskId)
              : await taskOrchestrator.fail(activeTask.taskId, { reason: "本次独立检查未通过" });
          }
          const feedback = create("div", "kv-li-feedback " + (result.correct ? "good" : "bad"));
          feedback.append(create("strong", "", result.correct ? "验证通过 · 已记录独立证据" : "还需要补强这个概念"));
          feedback.append(create("p", "kv-li-explanation", result.explanation));
          if (result.correct) feedback.append(create("p", "kv-li-explanation", "这是一条有效学习证据，不代表已经稳定掌握；系统还会结合其他变体和后续日期的验证判断掌握状态。"));
          else feedback.append(create("p", "kv-li-explanation", "本次错误已作为薄弱点线索保存。需要通过针对性复习和不同题型的无提示验证来纠正。"));
          content.append(feedback);
          const actions = create("div", "kv-li-actions");
          if (!result.correct && result.gapId) {
            const reviewURL = new URL("review/", siteRoot);
            reviewURL.searchParams.set("competencyId", checkpoint.competencyId);
            reviewURL.searchParams.set("gapId", result.gapId);
            const review = create("a", "kv-li-link", "前往针对性复习");
            review.href = reviewURL.href;
            actions.append(review);
          }
          const done = create("button", "kv-li-done kv-li-secondary", "完成");
          done.type = "button";
          done.addEventListener("click", closeDialog);
          actions.append(done);
          content.append(actions);
        } catch (error) {
          content.append(create("div", "kv-li-feedback bad", error.message || "保存失败，请检查本地 IndexedDB。"));
          for (const item of options.querySelectorAll("button")) item.disabled = false;
        }
      });
      options.append(button);
    }
    content.append(options);
  }

  launcher.addEventListener("click", async () => {
    if (!store.available) {
      overlay.hidden = false;
      content.replaceChildren(create("div", "kv-li-feedback bad", "当前浏览器不支持 IndexedDB，无法保存检查结果。"));
      return;
    }
    try {
      const taskId = new URL(location.href).searchParams.get("taskId");
      activeTask = taskId ? await taskOrchestrator.get(taskId) : null;
      if (taskId && (!activeTask || !["challenge", "assessment"].includes(activeTask.taskType) ||
          activeTask.variantId && activeTask.variantId !== checkpoint.id)) {
        throw new Error("当前知识检查与计划任务不匹配，不能写入该任务的学习结果。");
      }
      if (activeTask?.status === "failed") activeTask = await taskOrchestrator.retry(activeTask.taskId);
      if (activeTask?.status === "ready") activeTask = await taskOrchestrator.start(activeTask.taskId);
      else if (activeTask?.status === "paused") {
        activeTask = await taskOrchestrator.transition(activeTask.taskId, "in_progress");
      }
      if (activeTask && activeTask.status !== "in_progress") {
        throw new Error("该学习任务当前状态为 " + activeTask.status + "，不能启动新的知识检查。");
      }
      activeSession = await engine.start(checkpoint.id, activeTask || {});
      renderQuestion();
      overlay.hidden = false;
      close.focus();
    } catch (error) {
      overlay.hidden = false;
      content.replaceChildren(create("div", "kv-li-feedback bad", error.message || "暂时无法开始检查。"));
    }
  });
}
function injectCourseTaskStyles() {
  if (document.getElementById("kv-course-learning-task-style")) return;
  const style = create("style");
  style.id = "kv-course-learning-task-style";
  style.textContent = `
    .kv-course-learning-task{margin:22px 0 28px;padding:17px 19px;border:1px solid #cbded8;border-radius:14px;background:#f5faf8;color:#21434a;font:13px/1.65 system-ui,sans-serif}
    .kv-course-learning-task strong{display:block;font-size:13px;color:#153e47}
    .kv-course-learning-task p{margin:5px 0;color:#547076}
    .kv-course-learning-task .kv-course-task-status{font-weight:650;color:#244e53}
    .kv-course-task-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
    .kv-course-task-actions button{border:1px solid #1e5960;border-radius:999px;padding:8px 13px;background:#17464d;color:white;font:650 12px system-ui,sans-serif;cursor:pointer}
    .kv-course-task-actions button.secondary{background:#fff;color:#31565c;border-color:#bfd1cb}
    .kv-course-task-actions button:disabled{opacity:.55;cursor:wait}
    .kv-course-task-error{color:#9d3b36!important}
    @media(max-width:560px){.kv-course-learning-task{padding:14px 15px;margin:17px 0 22px}.kv-course-task-actions button{flex:1 1 auto}}
  `;
  document.head.append(style);
}

async function mountCourseReadingTask(topic, competency, store, taskOrchestrator) {
  const taskId = new URL(location.href).searchParams.get("taskId");
  if (!taskId) return;
  injectCourseTaskStyles();
  const panel = create("section", "kv-course-learning-task");
  panel.id = "kv-course-learning-task";
  panel.setAttribute("aria-live", "polite");
  const heading = create("strong", "", "来自今日学习计划 · 阅读行动");
  const detail = create("p", "", competency.title + " · 预计按计划时间完成");
  const status = create("p", "kv-course-task-status", "正在核对当前学习任务…");
  const actions = create("div", "kv-course-task-actions");
  const note = create("p", "", "只有你明确开始和确认完成后，系统才会记录任务执行。阅读、浏览和页面停留不会被当作知识掌握证据。");
  panel.append(heading, detail, status, actions, note);
  const main = document.querySelector("main") || document.body;
  const articleHeading = main.querySelector("h1");
  if (articleHeading) articleHeading.insertAdjacentElement("afterend", panel);
  else main.prepend(panel);

  let task = null;
  let invalidReason = "";
  try {
    if (!store.available) throw new Error("当前浏览器无法使用 IndexedDB，不能安全更新学习任务。");
    task = await taskOrchestrator.get(taskId);
    if (!task) throw new Error("没有找到该学习任务。请从今日学习计划重新打开课程。");
    const expectedPath = task.href ? normalizePath(new URL(task.href, siteRoot).pathname) : null;
    if (task.taskType !== "read" || task.resourceType !== "lesson" ||
        task.topicId !== topic.id || task.competencyId !== competency.id ||
        expectedPath !== normalizePath(location.pathname)) {
      throw new Error("当前课程页面与计划任务的知识点或资源地址不匹配，未修改任务状态。");
    }
  } catch (error) {
    invalidReason = error?.message || "学习任务校验失败。";
  }

  const labels = {
    locked: "该阅读任务仍被前置任务或计划日期锁定。",
    ready: "尚未开始。开始阅读后，系统会记录真实任务执行状态。",
    in_progress: "阅读进行中。读完本节后，请明确确认完成。",
    paused: "本节阅读已暂停；可以从当前进度继续。",
    failed: "上次执行未完成；可以重新开始本节阅读。",
    completed: "你已确认完成本节阅读。该记录只表示任务完成，不代表知识已掌握。",
    skipped: "该阅读任务已跳过。",
    cancelled: "该阅读任务已取消。",
  };

  function render() {
    actions.replaceChildren();
    if (invalidReason) {
      status.classList.add("kv-course-task-error");
      status.textContent = invalidReason;
      return;
    }
    status.classList.remove("kv-course-task-error");
    status.textContent = labels[task.status] || "未知任务状态：" + task.status;
    const addButton = (label, action, secondary = false) => {
      const button = create("button", secondary ? "secondary" : "", label);
      button.type = "button";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          if (action === "start") {
            if (task.status === "failed") task = await taskOrchestrator.retry(task.taskId);
            if (["ready", "paused"].includes(task.status)) task = await taskOrchestrator.start(task.taskId);
          } else if (action === "pause") {
            task = await taskOrchestrator.pause(task.taskId, { reason: "学习者在课程页主动暂停阅读" });
          } else if (action === "complete") {
            task = await taskOrchestrator.complete(task.taskId, { reason: "学习者在课程页确认已完成阅读" });
            await taskOrchestrator.refreshUnlocks(task.planId);
          }
          render();
        } catch (error) {
          invalidReason = error?.message || "学习任务更新失败。";
          render();
        }
      });
      actions.append(button);
    };
    if (["ready", "paused", "failed"].includes(task.status)) {
      addButton(task.status === "ready" ? "开始本节阅读" : task.status === "paused" ? "继续阅读" : "重新开始阅读", "start");
    }
    if (task.status === "in_progress") {
      addButton("确认完成本节阅读", "complete");
      addButton("暂停阅读", "pause", true);
    }
  }
  render();
}

async function startLearningIntegration() {
  if (typeof document === "undefined" || typeof location === "undefined") return;
  try {
    const [workManifest, checkpointManifest, learningMap, challengeRegistry] = await Promise.all([
      readJSON("../../content/works.json"),
      readJSON("../../content/learning-checkpoints.json"),
      readJSON("../../content/learning-map.json"),
      readJSON("../../content/challenges.json"),
    ]);
    const currentPath = normalizePath(location.pathname);
    const store = createLearningProgressStore();
    const taskOrchestrator = createLearningTaskOrchestrator();
    const work = workManifest.works.find(item => normalizePath(new URL(item.href, siteRoot).pathname) === currentPath);
    if (work && work.status === "live" && work.learning?.activityTracking) {
      startLearningActivityTelemetry({ store, work });
      const topics = (learningMap.topics || []).filter(topic =>
        (work.knowledge_ids || []).includes(topic.id));
      await mountLearningTutor({
        store, taskOrchestrator, learningMap, challengeRegistry, topics, work,
        competencyIds: work.learning.competencyIds || [], siteRoot,
      });
      const assessment = work.learning.assessment;
      if (assessment?.type !== "checkpoint") return;
      const checkpoint = checkpointManifest.checkpoints.find(item => item.id === assessment.checkpointId && item.workId === work.id);
      if (!checkpoint) { console.error("[KNOWVERSE] Missing checkpoint registration for work:", work.id); return; }
      mountCheckpoint(work, checkpoint, store, taskOrchestrator);
      return;
    }

    // Promise course pages are first-class reading resources, not untracked static content.
    // Their page activity remains exploratory evidence; explicit task actions only affect execution state.
    const topic = (learningMap.topics || []).find(item => {
      const topicPath = normalizePath(new URL(item.href, siteRoot).pathname);
      return currentPath === topicPath || currentPath.startsWith(topicPath + "/");
    });
    if (!topic) return;
    const courseRoot = normalizePath(new URL(topic.href, siteRoot).pathname);
    if (!currentPath.startsWith(courseRoot)) return;
    startLearningActivityTelemetry({
      store,
      work: { id: "course:" + topic.id, title: topic.title, knowledge_ids: [topic.id] },
    });
    const competency = (topic.competencies || []).find(item => item.lessonHref &&
      normalizePath(new URL(item.lessonHref, siteRoot).pathname) === currentPath);
    await mountLearningTutor({
      store, taskOrchestrator, learningMap, challengeRegistry,
      topics: [topic], competencyIds: competency ? [competency.id] :
        (topic.competencies || []).map(item => item.id), siteRoot,
    });
    if (competency) await mountCourseReadingTask(topic, competency, store, taskOrchestrator);
  } catch (error) {
    console.error("[KNOWVERSE] Learning integration failed to initialize:", error);
  }
}
startLearningIntegration();
