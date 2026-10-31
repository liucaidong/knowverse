(() => {
  "use strict";
  const host = document.querySelector("[data-lab]");
  if (!host) return;
  const scriptUrl = document.currentScript?.src || "";
  const $ = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));

  async function loadGraphTools() {
    const baseUrl = scriptUrl || new URL("./assets/js/monorepo-labs.js", document.baseURI).href;
    const siteRoot = new URL("../../", baseUrl);
    const [response, model] = await Promise.all([
      fetch(new URL("data/monorepo-graph.json", siteRoot), { headers: { Accept: "application/json" } }),
      import(new URL("./monorepo-graph-model.mjs", baseUrl).href),
    ]);
    if (!response.ok) throw new Error("Monorepo graph HTTP " + response.status);
    return { graph: await response.json(), model };
  }

  function initGraph(graph, model) {
    const selected = () => $("package").value;
    const positions = new Map();
    graph.build_layers.forEach((layer, layerIndex) => {
      layer.forEach((id, index) => {
        positions.set(id, { x: 105 + layerIndex * 255, y: 210 + (index - (layer.length - 1) / 2) * 110 });
      });
    });

    $("package").replaceChildren();
    graph.nodes.forEach(node => {
      const option = document.createElement("option");
      option.value = node.id;
      option.textContent = node.name + " · " + node.path;
      $("package").append(option);
    });
    $("package").value = graph.nodes.find(node => node.id === "domain")?.id || graph.nodes[0].id;

    function calculate() {
      const kind = $("change-kind").value;
      const mode = $("affected-mode").value;
      const source = selected();
      const affected = kind === "root"
        ? graph.build_order.slice()
        : model.getAffectedIds(graph, source);
      const sourceNode = graph.nodes.find(node => node.id === source);
      const tasks = [];
      affected.forEach(id => {
        if (mode === "project") tasks.push(id + ":build", id + ":typecheck", id + ":test");
        else tasks.push(id + ":" + (kind === "test" ? "test" : "build"));
      });
      const reason = kind === "root"
        ? "全局配置变化：此教学模型将全部工作区项目纳入检查。"
        : kind === "test"
          ? "测试文件变化：沿真实包依赖图计算项目闭包；任务目标映射仅作教学示例。"
          : "生产源码变化：从 " + sourceNode.name + " 沿反向消费者边递归传播。";
      return { kind, mode, source, affected, tasks, reason };
    }

    function renderSvg(info) {
      const affected = new Set(info.affected);
      const nodes = new Map(graph.nodes.map(node => [node.id, node]));
      const edges = graph.edges.map(edge => {
        const consumer = positions.get(edge.consumer);
        const dependency = positions.get(edge.dependency);
        const active = affected.has(edge.consumer) && affected.has(edge.dependency);
        const c1 = consumer.x - 72;
        const c2 = dependency.x + 72;
        return '<path d="M' + c1 + " " + consumer.y +
          " C" + (c1 - 80) + " " + consumer.y + " " + (c2 + 80) + " " + dependency.y + " " + c2 + " " + dependency.y +
          '" fill="none" stroke="' + (active ? "#8cf0d5" : "#406979") +
          '" stroke-width="' + (active ? 3 : 1.7) + '" marker-end="url(#arr)" opacity="' + (active ? 1 : .62) + '"/>';
      }).join("");
      const nodeMarkup = graph.nodes.map(node => {
        const point = positions.get(node.id);
        const active = affected.has(node.id);
        const source = info.source === node.id;
        const label = node.name.replace(/^@[^/]+\//, "");
        return '<g role="button" tabindex="0" data-node="' + escape(node.id) +
          '" class="node" aria-label="选择 ' + escape(node.name) + ' 包">' +
          '<rect x="' + (point.x - 65) + '" y="' + (point.y - 38) +
          '" width="130" height="76" rx="14" fill="' + (source ? "#0d877e" : active ? "#255c5c" : "#193f4c") +
          '" stroke="' + (active ? "#a8f7d6" : "#5f8795") + '"/>' +
          '<text x="' + point.x + '" y="' + (point.y + 5) +
          '" text-anchor="middle" font-family="system-ui" font-size="15" font-weight="700" fill="#f2fffc">' +
          escape(label) + "</text></g>";
      }).join("");
      return '<svg viewBox="0 0 720 430" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="真实工作区包依赖图；箭头从消费者指向依赖提供者">' +
        '<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">' +
        '<path d="M0 0 L8 4 L0 8" fill="none" stroke="#88dec9" stroke-width="1.4"/></marker></defs>' +
        '<text x="20" y="26" fill="#b4d7dc" font-size="12">消费者 → 依赖提供者 · 高亮：当前项目级影响闭包</text>' +
        edges + nodeMarkup + "</svg>";
    }

    let evidence;
    function render() {
      evidence = calculate();
      $("graph").innerHTML = renderSvg(evidence);
      const labels = id => graph.nodes.find(node => node.id === id)?.name || id;
      $("result-projects").textContent =
        "变更来源：" + labels(evidence.source) +
        "\n受影响项目：" + evidence.affected.map(labels).join(", ") +
        "\n\n原因：" + evidence.reason;
      $("result-tasks").textContent = evidence.tasks.join("\n") +
        "\n\n合计 " + evidence.tasks.length + " 个教学任务目标";
      $("graph").querySelectorAll("[data-node]").forEach(element => {
        const choose = () => { $("package").value = element.dataset.node; render(); };
        element.addEventListener("click", choose);
        element.addEventListener("keydown", event => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); }
        });
      });
    }

    ["package", "change-kind", "affected-mode"].forEach(id => $(id).addEventListener("change", render));
    $("copy-evidence").addEventListener("click", () => {
      const content = JSON.stringify(evidence, null, 2);
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(content)
          .then(() => { $("copy-evidence").textContent = "已复制证据 ✓"; })
          .catch(() => { $("copy-evidence").textContent = "复制受限，请查看下方结果"; });
      } else $("copy-evidence").textContent = "当前浏览器无法直接复制";
    });
    render();
  }

  function initCache() {
    const cache = new Map();
    const source = $("source-ver");
    const env = $("env-mode");
    const include = $("include-env");
    function hash(value) {
      let result = 2166136261;
      for (let index = 0; index < value.length; index++) {
        result = Math.imul(result ^ value.charCodeAt(index), 16777619);
      }
      return (result >>> 0).toString(16).padStart(8, "0");
    }
    function run() {
      const inputs = { source: source.value, task: "build", toolchain: "teaching-v1" };
      if (include.checked) inputs.MODE = env.value;
      const key = hash(JSON.stringify(inputs));
      let record = cache.get(key);
      const status = record ? "HIT" : "MISS";
      if (!record) {
        record = { artifact: "artifact(" + source.value + ", MODE=" + env.value + ")", mode: env.value, source: source.value };
        cache.set(key, record);
      }
      const expected = "artifact(" + source.value + ", MODE=" + env.value + ")";
      $("cache-inputs").textContent = JSON.stringify(inputs, null, 2) + "\nKEY=" + key + "\nCACHE SIZE=" + cache.size;
      $("cache-result").textContent = "缓存：" + status + "\n恢复产物：" + record.artifact +
        "\n正确应为：" + expected + "\n结论：" +
        (record.artifact === expected ? "✓ 产物与当前输入匹配" : "✕ 错误命中：环境输入被遗漏");
    }
    $("run-cache").addEventListener("click", run);
    $("clear-cache").addEventListener("click", () => {
      cache.clear();
      $("cache-inputs").textContent = "缓存已清空";
      $("cache-result").textContent = "缓存为空。重新运行 build。";
    });
    $("cache-inputs").textContent =
      "勾选 MODE 纳入缓存键，执行 alpha；取消勾选后清空缓存，再执行 alpha → beta，观察错误命中。";
  }

  async function initBuild() {
    const { graph } = await loadGraphTools();
    const layers = graph.build_layers;
    let position = 0;

    function render() {
      const host = $("build-steps");
      host.replaceChildren();
      layers.forEach((layer, index) => {
        const card = document.createElement("section");
        card.className = "lab-step" + (index === position ? " current" : "");
        if (index > position) card.style.opacity = ".35";
        const title = document.createElement("strong");
        title.textContent = "Layer " + index + " · " + layer.map(id => graph.nodes.find(node => node.id === id).name).join(" + ");
        card.append(title);
        if (index <= position) {
          const detail = document.createElement("p");
          detail.textContent = index === 0
            ? "起始包没有本地工作区依赖，可以先生成其声明与运行时产物。"
            : "本层项目的工作区依赖已经在前序层完成。" +
              (layer.length > 1 ? " 同一层没有彼此依赖，可以并行处理。" : "");
          card.append(detail);
        }
        host.append(card);
      });
      const current = layers[position] || [];
      const names = current.map(id => graph.nodes.find(node => node.id === id).name);
      $("build-evidence").textContent = "当前构建层：" + names.join(" + ") +
        "\n依赖前置层：" + (position ? layers.slice(0, position).flat().join(" → ") : "无") +
        "\n构建顺序：" + graph.build_order.map(id => graph.nodes.find(node => node.id === id).name).join(" → ") +
        "\n\n说明：同层包之间无依赖，可以并行；完整实际构建由参考工程中的 pnpm build / tsc -b 执行。";
      $("build-next").disabled = position === layers.length - 1;
      $("build-next").textContent = position === layers.length - 1 ? "已到最后一层" : "下一层 →";
    }

    $("build-next").addEventListener("click", () => { if (position < layers.length - 1) position++; render(); });
    $("build-reset").addEventListener("click", () => { position = 0; render(); });
    render();
  }

  if (host.dataset.lab === "graph") {
    loadGraphTools().then(({ graph, model }) => initGraph(graph, model)).catch(error => {
      $("graph").textContent = "真实工作区依赖图加载失败：" + error.message;
    });
  } else if (host.dataset.lab === "cache") {
    initCache();
  } else if (host.dataset.lab === "build") {
    initBuild().catch(error => { $("build-evidence").textContent = "工作区构建图加载失败：" + error.message; });
  }
})();
