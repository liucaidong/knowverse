import { createLearningProgressStore, deriveLearningInsights } from "./learning-progress.mjs";
import { createLearningAgentProvider } from "./learning-agent/agent-provider.mjs";
import { createLearningReflectionStore } from "./learning-reflections.mjs";

const siteRoot = new URL("../../", import.meta.url);
const MAX_SELECTED_TEXT = 2000;
const RECENT_EVENTS = 8;
const MODE_LABELS = Object.freeze({
  explain: "原理讲解",
  hint: "分级提示",
  diagnose: "误区诊断",
  transfer: "迁移练习",
  socratic: "苏格拉底引导",
});
const MODE_PROMPTS = Object.freeze({
  explain: "请结合当前学习现场解释这个概念。先给直观理解，再解释关键机制，最后给一个容易混淆的边界。不要把尚未验证的内容说成已掌握。",
  hint: "我卡住了。请只给第一级提示，不要直接给答案或完整推导。先指出应该观察哪个变量、状态或因果关系，再让我继续尝试。",
  diagnose: "请根据当前学习现场和已有的相关学习证据，分析我可能存在的概念误区。区分事实与推测，指出证据不足之处，并提出一个问题来验证诊断。",
  transfer: "请围绕当前能力点提出一道新的迁移问题，不要立即给出答案。该问题只是导师生成的练习草案，不是正式评估，不得记录为掌握证据。",
  socratic: "请使用苏格拉底式教学：每轮只提出一个短问题，引导我自己解释、预测、举证或检查边界；先从我当前的想法出发，根据我的回答逐步调整难度。不要一次列出问题清单，不要直接给最终答案或完整推导；只有当我明确请求解释，或我已尝试且仍无法继续时，才逐步揭示必要提示。请先提出第一个最有诊断价值的问题。",
});
const create = (tag, className = "", text = undefined) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
};
const unique = values => [...new Set((Array.isArray(values) ? values : [])
  .filter(value => typeof value === "string" && value.trim()))];
const normalizedPath = value => {
  let path = String(value || "/");
  try { path = decodeURI(path); } catch {}
  if (path.endsWith("index.html")) path = path.slice(0, -10);
  while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path || "/";
};
const clampText = (value, max = 300) => typeof value === "string" ? value.trim().slice(0, max) : "";

function safeTaskSummary(task) {
  if (!task) return null;
  return {
    taskType: clampText(task.taskType, 40),
    title: clampText(task.title, 180),
    status: clampText(task.status, 40),
    topicId: clampText(task.topicId, 100),
    competencyId: clampText(task.competencyId, 100),
    estimatedMinutes: Number.isFinite(Number(task.estimatedMinutes))
      ? Math.max(0, Math.min(240, Number(task.estimatedMinutes))) : null,
    evidencePolicy: clampText(task.evidencePolicy, 80),
    difficultyLevel: clampText(task.difficultyLevel, 40),
  };
}

