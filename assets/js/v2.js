(() => {
  "use strict";
  const overlay = document.getElementById("search-overlay");
  const openButton = document.getElementById("search-open");
  const closeButton = document.getElementById("search-close");
  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");
  const base = document.body.dataset.root || "./";
  let index = null;

  import(new URL("assets/js/learning-activity.mjs", new URL(base, location.href)).href)
    .catch(error => console.warn("[KNOWVERSE] learning activity telemetry unavailable:", error));

  import(new URL("assets/js/backend/archive-bootstrap.mjs", new URL(base, location.href)).href)
    .then(module => module.startArchiveBootstrap())
    .catch(error => console.warn("[KNOWVERSE] local learning archive unavailable:", error));

  const nav = document.querySelector(".navlinks");
  if (nav && !nav.querySelector('[data-learning-progress-link]')) {
    const link = document.createElement("a");
    link.href = base + "progress/";
    link.textContent = "学习进度";
    link.dataset.learningProgressLink = "true";
    nav.append(link);
  }
  if (nav && !nav.querySelector('[data-review-workspace-link]')) {
    const link = document.createElement("a");
    link.href = base + "review/";
    link.textContent = "复习工作台";
    link.dataset.reviewWorkspaceLink = "true";
    nav.append(link);
  }

  function showSearch() {
    if (!overlay) return;
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    input?.focus();
    if (index === null) {
      fetch(base + "data/search.json").then(response => response.json()).then(data => {
        index = data;
        search();
      }).catch(() => {
        if (results) results.textContent = "索引暂时不可用，请通过专题导航浏览。";
      });
    }
  }

  function hideSearch() {
    overlay?.classList.remove("open");
    overlay?.setAttribute("aria-hidden", "true");
    openButton?.focus();
  }

  function search() {
    if (!index || !input || !results) return;
    const query = input.value.trim().toLowerCase();
    const words = query.split(/\s+/).filter(Boolean);
    const found = index.filter(item =>
      words.every(word => (item.title + " " + item.summary + " " + item.tags + " " + item.body).toLowerCase().includes(word))
    ).slice(0, 50);
    results.textContent = "";
    if (!found.length) {
      results.textContent = "未找到匹配内容。试试 Promise、Monorepo、数据库、GPU、东北话等关键词。";
      return;
    }
    for (const item of found) {
      const anchor = document.createElement("a");
      anchor.className = "hit";
      anchor.href = base + item.href;
      const title = document.createElement("strong");
      title.textContent = item.title;
      const summary = document.createElement("span");
      summary.textContent = item.topic + " · " + item.summary;
      anchor.append(title, summary);
      results.append(anchor);
    }
  }

  openButton?.addEventListener("click", showSearch);
  closeButton?.addEventListener("click", hideSearch);
  input?.addEventListener("input", search);
  overlay?.addEventListener("click", event => {
    if (event.target === overlay) hideSearch();
  });
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      showSearch();
    }
    if (event.key === "Escape") hideSearch();
  });
  document.getElementById("mobile-menu")?.addEventListener("click", () => {
    document.querySelector(".navlinks")?.classList.toggle("open");
  });

  const diagrams = [...document.querySelectorAll(".mermaid")];
  if (diagrams.length) {
    import("https://cdn.jsdelivr.net/npm/mermaid@12/dist/mermaid.esm.min.mjs").then(module => {
      module.default.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "neutral",
        flowchart: { htmlLabels: false, useMaxWidth: true }
      });
      return module.default.run({ nodes: diagrams });
    }).catch(() => {
      for (const diagram of diagrams) {
        diagram.classList.add("mermaid-fallback");
        diagram.title = "离线状态保留 Mermaid 源码；专题全景图使用本地 SVG 可正常查看。";
      }
    });
  }
})();
