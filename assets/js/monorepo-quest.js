import {
  completeStep,
  createChallengeProgressStore,
  getStepProgress,
  recordAttempt,
  revealNextHint,
  resetChallengeProgress,
  setStepData,
  summarizeChallenge,
} from "./challenge-engine.mjs";
import {
  applyBuildChoice,
  validateAffectedSelection,
  validatePackageDependency,
  validateWorkspaceProtocol,
} from "./monorepo-quest-core.mjs";
import { getReadyBuildNodes } from "./monorepo-graph-model.mjs";
import { mountMonorepoWorld } from "./monorepo-world.js";

const root = new URL("../../", import.meta.url);
const $ = id => document.getElementById(id);
const names = new Map();
const STEP = {
  protocol: "workspace-protocol",
  build: "build-order",
  affected: "affected-closure",
};

let graph;
let world;
let challenge;
let progress;
let progressStore;
let selectedNode = "contracts";
let completed = [];
let stage = 0;

function selectNode(id) {
  selectedNode = id;
  world?.select(id);
  document.querySelectorAll("[data-quest-node]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.questNode === id));
  });
}

function persistProgress() {
  const saved = progressStore?.save(progress) ?? false;
  updateDashboard(saved);
}

function updateDashboard(saved = progressStore?.available ?? false) {
  if (!progress || !challenge) return;
  const summary = summarizeChallenge(challenge, progress);
  $("quest-progress-count").textContent = summary.completedSteps + " / " + summary.totalSteps;
  $("quest-attempt-count").textContent = String(summary.attempts);
  $("quest-hint-count").textContent = String(summary.hintsUsed);
  $("quest-score-count").textContent = summary.earnedPoints + " / " + summary.maxPoints;
  $("quest-save-note").textContent = saved
    ? "进度已自动保存在本设备；重新打开页面可继续挑战。"
    : "当前浏览器未开放本地存储；本次会话仍可完整挑战，但刷新后不会保留进度。";
}

function setFeedback(id, message, kind) {
  const node = $(id);
  node.textContent = message;
  node.classList.toggle("good", kind === "good");
  node.classList.toggle("bad", kind === "bad");
}

function showStage(next) {
  stage = next;
  document.querySelectorAll("[data-quest-stage]").forEach(section => {
    section.hidden = section.dataset.questStage !== (next === 3 ? "complete" : String(next));
  });
  document.querySelectorAll("[data-progress]").forEach(item => {
    const step = challenge.steps[Number(item.dataset.progress)];
    const state = getStepProgress(progress, step.id);
    item.classList.toggle("done", state.status === "completed");
  });
  world?.setMode(next === 1 ? "build" : next === 2 ? "affected" : "dependencies");
  if (next === 3) {
    const summary = summarizeChallenge(challenge, progress);
    $("quest-final-summary").textContent =
      "三道关卡全部完成 · 得分 " + summary.earnedPoints + " / " + summary.maxPoints +
      " · 作答 " + summary.attempts + " 次 · 使用提示 " + summary.hintsUsed + " 条。";
  }
  updateDashboard();
}

function nextUnfinishedStage() {
  const index = challenge.steps.findIndex(step => getStepProgress(progress, step.id).status !== "completed");
  return index === -1 ? 3 : index;
}

function renderHint(stepId) {
  const definition = challenge.steps.find(step => step.id === stepId);
  const state = getStepProgress(progress, stepId);
  const output = $("hint-" + stepId + "-output");
  const button = $("hint-" + stepId);
  const revealed = (definition.hints || []).slice(0, state.hintsUsed);
  output.textContent = revealed.length
    ? revealed.map((hint, index) => "提示 " + (index + 1) + "： " + hint).join("\n")
    : "卡住时再展开提示。每次只揭示下一层线索，不会直接跳过推理过程。";
  const total = definition.hints?.length || 0;
  button.textContent = state.hintsUsed >= total ? "提示已全部展开" : "获取下一条提示 (" + state.hintsUsed + "/" + total + ")";
  button.disabled = state.status !== "active" || state.hintsUsed >= total;
}

function revealHint(stepId) {
  const result = revealNextHint(progress, challenge, stepId);
  if (result.exhausted) return;
  progress = result.progress;
  persistProgress();
  renderHint(stepId);
}