/** Build a deliberately small, read-only view of the current learning scene. */
export function buildLearningTutorScene(options = {}) {
  const {
    page = {}, topics = [], work = null, competencyIds = [], task = null,
    learningMap = {}, challengeRegistry = {}, snapshot = {}, now = new Date(),
    selectedExcerpt = "",
  } = options;
  const ids = new Set(unique(competencyIds));
  const topicRows = (Array.isArray(topics) ? topics : []).filter(Boolean);
  const allDefinitions = (learningMap.topics || []).flatMap(topic =>
    (topic.competencies || []).map(item => ({ ...item, topicId: topic.id, topicTitle: topic.title }))
  );
  if (!ids.size) {
    for (const topic of topicRows) for (const item of topic.competencies || []) ids.add(item.id);
  }
  const relevantDefinitions = allDefinitions.filter(item => ids.has(item.id));
  let insights = { competencyInsights: [], gaps: [] };
  try {
    insights = deriveLearningInsights(learningMap, challengeRegistry, snapshot, now);
  } catch {
    // The tutor remains available with registry context when historical data is unavailable.
  }
  const stateById = new Map((insights.competencyInsights || []).map(item => [item.id, item]));
  const definitionById = new Map(allDefinitions.map(item => [item.id, item]));
  const competencies = relevantDefinitions.slice(0, 12).map(definition => {
    const state = stateById.get(definition.id);
    const prerequisites = (definition.prerequisites || []).map(id => {
      const prerequisite = definitionById.get(id);
      const prerequisiteState = stateById.get(id);
      return {
        id,
        title: prerequisite?.title || id,
        status: prerequisiteState?.status || "unverified",
        statusLabel: prerequisiteState?.statusLabel || "待验证",
      };
    });
    return {
      id: definition.id,
      title: definition.title,
      description: clampText(definition.description, 500),
      topicId: definition.topicId,
      topicTitle: definition.topicTitle,
      status: state?.status || "unverified",
      statusLabel: state?.statusLabel || "待验证",
      masteryScore: Number.isFinite(state?.masteryScore) ? state.masteryScore : null,
      confidenceScore: Number.isFinite(state?.confidenceScore) ? state.confidenceScore : null,
      evidenceCount: Number(state?.evidenceCount) || 0,
      prerequisites,
      activeGaps: (state?.activeGaps || []).slice(0, 6).map(gap => ({
        id: gap.id,
        label: clampText(gap.label, 180),
        lifecycle: gap.lifecycle,
        lifecycleLabel: gap.lifecycleLabel,
        count: Number(gap.count) || 1,
        lastSeenAt: gap.lastSeenAt || null,
      })),
      lastEvidenceAt: state?.lastEvidenceAt || null,
      nextReviewAt: state?.nextReviewAt || null,
    };
  });
  const relevantIds = new Set(competencies.map(item => item.id));
  const relevantEvents = (Array.isArray(snapshot.events) ? snapshot.events : [])
    .filter(event => (event.competencyIds || []).some(id => relevantIds.has(id)) &&
      ["attempt", "completed", "assessment_passed", "hint", "hint_revealed", "review_started"].includes(event.type))
    .sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0))
    .slice(-RECENT_EVENTS)
    .map(event => ({
      type: event.type,
      at: event.at || null,
      stepTitle: clampText(event.stepTitle || event.challengeTitle || event.type, 160),
      correct: typeof event.correct === "boolean" ? event.correct : null,
      hintsUsed: Number.isFinite(Number(event.hintsUsed)) ? Number(event.hintsUsed) : 0,
      gapId: clampText(event.gapId, 100) || null,
      variantId: clampText(event.variantId, 120) || null,
      sessionType: clampText(event.sessionType, 40) || null,
    }));
  const assessment = work?.learning?.assessment || null;
  const challenge = assessment?.challengeId
    ? (challengeRegistry.challenges || []).find(item => item.id === assessment.challengeId)
    : null;
  const excerpt = clampText(selectedExcerpt, MAX_SELECTED_TEXT);
  return {
    schemaVersion: 1,
    page: {
      title: clampText(page.title, 180),
      path: normalizedPath(page.path || "/"),
    },
    topics: topicRows.slice(0, 5).map(topic => ({
      id: clampText(topic.id, 100),
      title: clampText(topic.title, 180),
    })),
    work: work ? {
      id: clampText(work.id, 120),
      title: clampText(work.title, 180),
      pillar: clampText(work.pillar || work.pillarId, 80),
      assessmentType: clampText(assessment?.type, 40) || null,
    } : null,
    currentTask: safeTaskSummary(task),
    currentChallenge: challenge ? {
      id: challenge.id,
      title: clampText(challenge.title, 180),
      relevantSteps: (challenge.steps || [])
        .filter(step => (step.competencyIds || []).some(id => relevantIds.has(id)))
        .slice(0, 8)
        .map(step => ({
          id: step.id,
          title: clampText(step.title, 160),
          competencyIds: (step.competencyIds || []).filter(id => relevantIds.has(id)),
        })),
    } : null,
    competencies,
    recentEvidence: relevantEvents,
    selectedExcerpt: excerpt || null,
    evidenceBoundary: "阅读、页面访问、任务完成、AI 对话和提示辅助不能单独证明掌握；只有正式评估与独立验证事件可以更新掌握状态。",
  };
}

