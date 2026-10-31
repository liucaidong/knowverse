import { getAffectedIds } from "./monorepo-graph-model.mjs";
import { mountMonorepoWorld } from "./monorepo-world.js";

const root = new URL("../../", import.meta.url);
const $ = id => document.getElementById(id);
const nameOf = node => node ? node.name : "未知节点";

function renderSelection(graph, node, mode) {
  if (!node) return;
  $("world-node-path").textContent = node.path.toUpperCase() + " / " + node.kind.toUpperCase();
  $("world-node-name").textContent = node.name;
  $("world-node-summary").textContent = node.kind === "package"
    ? "共享基础包。应用通过显式 workspace 依赖消费其公开 API。"
    : "应用入口。依赖共享包，而不是跨应用直接引用源码。";
  const consumers = graph.edges.filter(edge => edge.dependency === node.id).map(edge => edge.consumer);
  $("world-node-deps").textContent = node.dependencies.length
    ? node.dependencies.map(id => nameOf(graph.nodes.find(item => item.id === id))).join(" · ")
    : "无工作区依赖";
  $("world-node-consumers").textContent = consumers.length
    ? consumers.map(id => nameOf(graph.nodes.find(item => item.id === id))).join(" · ")
    : "无下游消费者";

  $("world-plan-title").textContent = mode === "affected"
    ? "当前变更的反向依赖闭包"
    : mode === "build" ? "构建分层 / 可并行批次" : "真实工程构建分层";
  const list = $("world-plan-list");
  list.replaceChildren();
  const plan = mode === "affected"
    ? getAffectedIds(graph, node.id).map(id => "受影响 · " + nameOf(graph.nodes.find(item => item.id === id)))
    : graph.build_layers.map((layer, index) =>
      "Layer " + index + " · " + layer.map(id => nameOf(graph.nodes.find(item => item.id === id))).join(" + ")
    );
  plan.forEach(label => {
    const item = document.createElement("li");
    item.textContent = label;
    list.append(item);
  });
}

async function boot() {
  const response = await fetch(new URL("data/monorepo-graph.json", root), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Monorepo graph HTTP " + response.status);
  const graph = await response.json();
  const stage = document.querySelector("[data-world-container]");
  let selected = graph.nodes.find(node => node.id === "domain") || graph.nodes[0];
  let mode = "dependencies";
  let world;

  world = mountMonorepoWorld(stage, graph, {
    selected: selected.id,
    mode,
    onSelect(id) {
      selected = graph.nodes.find(node => node.id === id) || selected;
      world.select(id);
      renderSelection(graph, selected, mode);
      syncNodeButtons();
    },
  });

  function syncNodeButtons() {
    document.querySelectorAll("[data-world-node]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.worldNode === selected.id));
    });
  }

  const buttons = $("world-node-list");
  graph.nodes.forEach(node => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.worldNode = node.id;
    const strong = document.createElement("strong");
    strong.textContent = node.name;
    const span = document.createElement("span");
    span.textContent = node.path;
    button.append(strong, span);
    button.addEventListener("click", () => {
      selected = node;
      world.select(node.id);
      renderSelection(graph, selected, mode);
      syncNodeButtons();
    });
    buttons.append(button);
  });

  document.querySelectorAll("[data-world-mode]").forEach(button => {
    button.addEventListener("click", () => {
      mode = button.dataset.worldMode;
      world.setMode(mode);
      document.querySelectorAll("[data-world-mode]").forEach(item => {
        item.setAttribute("aria-pressed", String(item === button));
      });
      renderSelection(graph, selected, mode);
    });
  });

  renderSelection(graph, selected, mode);
  syncNodeButtons();
  const notice = stage.querySelector("[data-webgl-notice]");
  if (notice) notice.textContent = world.supported
    ? "WebGL 已启动 · 轻拖旋转空间"
    : "当前设备无法启动 WebGL；请使用右侧结构列表继续探索";
  window.addEventListener("pagehide", () => world.destroy(), { once: true });
}

boot().catch(error => {
  $("world-node-name").textContent = "工作区数据不可用";
  $("world-node-summary").textContent = error.message + "。请返回知识专题查看静态工程说明。";
  const notice = document.querySelector("[data-webgl-notice]");
  if (notice) notice.textContent = "场景数据加载失败";
});
