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
let graph;
let world;
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

function showStage(next) {
  stage = next;
  document.querySelectorAll("[data-quest-stage]").forEach(section => {
    section.hidden = section.dataset.questStage !== (next === 3 ? "complete" : String(next));
  });
  document.querySelectorAll("[data-progress]").forEach(item => {
    const index = Number(item.dataset.progress);
    item.classList.toggle("done", index < next || next === 3);
  });
  world?.setMode(next === 1 ? "build" : next === 2 ? "affected" : "dependencies");
}

function setFeedback(id, message, kind) {
  const node = $(id);
  node.textContent = message;
  node.classList.toggle("good", kind === "good");
  node.classList.toggle("bad", kind === "bad");
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

function updateBuildStates() {
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

function chooseBuildNode(id) {
  const result = applyBuildChoice(graph, completed, id);
  const node = graph.nodes.find(item => item.id === id);
  selectNode(id);
  if (!result.ok) {
    const missing = result.missing.map(value => names.get(value)).join("、");
    const message = result.reason === "dependencies-not-built"
      ? "现在不能构建 " + node.name + "。请先完成上游依赖：" + missing + "。"
      : "这个节点目前不能再次构建。";
    setFeedback("build-feedback", message, "bad");
    return;
  }
  completed = result.completed;
  setFeedback(
    "build-feedback",
    "构建顺序有效：" + node.name + " 已就绪。" +
      (result.ready.length ? " 下一批可选：" + result.ready.map(value => names.get(value)).join("、") : " 所有节点已完成。"),
    "good"
  );
  updateBuildStates();
  if (result.finished) {
    setFeedback("build-feedback", "五个工作区包均在其依赖完成后构建。构建图已验证。", "good");
    window.setTimeout(() => showStage(2), 650);
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
      const value = button.dataset.protocol;
      const protocolOK = validateWorkspaceProtocol(value);
      const dependencyOK = validatePackageDependency(graph, "web", "domain");
      if (protocolOK && dependencyOK) {
        button.classList.add("correct");
        document.querySelectorAll("[data-protocol]").forEach(item => { item.disabled = true; });
        setFeedback("protocol-feedback", "正确。真实 apps/web/package.json 声明了 @kv/domain: workspace:*。直接依赖应由消费者自己声明，不能依赖幽灵依赖或提升布局。", "good");
        window.setTimeout(() => { completed = []; renderBuildOptions(); showStage(1); }, 700);
      } else {
        button.classList.add("wrong");
        setFeedback("protocol-feedback", "还不对。问题要求的是明确的工作区链接协议，不是普通 semver、相对源码路径或依赖提升。", "bad");
      }
    });
  });

  document.querySelectorAll("[data-affected]").forEach(button => {
    button.addEventListener("click", () => {
      const choices = {
        source: ["contracts"],
        core: ["contracts", "domain"],
        all: graph.build_order,
      };
      const result = validateAffectedSelection(graph, "contracts", choices[button.dataset.affected]);
      if (result.ok) {
        button.classList.add("correct");
        document.querySelectorAll("[data-affected]").forEach(item => { item.disabled = true; });
        setFeedback(
          "affected-feedback",
          "正确。contracts 改变会影响：" + result.expected.map(id => names.get(id)).join(" → ") +
            "。这验证了完整反向依赖闭包；具体任务是否执行仍由 task inputs、outputs 和 runner 配置决定。",
          "good"
        );
        window.setTimeout(() => showStage(3), 650);
      } else {
        button.classList.add("wrong");
        setFeedback("affected-feedback", "范围不完整。完整闭包必须包含变更包自身，并沿消费者方向递归检查每一层依赖。", "bad");
      }
    });
  });

  $("build-reset").addEventListener("click", () => {
    completed = [];
    updateBuildStates();
    setFeedback("build-feedback", "构建序列已重置。先完成 contracts，再解锁其下游包。");
  });
}

async function boot() {
  const response = await fetch(new URL("data/monorepo-graph.json", root), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Monorepo graph HTTP " + response.status);
  graph = await response.json();
  graph.nodes.forEach(node => names.set(node.id, node.name));

  const scene = document.querySelector("[data-world-container]");
  world = mountMonorepoWorld(scene, graph, {
    selected: selectedNode,
    onSelect(id) { selectNode(id); },
  });
  renderNodeButtons();
  wireChoices();
  const notice = scene.querySelector("[data-webgl-notice]");
  if (notice) notice.textContent = world.supported
    ? "WebGL 场景已启动 · 拖动旋转"
    : "当前设备无法启动 WebGL；仍可使用右侧节点与关卡控件完成挑战";
}

boot().catch(error => {
  setFeedback("protocol-feedback", "挑战数据加载失败：" + error.message, "bad");
  const notice = document.querySelector("[data-webgl-notice]");
  if (notice) notice.textContent = "依赖图数据不可用";
});