function taskMatchesCurrentPage(task, options) {
  if (!task) return false;
  const currentPath = normalizedPath(options.pagePath);
  if (task.href) {
    try {
      if (normalizedPath(new URL(task.href, options.siteRoot || siteRoot).pathname) !== currentPath) return false;
    } catch { return false; }
  }
  if (options.work?.id && task.workId && task.workId !== options.work.id) return false;
  const topicIds = new Set((options.topics || []).map(topic => topic.id));
  if (task.topicId && topicIds.size && !topicIds.has(task.topicId)) return false;
  const competencies = new Set(options.competencyIds || []);
  if (task.competencyId && competencies.size && !competencies.has(task.competencyId)) return false;
  return true;
}

function injectStyles() {
  if (document.getElementById("kv-learning-tutor-style")) return;
  const style = create("style");
  style.id = "kv-learning-tutor-style";
  style.textContent = [
    ".kv-tutor-launcher{position:fixed;z-index:9001;right:18px;bottom:76px;border:1px solid #b7d9d0;border-radius:999px;padding:11px 16px;background:#17464d;color:#fff;font:750 12px/1.2 system-ui,sans-serif;box-shadow:0 8px 28px #102f3533;cursor:pointer}",
    ".kv-tutor-launcher:hover{background:#21616a}",
    ".kv-tutor-overlay{position:fixed;z-index:10001;inset:0;display:flex;justify-content:flex-end;background:#071c22a8;backdrop-filter:blur(5px)}",
    ".kv-tutor-overlay[hidden]{display:none}",
    ".kv-tutor-drawer{display:flex;flex-direction:column;width:min(480px,100%);height:100%;background:#fbfdfc;color:#203b42;box-shadow:-18px 0 60px #06191b44;font:14px/1.6 system-ui,sans-serif}",
    ".kv-tutor-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:20px 22px 15px;border-bottom:1px solid #e1ece8}",
    ".kv-tutor-kicker{color:#168477;font-size:10px;font-weight:850;letter-spacing:.13em}",
    ".kv-tutor-title{margin:4px 0 0;color:#163d43;font-size:21px;line-height:1.3}",
    ".kv-tutor-close{width:34px;height:34px;border:1px solid #d6e5e0;border-radius:50%;background:white;color:#31565c;font-size:20px;cursor:pointer}",
    ".kv-tutor-context{padding:13px 22px;border-bottom:1px solid #e1ece8;background:#f5faf8}",
    ".kv-tutor-context strong{display:block;margin-bottom:5px;color:#214950;font-size:12px}",
    ".kv-tutor-context p{margin:3px 0;color:#587176;font-size:11px;line-height:1.55}",
    ".kv-tutor-context .kv-tutor-gap{color:#9b563c}",
    ".kv-tutor-modes{display:flex;flex-wrap:wrap;gap:7px;padding:13px 22px 0}",
    ".kv-tutor-mode{border:1px solid #cfdfda;border-radius:999px;padding:7px 10px;background:white;color:#31565c;font:650 11px system-ui,sans-serif;cursor:pointer}",
    ".kv-tutor-mode:hover{border-color:#79b8aa;background:#f1f8f5}",
    ".kv-tutor-messages{flex:1;min-height:80px;overflow:auto;padding:12px 22px}",
    ".kv-tutor-message{margin:8px 0;padding:10px 12px;border-radius:12px;background:#f1f6f4;color:#315258;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}",
    ".kv-tutor-message.user{margin-left:24px;background:#e6f1ef;color:#21474d}",
    ".kv-tutor-message.assistant{margin-right:12px;background:#f4f6f2}",
    ".kv-tutor-composer{padding:14px 22px 18px;border-top:1px solid #e1ece8;background:white}",
    ".kv-tutor-input{display:block;width:100%;min-height:76px;resize:vertical;border:1px solid #cbded8;border-radius:11px;padding:10px 12px;background:#fff;color:#173d43;font:13px/1.6 system-ui,sans-serif;box-sizing:border-box}",
    ".kv-tutor-controls{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px}",
    ".kv-tutor-send,.kv-tutor-copy{border:0;border-radius:999px;padding:9px 14px;background:#17464d;color:white;font:700 11px system-ui,sans-serif;cursor:pointer}",
    ".kv-tutor-copy{border:1px solid #d2e1dc;background:#f1f6f4;color:#31565c}",
    ".kv-tutor-consent{display:flex;align-items:center;gap:7px;color:#405e62;font-size:11px}",
    ".kv-tutor-consent input{accent-color:#167b70}",
    ".kv-tutor-privacy{margin:8px 0 0;color:#718386;font-size:10px;line-height:1.5}",
    ".kv-tutor-status{min-height:18px;margin:8px 0 0;color:#60777a;font-size:11px}",
    ".kv-tutor-status.error{color:#a24a3f}",
    ".kv-tutor-selection{margin-top:8px;color:#526c70;font-size:11px}",
    ".kv-tutor-reflection{margin:10px 22px 0;border:1px solid #dce9e5;border-radius:12px;background:#f8fbfa;overflow:hidden}",
    ".kv-tutor-reflection>summary{padding:10px 12px;color:#28545a;font-size:12px;font-weight:800;cursor:pointer}",
    ".kv-tutor-reflection-body{max-height:34vh;overflow:auto;padding:0 12px 12px}",
    ".kv-tutor-reflection-intro{margin:0 0 9px;color:#718386;font-size:10px;line-height:1.6}",
    ".kv-tutor-reflection-form{display:grid;gap:8px}",
    ".kv-tutor-reflection-field{display:grid;gap:4px;color:#355b60;font-size:10px;font-weight:750}",
    ".kv-tutor-reflection-field textarea{box-sizing:border-box;width:100%;min-height:54px;resize:vertical;border:1px solid #d2e1dc;border-radius:8px;padding:8px;background:white;color:#24474d;font:11px/1.5 system-ui,sans-serif}",
    ".kv-tutor-reflection-save{justify-self:start;border:0;border-radius:999px;padding:8px 12px;background:#17464d;color:white;font:700 10px system-ui,sans-serif;cursor:pointer}",
    ".kv-tutor-reflection-status{min-height:15px;margin:6px 0;color:#60777a;font-size:10px}",
    ".kv-tutor-reflection-list{display:grid;gap:6px;margin-top:8px}",
    ".kv-tutor-reflection-item{padding:8px;border:1px solid #e1ebe7;border-radius:8px;background:white}",
    ".kv-tutor-reflection-item summary{color:#31565c;font-size:10px;font-weight:750;cursor:pointer}",
    ".kv-tutor-reflection-item p{margin:6px 0 0;color:#60777a;font-size:10px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}",
    ".kv-tutor-reflection-delete,.kv-tutor-reflection-edit,.kv-tutor-reflection-cancel{margin:6px 8px 0 0;border:0;background:transparent;color:#416d70;font:700 10px system-ui,sans-serif;cursor:pointer}",
    ".kv-tutor-reflection-delete{color:#9b6257}",
    "@media(max-width:560px){.kv-tutor-launcher{right:12px;bottom:72px}.kv-tutor-drawer{width:100%}.kv-tutor-head{padding:16px 17px 12px}.kv-tutor-context{padding:11px 17px}.kv-tutor-modes{padding:11px 17px 0}.kv-tutor-messages{padding:10px 17px}.kv-tutor-composer{padding:12px 17px 15px}.kv-tutor-title{font-size:19px}}",
  ].join("\n");
  document.head.append(style);
}

