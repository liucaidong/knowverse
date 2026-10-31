(() => {
  "use strict";

  const script = document.currentScript;
  const siteRoot = new URL("../../", script.src);
  const topicCatalogs = document.querySelectorAll("[data-knowledge-catalog]");
  const pillarCatalog = document.querySelector("[data-pillar-catalog]");

  function resolveHref(href) {
    if (typeof href !== "string" || !href.startsWith("./")) return null;
    const url = new URL(href.slice(2), siteRoot);
    return url.origin === siteRoot.origin && url.pathname.startsWith(siteRoot.pathname) ? url.href : null;
  }

  function addText(parent, tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value || "";
    parent.append(node);
    return node;
  }

  function renderPillars(manifest) {
    if (!pillarCatalog) return;
    const labels = { lab: "01 / UNDERSTAND", gallery: "02 / EXPERIENCE", puzzles: "03 / APPLY" };
    const fragment = document.createDocumentFragment();
    manifest.pillars.slice().sort((a, b) => a.order - b.order).forEach(pillar => {
      const href = resolveHref(pillar.href);
      if (!href) return;
      const card = document.createElement("a");
      card.className = "pillar";
      card.style.setProperty("--glow", pillar.accent || "#199f94");
      card.href = href;
      addText(card, "span", "serial", labels[pillar.id] || pillar.id.toUpperCase());
      addText(card, "strong", "", pillar.title);
      addText(card, "p", "", pillar.description);
      addText(card, "span", "arrow", "探索产品主线 ↗");
      fragment.append(card);
    });
    if (fragment.childNodes.length) pillarCatalog.replaceChildren(fragment);
  }

  function renderTopics(manifest, mode) {
    topicCatalogs.forEach(container => {
      const selected = mode === "all" ? manifest.topics : manifest.topics.filter(topic => topic.featured);
      const fragment = document.createDocumentFragment();
      selected.forEach(topic => {
        const href = resolveHref(topic.href);
        if (!href) return;
        const card = document.createElement("a");
        card.className = "topic-card";
        card.style.setProperty("--accent", topic.accent || "#34b4a1");
        card.href = href;
        addText(card, "span", "topic-icon", "");
        addText(card, "span", "category", topic.category);
        addText(card, "h3", "", topic.title);
        addText(card, "p", "", topic.summary);
        addText(card, "span", "meta", "专题全景图 ↗");
        fragment.append(card);
      });
      if (fragment.childNodes.length) container.replaceChildren(fragment);
    });
  }

  function currentKnowledgeId(manifest) {
    const rootPath = siteRoot.pathname;
    const pathname = decodeURI(window.location.pathname);
    if (!pathname.startsWith(rootPath)) return null;
    const relative = pathname.slice(rootPath.length).replace(/index\.html$/, "").replace(/\/+$/, "");
    const match = relative.match(/^knowledge\/([^/]+)$/);
    if (!match) return null;
    return manifest.topics.some(topic => topic.id === match[1]) ? match[1] : null;
  }

  function renderRelatedExperiences(knowledge, workManifest) {
    const topicId = currentKnowledgeId(knowledge);
    if (!topicId) return;
    const related = workManifest.works.filter(work =>
      (work.status === "live" || work.status === "planned") &&
      Array.isArray(work.knowledge_ids) && work.knowledge_ids.includes(topicId)
    );
    const main = document.querySelector("main") || document.querySelector("#main");
    if (!main || document.querySelector("[data-related-experiences]")) return;

    const section = document.createElement("section");
    section.className = "knowledge-related-section";
    section.dataset.relatedExperiences = topicId;
    const heading = document.createElement("div");
    heading.className = "knowledge-related-heading";
    addText(heading, "span", "knowledge-related-kicker", "KNOWVERSE / CONNECTED EXPERIENCES");
    addText(heading, "h2", "", "从知识进入互动体验");
    addText(heading, "p", "", "这些作品已在作品注册表中明确关联到当前专题。");
    section.append(heading);

    if (related.length) {
      const grid = document.createElement("div");
      grid.className = "knowledge-related-grid";
      related.forEach(work => {
        const href = resolveHref(work.href);
        if (!href) return;
        const card = document.createElement("a");
        card.className = "knowledge-related-card";
        card.href = href;
        addText(card, "span", "knowledge-related-type", work.kind || "互动作品");
        addText(card, "strong", "", work.title);
        addText(card, "p", "", work.summary);
        addText(card, "span", "knowledge-related-cta", "进入体验 ↗");
        grid.append(card);
      });
      section.append(grid);
    } else {
      const empty = document.createElement("p");
      empty.className = "knowledge-related-empty";
      empty.textContent = "这个专题暂时还没有登记互动作品。后续作品上线时，会在这里自动建立关联。";
      section.append(empty);
    }
    main.append(section);
  }

  Promise.all([
    fetch(new URL("content/knowledge.json", siteRoot), { headers: { Accept: "application/json" } }).then(response => {
      if (!response.ok) throw new Error("knowledge.json HTTP " + response.status);
      return response.json();
    }),
    fetch(new URL("content/works.json", siteRoot), { headers: { Accept: "application/json" } }).then(response => {
      if (!response.ok) throw new Error("works.json HTTP " + response.status);
      return response.json();
    })
  ]).then(([knowledge, works]) => {
    if (!Array.isArray(knowledge.topics) || !Array.isArray(works.pillars) || !Array.isArray(works.works)) {
      throw new Error("内容注册表结构无效");
    }
    renderPillars(works);
    renderTopics(knowledge, document.querySelector('[data-knowledge-catalog="all"]') ? "all" : "featured");
    renderRelatedExperiences(knowledge, works);
  }).catch(error => {
    console.error("[KNOWVERSE] content graph unavailable:", error);
  });
})();
