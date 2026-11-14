const create = (tag, className, value) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
};

function safeHref(href, root) {
  if (typeof href !== "string" || !href) return null;
  const url = new URL(href.replace(/^\.\//, ""), root);
  return url.origin === root.origin && url.pathname.startsWith(root.pathname) ? url.href : null;
}

function normalizedPath(pathname) {
  return pathname.replace(/index\.html$/, "").replace(/\/+$/, "") + "/";
}

function addLink(parent, label, href, root, className = "") {
  const url = safeHref(href, root);
  if (!url) return null;
  const anchor = create("a", className, label);
  anchor.href = url;
  parent.append(anchor);
  return anchor;
}

function insertAfterPageHead(section) {
  const pageHead = document.querySelector("main .pagehead");
  const main = document.querySelector("main");
  if (!main) return;
  if (pageHead) pageHead.insertAdjacentElement("afterend", section);
  else {
    const breadcrumb = main.querySelector(".breadcrumbs");
    if (breadcrumb) {
      breadcrumb.insertAdjacentElement("afterend", section);
      return;
    }
    const hero = main.querySelector(".hero");
    if (hero) hero.insertAdjacentElement("afterend", section);
    else main.prepend(section);
  }
}

function renderCompetencies(container, mapTopic) {
  const competencies = mapTopic?.competencies || [];
  if (!competencies.length) {
    container.append(create("p", "kv-context-note",
      "本专题尚未建立正式的能力点先修图谱。当前只展示已登记的内容与互动作品关系，不把文章排列顺序误当作因果或必修顺序。"));
    return;
  }
  const title = create("h3", "kv-context-subtitle", "能力点与前置关系");
  container.append(title);
  const byId = new Map(competencies.map(item => [item.id, item]));
  const list = create("ol", "kv-competency-list");
  competencies.forEach((item, index) => {
    const card = create("li", "kv-competency-item");
    card.append(create("span", "kv-competency-index", String(index + 1).padStart(2, "0")));
    const body = create("div", "kv-competency-body");
    body.append(create("strong", "", item.title));
    const prerequisiteNames = (item.prerequisites || []).map(id => byId.get(id)?.title || id);
    body.append(create("small", "", prerequisiteNames.length
      ? "前置能力：" + prerequisiteNames.join("、")
      : "起点能力 · 无先修门槛"));
    card.append(body);
    list.append(card);
  });
  container.append(list);
}

function renderTopicPage(topic, records, works, mapTopic, root) {
  const section = create("section", "kv-topic-context");
  section.dataset.kvTopicContext = topic.id;
  const head = create("div", "kv-topic-context-head");
  const copy = create("div");
  copy.append(create("span", "kv-topic-context-kicker", "KNOWLEDGE DOMAIN / " + topic.category));
  copy.append(create("h2", "", "当前专题：" + topic.title));
  copy.append(create("p", "", topic.summary || "从这里进入本专题的文章、能力点和互动体验。"));
  copy.append(create("span", "kv-topic-context-location", "专题是知识归属；原理实验室、展厅和解谜是体验方式，两者不会互相替代。"));
  head.append(copy);
  addLink(head, "返回全部知识专题 ↗", "knowledge/", root, "kv-topic-back");
  section.append(head);

  const content = create("div", "kv-topic-context-grid");
  const learning = create("section", "kv-context-panel");
  learning.append(create("span", "kv-context-kicker", "LEARNING STRUCTURE"));
  renderCompetencies(learning, mapTopic);
  if (mapTopic?.competencies?.length) {
    const prerequisiteEdges = mapTopic.competencies.reduce((sum, item) => sum + (item.prerequisites?.length || 0), 0);
    learning.append(create("p", "kv-context-meta", mapTopic.competencies.length + " 个能力点 · " + prerequisiteEdges + " 条明确先修关系"));
    addLink(learning, "在学习驾驶舱查看掌握证据 ↗", "progress/#knowledge-map", root, "kv-context-action");
  }
  content.append(learning);

  const articlePanel = create("section", "kv-context-panel");
  articlePanel.append(create("span", "kv-context-kicker", "CANONICAL CONTENT"));
  articlePanel.append(create("h3", "kv-context-subtitle", "本专题内容入口"));
  articlePanel.append(create("p", "kv-context-note", "文章是专题下的具体知识单元；这里提供入口，不在其他页面复制正文。"));
  const articleList = create("ul", "kv-context-link-list");
  records.slice(0, 8).forEach(record => {
    const li = create("li");
    addLink(li, record.title, record.href, root);
    articleList.append(li);
  });
  if (!records.length) articleList.append(create("li", "", "暂无单独登记的文章索引。"));
  articlePanel.append(articleList);
  if (records.length > 8) articlePanel.append(create("small", "kv-context-meta", "另有 " + (records.length - 8) + " 条相关索引，可通过全站搜索继续查找。"));
  content.append(articlePanel);
  section.append(content);

  const related = create("section", "kv-topic-works");
  related.append(create("div", "kv-topic-works-head", "关联互动体验"));
  related.append(create("p", "kv-context-note", "同一专题可以同时进入实验、展览和解谜；作品通过 knowledge_ids 反向关联，不复制知识内容。"));
  const pillarInfo = [
    { id: "lab", label: "01 · 原理实验室", href: "lab/" },
    { id: "gallery", label: "02 · 沉浸展厅", href: "gallery/" },
    { id: "puzzles", label: "03 · 知识解谜", href: "puzzles/" },
  ];
  const groups = create("div", "kv-topic-work-groups");
  pillarInfo.forEach(pillar => {
    const group = create("div", "kv-topic-work-group");
    group.append(create("strong", "", pillar.label));
    const matching = works.filter(work => work.pillar === pillar.id);
    if (!matching.length) group.append(create("small", "", "暂无关联作品"));
    matching.forEach(work => addLink(group, work.title, work.href, root, "kv-topic-work-link"));
    groups.append(group);
  });
  related.append(groups);
  section.append(related);
  insertAfterPageHead(section);
}

function renderArticleContext(topic, records, works, mapTopic, currentPath, root) {
  const section = create("section", "kv-article-context");
  const top = create("div", "kv-article-context-top");
  top.append(create("span", "kv-context-kicker", "YOU ARE HERE"));
  top.append(create("strong", "", topic.title));
  addLink(top, "打开专题全景图 ↗", "knowledge/" + topic.id + "/", root, "kv-context-action");
  section.append(top);
  const meta = create("p", "kv-article-context-meta");
  const skills = mapTopic?.competencies?.length || 0;
  const edgeCount = (mapTopic?.competencies || []).reduce((sum, item) => sum + (item.prerequisites?.length || 0), 0);
  meta.textContent = skills
    ? "本专题已定义 " + skills + " 个能力点和 " + edgeCount + " 条先修关系／个人掌握证据在学习驾驶舱统一记录。"
    : "本专题当前通过文章索引和作品注册表组织内容；尚未定义正式的能力点先修关系。";
  section.append(meta);
  const details = create("details", "kv-article-context-details");
  const summary = create("summary", "", "展开本专题相关内容与体验入口");
  details.append(summary);
  const list = create("div", "kv-article-context-links");
  const siblingRecords = records.filter(record => {
    const href = safeHref(record.href, root);
    return href && normalizedPath(new URL(href).pathname) !== normalizedPath(currentPath);
  }).slice(0, 5);
  if (siblingRecords.length) {
    const articleLinks = create("div", "kv-article-context-column");
    articleLinks.append(create("strong", "", "同专题内容"));
    siblingRecords.forEach(record => addLink(articleLinks, record.title, record.href, root));
    list.append(articleLinks);
  }
  const workLinks = create("div", "kv-article-context-column");
  workLinks.append(create("strong", "", "关联互动体验"));
  works.slice(0, 6).forEach(work => addLink(workLinks, work.title, work.href, root));
  if (!works.length) workLinks.append(create("small", "", "暂无已登记作品"));
  list.append(workLinks);
  details.append(list);
  section.append(details);
  insertAfterPageHead(section);
}

export async function mountKnowledgeContext(base = document.body.dataset.root || "./") {
  const root = new URL(base, location.href);
  const current = new URL(location.href);
  if (!current.pathname.startsWith(root.pathname)) return;
  const relative = current.pathname.slice(root.pathname.length).replace(/^\/+/, "").replace(/index\.html$/, "").replace(/\/+$/, "");
  const isHome = relative === "";
  if (isHome) return;
  if (relative === "knowledge") return; // The directory architecture overview is build-time static.
  if (!relative.startsWith("knowledge/")) return;
  try {
    const response = await fetch(new URL("content/knowledge-context.json", root));
    if (!response.ok) throw new Error("knowledge-context.json HTTP " + response.status);
    const context = await response.json();
    if (context.schemaVersion !== 1 || !Array.isArray(context.topics) || !context.topicContexts) {
      throw new Error("知识上下文注册表结构无效");
    }
    const [, topicId, ...rest] = relative.split("/");
    const topic = context.topics.find(item => item.id === topicId);
    if (!topic) return;
    if (document.querySelector("[data-kv-topic-context], [data-kv-article-context]")) return;
    const topicContext = context.topicContexts[topic.id] || {};
    const records = topicContext.records || [];
    const relatedWorks = topicContext.works || [];
    const mapTopic = topicContext.competencies?.length
      ? { competencies: topicContext.competencies }
      : null;
    if (!rest.length) renderTopicPage(topic, records, relatedWorks, mapTopic, root);
    else renderArticleContext(topic, records, relatedWorks, mapTopic, current.pathname, root);
  } catch (error) {
    console.warn("[KNOWVERSE] knowledge context unavailable:", error);
  }
}
