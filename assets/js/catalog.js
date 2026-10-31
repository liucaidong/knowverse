(() => {
  "use strict";

  const grid = document.querySelector("[data-catalog]");
  if (!grid) return;

  const siteRoot = new URL(document.body.dataset.root || "./", document.baseURI);
  const fixedPillar = grid.dataset.pillar || "";
  const requestedPillar = new URLSearchParams(window.location.search).get("pillar") || "all";
  const filter = document.querySelector("[data-filter]");
  const search = document.querySelector("[data-work-search]");
  const count = document.querySelector("[data-count]");
  const kindLabels = {
    experiment: "交互实验",
    exhibition: "沉浸展览",
    puzzle: "机制解谜",
    game: "3D 游戏"
  };
  let workManifest = null;
  let knowledgeManifest = null;
  let activePillar = fixedPillar || requestedPillar;

  function showMessage(message) {
    const node = document.createElement("p");
    node.className = "catalog-message";
    node.textContent = message;
    grid.replaceChildren(node);
  }

  function safeHref(href) {
    if (typeof href !== "string" || !href.startsWith("./")) return null;
    const url = new URL(href.slice(2), siteRoot);
    return url.origin === siteRoot.origin && url.pathname.startsWith(siteRoot.pathname) ? url.href : null;
  }

  function createCard(work, pillar, topicsById) {
    const workHref = safeHref(work.href);
    if (!workHref) return null;

    const card = document.createElement("article");
    card.className = "work-card";
    const mainLink = document.createElement("a");
    mainLink.className = "work-card-main";
    mainLink.href = workHref;

    const meta = document.createElement("div");
    meta.className = "work-card-meta";
    const kind = document.createElement("span");
    kind.className = "work-kind";
    kind.textContent = kindLabels[work.kind] || work.kind || "互动作品";
    const level = document.createElement("span");
    level.className = "work-level";
    level.textContent = work.level || "未标注难度";

    const title = document.createElement("h3");
    title.textContent = work.title || "未命名作品";
    const summary = document.createElement("p");
    summary.textContent = work.summary || "";
    const footer = document.createElement("div");
    footer.className = "work-card-footer";
    const subject = document.createElement("span");
    subject.textContent = [work.subject, pillar && pillar.title].filter(Boolean).join(" · ");
    const enter = document.createElement("strong");
    enter.textContent = "进入体验 ↗";

    meta.append(kind, level);
    footer.append(subject, enter);
    mainLink.append(meta, title, summary, footer);
    card.append(mainLink);

    const relatedTopics = (work.knowledge_ids || [])
      .map(id => topicsById.get(id))
      .filter(Boolean);
    if (relatedTopics.length) {
      const relation = document.createElement("div");
      relation.className = "work-related-topics";
      const label = document.createElement("span");
      label.className = "work-related-label";
      label.textContent = "关联专题";
      relation.append(label);
      relatedTopics.forEach(topic => {
        const href = safeHref(topic.href);
        if (!href) return;
        const link = document.createElement("a");
        link.className = "work-topic-chip";
        link.href = href;
        link.textContent = topic.short_title || topic.title;
        link.setAttribute("aria-label", "查看知识专题：" + topic.title);
        relation.append(link);
      });
      card.append(relation);
    }
    return card;
  }

  function syncFilters() {
    if (!filter) return;
    filter.querySelectorAll("[data-pillar]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.pillar === activePillar));
    });
    filter.hidden = Boolean(fixedPillar);
  }

  function render() {
    if (!workManifest || !knowledgeManifest) return;
    const query = (search?.value || "").trim().toLocaleLowerCase();
    const pillarMap = new Map(workManifest.pillars.map(pillar => [pillar.id, pillar]));
    const topicsById = new Map(knowledgeManifest.topics.map(topic => [topic.id, topic]));
    const available = workManifest.works.filter(work =>
      (activePillar === "all" || work.pillar === activePillar) &&
      (work.status === "live" || work.status === "planned")
    );
    const visible = available.filter(work => {
      if (!query) return true;
      const relatedNames = (work.knowledge_ids || [])
        .map(id => topicsById.get(id)?.title || "")
        .join(" ");
      const haystack = [
        work.title, work.summary, work.subject, work.level, work.kind,
        pillarMap.get(work.pillar)?.title, relatedNames
      ].filter(Boolean).join(" ").toLocaleLowerCase();
      return haystack.includes(query);
    });

    const fragment = document.createDocumentFragment();
    visible.forEach(work => {
      const card = createCard(work, pillarMap.get(work.pillar), topicsById);
      if (card) fragment.append(card);
    });
    grid.replaceChildren(fragment);
    if (!grid.children.length) showMessage("没有找到符合条件的作品。试试更短的关键词，或切换产品主线。");
    if (count) count.textContent = query
      ? "找到 " + visible.length + " / " + available.length + " 件作品"
      : "共 " + available.length + " 件作品";
    grid.setAttribute("aria-busy", "false");
  }

  filter?.addEventListener("click", event => {
    const button = event.target.closest("[data-pillar]");
    if (!button || !filter.contains(button)) return;
    activePillar = button.dataset.pillar;
    syncFilters();
    render();
  });
  search?.addEventListener("input", render);

  Promise.all([
    fetch(new URL("content/works.json", siteRoot), { headers: { Accept: "application/json" } }).then(response => {
      if (!response.ok) throw new Error("works.json HTTP " + response.status);
      return response.json();
    }),
    fetch(new URL("content/knowledge.json", siteRoot), { headers: { Accept: "application/json" } }).then(response => {
      if (!response.ok) throw new Error("knowledge.json HTTP " + response.status);
      return response.json();
    })
  ]).then(([works, knowledge]) => {
    if (!Array.isArray(works.pillars) || !Array.isArray(works.works) || !Array.isArray(knowledge.topics)) {
      throw new Error("内容注册表格式不正确");
    }
    workManifest = works;
    knowledgeManifest = knowledge;
    if (fixedPillar && !workManifest.pillars.some(pillar => pillar.id === fixedPillar)) {
      throw new Error("未知的产品主线");
    }
    if (!fixedPillar && activePillar !== "all" && !workManifest.pillars.some(pillar => pillar.id === activePillar)) {
      activePillar = "all";
    }
    syncFilters();
    render();
  }).catch(error => {
    grid.setAttribute("aria-busy", "false");
    showMessage("作品目录加载失败（" + error.message + "）。请刷新页面，或从知识库导航继续浏览。");
    if (count) count.textContent = "目录暂不可用";
  });
})();