function renderSceneSummary(host, scene) {
  host.replaceChildren();
  const heading = create("strong", "", "当前学习现场");
  host.append(heading);
  host.append(create("p", "", scene.page.title || "当前知识页面"));
  if (scene.currentTask) {
    host.append(create("p", "", "计划任务：" + scene.currentTask.title + " · " + scene.currentTask.status));
  }
  if (!scene.competencies.length) {
    host.append(create("p", "", "该专题尚未建立正式能力映射；导师可以解释内容，但不会推断掌握状态。"));
    return;
  }
  scene.competencies.slice(0, 4).forEach(item => {
    host.append(create("p", "", item.title + " · " + item.statusLabel +
      (item.masteryScore === null ? "" : " · 掌握估计 " + Math.round(item.masteryScore) + "%")));
    item.activeGaps.slice(0, 2).forEach(gap => {
      const line = create("p", "kv-tutor-gap", "待修复误区：" + gap.label + " · " + gap.lifecycleLabel);
      host.append(line);
    });
  });
}

function formatTutorError(error) {
  if (error?.code === "AI_AUTH_REQUIRED") return "需要先通过 KNOWVERSE GitHub 登录，才可使用云端导师。本地上下文没有发送。";
  if (error?.code === "AI_PROVIDER_NOT_CONFIGURED") return "云端 AI Provider 尚未配置。当前页面没有改动任何学习记录。";
  if (error?.code === "ACCOUNT_NOT_AUTHORIZED") return "该 GitHub 账户尚未获准使用云端学习服务。";
  if (error?.code === "AI_TIMEOUT") return "云端导师响应超时。学习记录未受影响，可以稍后重试。";
  return "云端导师暂不可用：" + (error?.message || error?.code || "未知错误") + "。学习记录未被修改。";
}