function updateBuildStates() {
  if (!graph) return;
  const completedSet = new Set(completed);
  const ready = new Set(getReadyBuildNodes(graph, completed).map(node => node.id));
  document.querySelectorAll("[data-build-node]").forEach(button => {
    const id = button.dataset.buildNode;
    const state = button.querySelector(".build-state");
    const node = graph.nodes.find(item => item.id === id);
    const isDone = completedSet.has(id);
    button.disabled = isDone;
    button.classList.toggle("is-done", isDone);
    button.classList.toggle("is-ready", ready.has(id));
    state.textContent = isDone ? "已构建 ✓" : ready.has(id) ? "已就绪 · 可以构建" : "等待上游依赖";
    button.setAttribute("aria-label", node.name + (isDone ? "，已构建" : ready.has(id) ? "，已就绪" : "，等待依赖"));
  });
  $("build-count").textContent = "已完成 " + completed.length + " / " + graph.nodes.length;
}

function renderBuildOptions() {
  const host = $("quest-build-list");
  host.replaceChildren();
  graph.nodes.forEach(node => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.buildNode = node.id;
    const name = document.createElement("span");
    name.className = "build-name";
    name.textContent = node.name;
    const state = document.createElement("span");
    state.className = "build-state";
    button.append(name, state);
    button.addEventListener("click", () => chooseBuildNode(node.id));
    host.append(button);
  });
  updateBuildStates();
}

function chooseBuildNode(id) {
  const result = applyBuildChoice(graph, completed, id);
  const node = graph.nodes.find(item => item.id === id);
  selectNode(id);

  if (!result.ok) {
    progress = recordAttempt(progress, STEP.build);
    const missing = result.missing.map(value => names.get(value)).join("、");
    const message = result.reason === "dependencies-not-built"
      ? "现在不能构建 " + node.name + "。请先完成上游依赖：" + missing + "。"
      : "这个节点目前不能再次构建。";
    persistProgress();
    setFeedback("build-feedback", message + " 这次错误选择已计入尝试记录。", "bad");
    return;
  }

  completed = result.completed;
  progress = setStepData(progress, STEP.build, { completedNodeIds: completed });
  updateBuildStates();

  if (result.finished) {
    progress = recordAttempt(progress, STEP.build);
    progress = completeStep(progress, challenge, STEP.build);
    persistProgress();
    setFeedback("build-feedback", "构建顺序有效：五个工作区包都在其依赖完成后构建。三层拓扑已验证。", "good");
    $("stage-build-next").hidden = false;
  } else {
    persistProgress();
    setFeedback(
      "build-feedback",
      node.name + " 已完成。" +
        (result.ready.length ? " 下一批可构建：" + result.ready.map(value => names.get(value)).join("、") + "。" : "继续检查依赖图。"),
      "good"
    );
  }
}

function renderNodeButtons() {
  const host = document.createElement("div");
  host.className = "world-node-list";
  host.setAttribute("aria-label", "工作区节点快速选择");
  graph.nodes.forEach(node => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.questNode = node.id;
    button.setAttribute("aria-pressed", String(node.id === selectedNode));
    const strong = document.createElement("strong");
    strong.textContent = node.name;
    const span = document.createElement("span");
    span.textContent = node.path;
    button.append(strong, span);
    button.addEventListener("click", () => selectNode(node.id));
    host.append(button);
  });
  document.querySelector(".quest-panel").insertBefore(host, document.querySelector("[data-quest-stage='0']"));
}

function wireChoices() {
  document.querySelectorAll("[data-protocol]").forEach(button => {
    button.addEventListener("click", () => {
      progress = recordAttempt(progress, STEP.protocol);
      const value = button.dataset.protocol;
      const protocolOK = validateWorkspaceProtocol(value);
      const dependencyOK = validatePackageDependency(graph, "web", "domain");

      if (protocolOK && dependencyOK) {
        button.classList.add("correct");
        document.querySelectorAll("[data-protocol]").forEach(item => { item.disabled = true; });
        progress = completeStep(progress, challenge, STEP.protocol);
        persistProgress();
        setFeedback(
          "protocol-feedback",
          "正确。真实 apps/web/package.json 声明了 @kv/domain: workspace:*。直接依赖应由消费者自己声明，不能依赖幽灵依赖或提升布局。",
          "good"
        );
        $("stage-protocol-next").hidden = false;
      } else {
        button.classList.add("wrong");
        persistProgress();
        setFeedback(
          "protocol-feedback",
          "还不对。请回到“消费者显式声明依赖”这个原则，再试一次。错误选择已计入尝试记录。",
          "bad"
        );
      }
    });
  });

  document.querySelectorAll("[data-affected]").forEach(button => {
    button.addEventListener("click", () => {
      progress = recordAttempt(progress, STEP.affected);
      const choices = {
        source: ["contracts"],
        core: ["contracts", "domain"],
        all: graph.build_order,
      };
      const result = validateAffectedSelection(graph, "contracts", choices[button.dataset.affected]);
      if (result.ok) {
        button.classList.add("correct");
        document.querySelectorAll("[data-affected]").forEach(item => { item.disabled = true; });
        progress = completeStep(progress, challenge, STEP.affected);
        persistProgress();
        setFeedback(
          "affected-feedback",
          "正确。contracts 改变会影响：" + result.expected.map(id => names.get(id)).join(" → ") +
            "。这是完整反向依赖闭包；具体任务是否执行仍由 task inputs、outputs 和 runner 配置决定。",
          "good"
        );
        showStage(3);
      } else {
        button.classList.add("wrong");
        persistProgress();
        setFeedback(
          "affected-feedback",
          "范围不完整。完整闭包必须包含变更包自身，并沿消费者方向递归检查每一层。错误选择已计入尝试记录。",
          "bad"
        );
      }
    });
  });

  $("build-reset").addEventListener("click", () => {
    completed = [];
    progress = setStepData(progress, STEP.build, { completedNodeIds: [] });
    persistProgress();
    updateBuildStates();
    setFeedback("build-feedback", "当前构建序列已重置。先完成 contracts，再解锁其下游包。");
  });

  $("stage-protocol-next").addEventListener("click", () => showStage(1));
  $("stage-build-next").addEventListener("click", () => showStage(2));
}

