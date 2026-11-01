import { createLearningProgressStore } from "./learning-progress.mjs";
import { createLearningCheckpointEngine } from "./learning-checkpoint-engine.mjs";
import { startLearningActivityTelemetry } from "./learning-activity.mjs";

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
function mountCheckpoint(work, checkpoint, store) {
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
      button.addEventListener("click", () => {
        for (const item of options.querySelectorAll("button")) item.disabled = true;
        try {
          const result = engine.submit(activeSession.sessionId, option.id);
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
          content.append(create("div", "kv-li-feedback bad", error.message || "保存失败，请检查浏览器本地存储。"));
        }
      });
      options.append(button);
    }
    content.append(options);
  }

  launcher.addEventListener("click", () => {
    if (!store.available) {
      overlay.hidden = false;
      content.replaceChildren(create("div", "kv-li-feedback bad", "当前浏览器未开放本地存储，无法保存检查结果。"));
      return;
    }
    try {
      activeSession = engine.start(checkpoint.id);
      renderQuestion();
      overlay.hidden = false;
      close.focus();
    } catch (error) {
      overlay.hidden = false;
      content.replaceChildren(create("div", "kv-li-feedback bad", error.message || "暂时无法开始检查。"));
    }
  });
}
async function startLearningIntegration() {
  if (typeof document === "undefined" || typeof location === "undefined") return;
  try {
    const [workManifest, checkpointManifest] = await Promise.all([
      readJSON("../../content/works.json"),
      readJSON("../../content/learning-checkpoints.json")
    ]);
    const currentPath = normalizePath(location.pathname);
    const work = workManifest.works.find(item => normalizePath(new URL(item.href, siteRoot).pathname) === currentPath);
    if (!work || work.status !== "live" || !work.learning?.activityTracking) return;
    const store = createLearningProgressStore();
    startLearningActivityTelemetry({ store, work });
    const assessment = work.learning.assessment;
    if (assessment?.type !== "checkpoint") return;
    const checkpoint = checkpointManifest.checkpoints.find(item => item.id === assessment.checkpointId && item.workId === work.id);
    if (!checkpoint) { console.error("[KNOWVERSE] Missing checkpoint registration for work:", work.id); return; }
    mountCheckpoint(work, checkpoint, store);
  } catch (error) {
    console.error("[KNOWVERSE] Learning integration failed to initialize:", error);
  }
}
startLearningIntegration();