/** Mount an opt-in tutor on a mapped course, lab, gallery or challenge page. */
export async function mountLearningTutor(options = {}) {
  if (typeof document === "undefined" || typeof location === "undefined") return null;
  if (document.getElementById("kv-learning-tutor-launcher")) return null;
  const store = options.store || createLearningProgressStore();
  const pagePath = normalizedPath(options.pagePath || location.pathname);
  const topics = Array.isArray(options.topics) ? options.topics : [];
  const competencyIds = unique(options.competencyIds);
  const taskId = new URL(location.href).searchParams.get("taskId");
  let task = null;
  let taskWarning = "";
  if (taskId && options.taskOrchestrator) {
    try {
      const candidate = await options.taskOrchestrator.get(taskId);
      if (taskMatchesCurrentPage(candidate, {
        pagePath, work: options.work, topics,
        competencyIds, siteRoot: options.siteRoot,
      })) task = candidate;
      else taskWarning = "当前 URL 中的任务标识与页面资源不匹配，已忽略该任务上下文。";
    } catch {
      taskWarning = "未能读取当前计划任务；导师仍可使用知识专题上下文。";
    }
  }
  let snapshot = { events: [] };
  if (store.available) {
    try { snapshot = await store.load(); }
    catch { taskWarning = taskWarning || "本机学习档案暂时不可读取；导师不会推断你的掌握状态。"; }
  } else {
    taskWarning = "当前浏览器不支持 IndexedDB；导师只能使用公开知识注册表上下文。";
  }
  const baseScene = buildLearningTutorScene({
    page: { title: document.title, path: pagePath },
    topics, work: options.work || null, competencyIds, task,
    learningMap: options.learningMap || {},
    challengeRegistry: options.challengeRegistry || {},
    snapshot,
  });
  injectStyles();

  const provider = options.provider || createLearningAgentProvider();
  const reflectionStore = options.reflectionStore || createLearningReflectionStore();
  const launcher = create("button", "kv-tutor-launcher", "学习导师");
  launcher.id = "kv-learning-tutor-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-haspopup", "dialog");
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", "kv-learning-tutor-overlay");
  launcher.setAttribute("data-no-learning-telemetry", "true");

  const overlay = create("div", "kv-tutor-overlay");
  overlay.id = "kv-learning-tutor-overlay";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "KNOWVERSE 当前学习现场导师");
  overlay.setAttribute("data-no-learning-telemetry", "true");
  const drawer = create("section", "kv-tutor-drawer");
  const head = create("header", "kv-tutor-head");
  const titleBlock = create("div");
  titleBlock.append(
    create("div", "kv-tutor-kicker", "CONTEXT-AWARE LEARNING TUTOR"),
    create("h2", "kv-tutor-title", "围绕当前学习现场提问"),
  );
  const close = create("button", "kv-tutor-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "关闭学习导师");
  head.append(titleBlock, close);

  const contextPanel = create("section", "kv-tutor-context");
  renderSceneSummary(contextPanel, baseScene);
  if (taskWarning) contextPanel.append(create("p", "kv-tutor-gap", taskWarning));

  const modes = create("div", "kv-tutor-modes");
  Object.entries(MODE_LABELS).forEach(([mode, label]) => {
    const button = create("button", "kv-tutor-mode", label);
    button.type = "button";
    button.addEventListener("click", () => {
      hiddenMode.value = mode;
      input.value = MODE_PROMPTS[mode];
      input.focus();
    });
    modes.append(button);
  });
  const reflectionSection = create("details", "kv-tutor-reflection");
  reflectionSection.dataset.noLearningTelemetry = "true";
  const reflectionSummary = create("summary", "", "学习反思 · 把理解变化留下来");
  const reflectionBody = create("div", "kv-tutor-reflection-body");
  const reflectionIntro = create("p", "kv-tutor-reflection-intro",
    "自愿记录，不是考试。反思只写入你的私有学习档案，不会成为掌握证据；登录并启用云同步后可随个人账户同步。");
  const reflectionForm = create("form", "kv-tutor-reflection-form");
  const reflectionFields = [
    ["initialThinking", "开始前，我原本怎么理解？", "写下刚开始时的判断、模型或解题路径…"],
    ["insightChanged", "现在，哪一点理解发生了变化？", "记录促成变化的关键证据、机制或反例…"],
    ["remainingQuestions", "还有什么不确定？", "保留还没有想通的问题，不必强行得出结论…"],
    ["transferPlan", "准备怎样在新情境中验证？", "写一个可以自己预测、解释或验证的新场景…"],
  ];
  const reflectionInputs = new Map();
  reflectionFields.forEach(([key, labelText, placeholder]) => {
    const label = create("label", "kv-tutor-reflection-field", labelText);
    const textarea = create("textarea");
    textarea.id = "kv-tutor-reflect-" + key;
    textarea.name = key;
    textarea.maxLength = 2000;
    textarea.placeholder = placeholder;
    label.append(textarea);
    reflectionInputs.set(key, textarea);
    reflectionForm.append(label);
  });
  const reflectionSave = create("button", "kv-tutor-reflection-save", "保存这次反思");
  reflectionSave.type = "submit";
  reflectionForm.append(reflectionSave);
  const reflectionCancel = create("button", "kv-tutor-reflection-cancel", "取消编辑");
  reflectionCancel.type = "button";
  reflectionCancel.hidden = true;
  reflectionForm.append(reflectionCancel);
  const reflectionStatus = create("p", "kv-tutor-reflection-status", "最多保存 2,000 字/项；只有点击保存才会写入。");
  reflectionStatus.setAttribute("role", "status");
  const reflectionList = create("div", "kv-tutor-reflection-list");
  reflectionBody.append(reflectionIntro, reflectionForm, reflectionStatus, reflectionList);
  reflectionSection.append(reflectionSummary, reflectionBody);

  const messagesHost = create("div", "kv-tutor-messages");
  messagesHost.setAttribute("aria-live", "polite");
  const composer = create("form", "kv-tutor-composer");
  const input = create("textarea", "kv-tutor-input");
  input.id = "kv-tutor-question";
  input.maxLength = 4000;
  input.required = true;
  input.placeholder = "问当前课程、实验或挑战中的一个具体问题…";
  const hiddenMode = create("input");
  hiddenMode.type = "hidden";
  hiddenMode.value = "explain";
  const consentRow = create("div", "kv-tutor-controls");
  const consentLabel = create("label", "kv-tutor-consent");
  const consent = create("input");
  consent.type = "checkbox";
  consent.id = "kv-tutor-cloud-consent";
  const consentText = create("span", "", "本轮允许发送最小学习上下文到云端 AI");
  consentLabel.append(consent, consentText);
  const send = create("button", "kv-tutor-send", "发送 ↗");
  send.type = "submit";
  consentRow.append(consentLabel, send);

  let capturedSelection = "";
  const rememberSelection = () => {
    if (overlay.hidden && !drawer.contains(document.activeElement)) {
      const selected = String(window.getSelection?.() || "").trim();
      capturedSelection = selected.slice(0, MAX_SELECTED_TEXT);
    }
  };
  document.addEventListener("selectionchange", rememberSelection);

  const selectedRow = create("label", "kv-tutor-consent kv-tutor-selection");
  const includeSelection = create("input");
  includeSelection.type = "checkbox";
  includeSelection.id = "kv-tutor-include-selection";
  selectedRow.append(includeSelection, create("span", "", "将我选中的页面文字加入本轮上下文（最多 2,000 字）"));
  const copyRow = create("div", "kv-tutor-controls");
  const copy = create("button", "kv-tutor-copy", "复制学习上下文提示");
  copy.type = "button";
  const status = create("p", "kv-tutor-status", "本地学习档案不会自动发送。页面正文也不会上传，除非你主动勾选选中文字。");
  status.setAttribute("role", "status");
  const privacy = create("p", "kv-tutor-privacy",
    "云端请求需要登录和本轮授权。每轮最多发送 6 条此前的对话消息（每条最多 1,000 字）、当前页面/任务摘要、相关能力状态和最多 8 条相关事件摘要；页面摘录只有在你单独勾选时才会附加（最多 2,000 字）。导师不能修改掌握度、误区或计划。");
  copyRow.append(copy);
  composer.append(input, consentRow, selectedRow, copyRow, status, privacy);

  drawer.append(head, contextPanel, modes, reflectionSection, messagesHost, composer);
  overlay.append(drawer);
  document.body.append(launcher, overlay);

  const messages = [];
  let sending = false;
  const pushMessage = (role, content) => {
    messages.push({ role, content: String(content || "") });
    const bubble = create("article", "kv-tutor-message " + role, content);
    messagesHost.append(bubble);
    messagesHost.scrollTop = messagesHost.scrollHeight;
  };
  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle("error", error);
  };
  const closeDrawer = () => {
    overlay.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  };
  const openDrawer = () => {
    const selected = String(window.getSelection?.() || "").trim();
    capturedSelection = selected.slice(0, MAX_SELECTED_TEXT);
    overlay.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    input.focus();
  };
  launcher.addEventListener("click", openDrawer);
  close.addEventListener("click", closeDrawer);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) closeDrawer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !overlay.hidden) closeDrawer();
  });

  copy.addEventListener("click", async () => {
    const scene = {
      ...baseScene,
      selectedExcerpt: includeSelection.checked ? capturedSelection || null : null,
    };
    const prompt = [
      "你是 KNOWVERSE 的学习导师。请围绕下面的当前学习现场提供循序渐进的解释或提示。",
      "不要直接替用户完成挑战；区分事实与推测；不要声称用户已经掌握；不要把本次对话写成评估证据。",
      "当前学习现场 JSON：",
      JSON.stringify(scene, null, 2),
      "学习者的问题：" + (input.value.trim() || "请先解释当前最重要的概念。"),
    ].join("\n");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("当前浏览器不支持剪贴板写入。");
      await navigator.clipboard.writeText(prompt);
      setStatus("已复制当前学习现场提示；没有向 KNOWVERSE 云端发送数据。");
    } catch (error) {
      setStatus(error.message || "复制失败。", true);
    }
  });

  const reflectionContext = {
    pageTitle: baseScene.page.title,
    pagePath: baseScene.page.path,
    topicId: baseScene.topics[0]?.id || null,
    competencyIds: baseScene.competencies.map(item => item.id),
    taskId: task?.taskId || null,
    taskTitle: task?.title || null,
  };
  const reflectionFieldLabels = new Map(reflectionFields.map(([key, labelText]) => [key, labelText]));
  let editingReflectionId = null;
  const resetReflectionEditor = () => {
    editingReflectionId = null;
    reflectionInputs.forEach(field => { field.value = ""; });
    reflectionSave.textContent = "保存这次反思";
    reflectionCancel.hidden = true;
  };
  reflectionCancel.addEventListener("click", resetReflectionEditor);
  const renderSavedReflections = async () => {
    reflectionList.replaceChildren();
    try {
      const rows = await reflectionStore.list({ limit: 5,
        topicId: reflectionContext.topicId,
        competencyIds: reflectionContext.competencyIds });
      if (!rows.length) {
        reflectionList.append(create("p", "kv-tutor-reflection-intro", "这里还没有反思记录。完成一次学习后，写下你的理解变化。"));
        return;
      }
      rows.forEach(item => {
        const details = create("details", "kv-tutor-reflection-item");
        const date = Number.isFinite(Date.parse(item.updatedAt))
          ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.updatedAt))
          : "日期未知";
        const summary = create("summary", "", date + " · " + (item.context?.pageTitle || "学习反思"));
        details.append(summary);
        reflectionFields.forEach(([key]) => {
          if (!item[key]) return;
          const paragraph = create("p");
          paragraph.textContent = (reflectionFieldLabels.get(key) || key) + "\n" + item[key];
          details.append(paragraph);
        });
        const edit = create("button", "kv-tutor-reflection-edit", "编辑这条反思");
        edit.type = "button";
        edit.addEventListener("click", () => {
          editingReflectionId = item.reflectionId;
          reflectionInputs.forEach((field, key) => { field.value = item[key] || ""; });
          reflectionSave.textContent = "保存修改";
          reflectionCancel.hidden = false;
          reflectionSection.open = true;
          reflectionStatus.textContent = "正在编辑这条反思；保存时会检查本地文档版本，避免覆盖其他设备的新修改。";
          reflectionInputs.get("initialThinking").focus();
        });
        details.append(edit);
        const remove = create("button", "kv-tutor-reflection-delete", "删除这条反思");
        remove.type = "button";
        remove.addEventListener("click", async () => {
          try {
            await reflectionStore.remove(item.reflectionId);
            if (editingReflectionId === item.reflectionId) resetReflectionEditor();
            reflectionStatus.textContent = "反思记录已从学习档案中删除。";
            await renderSavedReflections();
          } catch (error) {
            reflectionStatus.textContent = "删除失败：" + (error.message || "本地档案暂不可用。");
          }
        });
        details.append(remove);
        reflectionList.append(details);
      });
    } catch (error) {
      reflectionList.append(create("p", "kv-tutor-reflection-intro",
        "本机学习档案暂不可读取；当前浏览器可能不支持 IndexedDB。"));
      reflectionStatus.textContent = error.message || "反思档案读取失败。";
    }
  };
  reflectionForm.addEventListener("submit", async event => {
    event.preventDefault();
    reflectionSave.disabled = true;
    try {
      const values = Object.fromEntries([...reflectionInputs].map(([key, field]) => [key, field.value]));
      await reflectionStore.save({ ...values, reflectionId: editingReflectionId, context: reflectionContext });
      resetReflectionEditor();
      reflectionStatus.textContent = "已保存到你的私有学习档案；没有新增学习事件或掌握证据。";
      await renderSavedReflections();
    } catch (error) {
      reflectionStatus.textContent = error.message || "保存失败；当前没有写入反思记录。";
    } finally {
      reflectionSave.disabled = false;
    }
  });
  void renderSavedReflections();

  composer.addEventListener("submit", async event => {
    event.preventDefault();
    if (sending) return;
    const question = input.value.trim();
    if (!question) return;
    pushMessage("user", question);
    input.value = "";
    if (!consent.checked) {
      setStatus("本轮没有发送任何数据。勾选云端授权并登录后，才能在站内获得 AI 导师回复。", true);
      return;
    }
    if (!provider.configured) {
      consent.checked = false;
      setStatus("Supabase 云端服务尚未配置；没有发送本轮学习上下文。", true);
      return;
    }
    sending = true;
    send.disabled = true;
    setStatus("正在发送当前页面的最小学习摘要…");
    try {
      const selectedExcerpt = includeSelection.checked ? capturedSelection : "";
      const scene = { ...baseScene, selectedExcerpt: selectedExcerpt || null };
      const recentConversation = messages.slice(-7, -1).map(item => ({
        role: item.role,
        content: item.content.slice(0, 1000),
      }));
      const response = await provider.ask({
        message: question,
        mode: "tutor",
        tutorMode: MODE_LABELS[hiddenMode.value] ? hiddenMode.value : "explain",
        context: { learningScene: scene, recentConversation },
      });
      // Tutor mode is read-only. The UI intentionally ignores all tool proposals and data requests.
      pushMessage("assistant", response.reply);
      setStatus("导师已回复 · 本轮没有产生掌握证据，也没有修改学习计划。");
    } catch (error) {
      setStatus(formatTutorError(error), true);
      pushMessage("assistant", formatTutorError(error));
    } finally {
      sending = false;
      send.disabled = false;
      consent.checked = false;
    }
  });

  if (taskWarning) setStatus(taskWarning, true);
  return {
    launcher,
    overlay,
    scene: baseScene,
    get messages() { return messages.map(item => ({ ...item })); },
  };
}