function resetQuest() {
  if (!window.confirm("确定要清空这次挑战的全部进度、提示和得分吗？")) return;
  progress = resetChallengeProgress(challenge);
  completed = [];
  document.querySelectorAll(".quest-option").forEach(button => {
    button.disabled = false;
    button.classList.remove("correct", "wrong");
  });
  $("stage-protocol-next").hidden = true;
  $("stage-build-next").hidden = true;
  setFeedback("protocol-feedback", "选择后，系统会核对真实工作区依赖。");
  setFeedback("build-feedback", "先找到没有工作区依赖的起点。");
  setFeedback("affected-feedback", "注意边的方向：消费者 → 依赖提供者；变更影响沿反方向传播。");
  $("build-reset").disabled = false;
  renderBuildOptions();
  challenge.steps.forEach(step => renderHint(step.id));
  persistProgress();
  showStage(0);
}

async function boot() {
  const [graphResponse, challengeResponse] = await Promise.all([
    fetch(new URL("data/monorepo-graph.json", root), { headers: { Accept: "application/json" } }),
    fetch(new URL("content/challenges.json", root), { headers: { Accept: "application/json" } }),
  ]);
  if (!graphResponse.ok) throw new Error("Monorepo graph HTTP " + graphResponse.status);
  if (!challengeResponse.ok) throw new Error("Challenge registry HTTP " + challengeResponse.status);

  graph = await graphResponse.json();
  const registry = await challengeResponse.json();
  challenge = registry.challenges.find(item => item.id === "monorepo-dependency-quest");
  if (!challenge || challenge.steps.length !== 3) throw new Error("Monorepo challenge definition is missing or incomplete.");

  graph.nodes.forEach(node => names.set(node.id, node.name));
  progressStore = createChallengeProgressStore();
  progress = progressStore.load(challenge);
  completed = (getStepProgress(progress, STEP.build).data.completedNodeIds || [])
    .filter(id => graph.nodes.some(node => node.id === id));

  const scene = document.querySelector("[data-world-container]");
  world = mountMonorepoWorld(scene, graph, {
    selected: selectedNode,
    onSelect(id) { selectNode(id); },
  });

  renderNodeButtons();
  renderBuildOptions();
  wireChoices();
  document.querySelectorAll("[data-hint-step]").forEach(button => {
    button.addEventListener("click", () => revealHint(button.dataset.hintStep));
  });
  $("quest-reset").addEventListener("click", resetQuest);
  $("quest-restart-complete").addEventListener("click", resetQuest);

  challenge.steps.forEach(step => renderHint(step.id));
  updateDashboard(progressStore.save(progress));
  showStage(nextUnfinishedStage());

  const notice = scene.querySelector("[data-webgl-notice]");
  if (notice) notice.textContent = world.supported
    ? "WebGL 场景已启动 · 拖动旋转"
    : "当前设备无法启动 WebGL；仍可使用右侧节点与关卡控件完成挑战";
}

boot().catch(error => {
  const feedback = $("protocol-feedback");
  if (feedback) setFeedback("protocol-feedback", "挑战初始化失败：" + error.message, "bad");
  const notice = document.querySelector("[data-webgl-notice]");
  if (notice) notice.textContent = "依赖图或挑战定义不可用";
});
