import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(scriptDir, "..");
const argRoot = process.argv.find((value, index) => process.argv[index - 1] === "--root");
const root = path.resolve(argRoot || sourceRoot);
const readJson = async name => JSON.parse(await readFile(path.join(root, name), "utf8"));
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const trim = value => String(value || "").replace(/^\.\//, "").replace(/^\/+/, "");
const href = (value, prefix) => prefix + trim(value);
const prefixFor = rel => {
  const dir = path.posix.dirname(rel);
  return dir === "." ? "./" : "../".repeat(dir.split("/").length);
};

function topicCard(topic, prefix) {
  return `<a class="topic-card" style="--accent:${esc(topic.accent || "#4d9b91")}" href="${esc(href(topic.href, prefix))}">
    <span class="topic-icon" aria-hidden="true"></span><span class="category">${esc(topic.category)}</span>
    <h3>${esc(topic.title)}</h3><p>${esc(topic.summary)}</p><span class="meta">专题中枢 · 进入知识体系 ↗</span></a>`;
}

function conceptPage(concept, topic, conceptById, sourceById, prefix) {
  const prereqs = (concept.prerequisites || []).map(id => conceptById.get(id)).filter(Boolean);
  const related = (concept.relatedConcepts || []).map(id => conceptById.get(id)).filter(Boolean);
  const objectives = (concept.learningObjectives || []).map(item => `<li>${esc(item)}</li>`).join("");
  const articleLinks = (concept.articles || []).map(item => `<a class="cp-link" href="${esc(href(item.href, prefix))}"><span>ARTICLE</span><strong>${esc(item.title)}</strong><b>阅读内容 ↗</b></a>`).join("");
  const workLinks = (concept.works || []).map(item => `<a class="cp-work" href="${esc(href(item.href, prefix))}"><small>${esc(({lab:"01 · 原理实验室",gallery:"02 · 沉浸式展厅",puzzles:"03 · 知识解谜"})[item.pillar] || "互动作品")}</small><strong>${esc(item.title)}</strong><span>进入体验 ↗</span></a>`).join("");
  const prereqLinks = prereqs.map(item => `<a href="${esc(href(`./concept/${item.id}/`, prefix))}">${esc(item.title)} ↗</a>`).join("");
  const relatedLinks = related.map(item => `<a href="${esc(href(`./concept/${item.id}/`, prefix))}">${esc(item.title)} ↗</a>`).join("");
  const assessmentLinks = (concept.assessmentRefs || []).map(item => {
    const dest = item.type === "checkpoint" && item.workId
      ? (concept.works || []).find(work => work.id === item.workId)?.href || "./works/"
      : "./review/";
    const tag = item.type === "checkpoint" ? "作品检查点" : "复习题变体";
    return `<li><a href="${esc(href(dest, prefix))}"><span>${tag}</span><strong>${esc(item.title)}</strong><b>打开验证入口 ↗</b></a></li>`;
  }).join("");
  const sourceLinks = (concept.sources || []).map(id => sourceById.get(id)).filter(Boolean).map(item => `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(item.title)}</strong><span>${esc(item.publisher)} · ${esc(item.kind)}</span> ↗</a>`).join("");
  const competency = (concept.competencyIds || []).length
    ? `<p class="cp-competency">对应能力点：${concept.competencyIds.map(esc).join("、")}</p>`
    : `<p class="cp-competency">当前概念已建立知识定义，但尚未绑定正式 Competency；不会伪造掌握分数或学习门控。</p>`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#f7faf9"><meta name="description" content="${esc(concept.summary)}"><title>${esc(concept.title)} · ${esc(topic.title)} · KNOWVERSE</title><link rel="stylesheet" href="${prefix}assets/css/v2.css"><link rel="stylesheet" href="${prefix}assets/css/concepts.css"></head>
<body data-root="${prefix}" class="kv-concept-page"><div class="topline"></div><header class="navwrap"><nav class="navbar" aria-label="全站导航"></nav></header>
<main class="cp-container"><nav class="cp-breadcrumb" aria-label="面包屑"><a href="${prefix}">首页</a><span>/</span><a href="${prefix}knowledge/">知识体系</a><span>/</span><a href="${esc(href(topic.href,prefix))}">${esc(topic.title)}</a><span>/</span><strong>${esc(concept.title)}</strong></nav>
<section class="cp-hero"><div><span class="cp-kicker">CONCEPT REGISTRY / ${esc(concept.topicId.toUpperCase())}</span><h1>${esc(concept.title)}</h1><p>${esc(concept.summary)}</p><div class="cp-meta"><span>${esc(topic.category)}</span><span>${esc(concept.difficulty || "未分级")} 难度</span><span>稳定 ID：${esc(concept.id)}</span></div></div><aside><small>KNOWLEDGE OBJECT</small><strong>Concept</strong><p>概念用于定义、关联和解释知识；Competency 用于定义可验证能力。两者分开维护。</p>${competency}<a href="${prefix}progress/#knowledge-map">查看个人掌握证据 ↗</a></aside></section>
<section class="cp-section"><div class="cp-section-head"><span>LEARNING OBJECTIVES</span><h2>学完后应该能够</h2></div><ol class="cp-objectives">${objectives}</ol></section>
<section class="cp-grid"><article class="cp-panel"><div class="cp-section-head"><span>KNOWLEDGE GRAPH</span><h2>前置与关联概念</h2></div><div class="cp-relation-group"><strong>明确前置知识</strong>${prereqLinks || '<p>未声明先修要求。系统不会从章节顺序推断依赖。</p>'}</div><div class="cp-relation-group"><strong>相关概念</strong>${relatedLinks || '<p>暂无显式 related_to 关系。</p>'}</div></article><article class="cp-panel"><div class="cp-section-head"><span>ASSESSMENT & EVIDENCE</span><h2>如何验证理解</h2></div>${assessmentLinks ? `<ul class="cp-assessments">${assessmentLinks}</ul>` : '<p>当前没有登记可判定的评估入口；阅读与浏览行为不会被当作掌握证据。</p>'}<p class="cp-note">AI 教学建议、作品探索行为和正式掌握证据严格分离。只有评估引擎接受的独立验证事件才能更新学习状态。</p></article></section>
<section class="cp-section"><div class="cp-section-head"><span>CANONICAL CONTENT</span><h2>解释与学习材料</h2></div><div class="cp-link-grid">${articleLinks || '<p>尚无直接关联文章。</p>'}</div></section>
<section class="cp-section"><div class="cp-section-head"><span>LEARN BY DOING</span><h2>进入对应体验</h2></div><div class="cp-work-grid">${workLinks || '<p>本概念尚无登记的互动作品。</p>'}</div></section>
<section class="cp-section"><div class="cp-section-head"><span>SOURCES & REFERENCES</span><h2>来源与参考</h2></div><div class="cp-source-grid">${sourceLinks || '<p>尚未登记直接来源；请回到专题来源页查看可用资料。</p>'}</div><p class="cp-note">来源记录来自内容注册表。整理、示例和教学流程如有重构，会在对应教材中明确标注；外部链接不等同于对来源内容的逐字复现。</p></section>
<div class="cp-return"><a href="${esc(href(topic.href,prefix))}">← 返回 ${esc(topic.title)} 专题</a><a href="${prefix}progress/#adaptive-plan">查看下一步学习计划 ↗</a></div></main>
<footer class="sitefooter"><div class="container footerflex"><div><strong>KNOWVERSE / 知域</strong><p>Knowledge → Experience → Evidence → Growth</p></div><div class="footerlinks"><a href="${prefix}knowledge/">知识体系</a><a href="${prefix}works/">实践体验</a><a href="${prefix}progress/">学习成长</a></div></div></footer><script defer src="${prefix}assets/js/v2.js"></script></body></html>`;
}

async function walk(dir, rel = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "_site", "concept"].includes(entry.name)) continue;
    const childRel = path.posix.join(rel, entry.name);
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(child, childRel));
    else if (entry.isFile() && entry.name.endsWith(".html")) out.push({ file: child, rel: childRel });
  }
  return out;
}

const [knowledge, works, conceptsManifest, sourcesManifest, routes] = await Promise.all([
  readJson("content/knowledge.json"), readJson("content/works.json"), readJson("content/concepts.json"), readJson("content/sources.json"), readJson("content/routes.json"),
]);
const sourceByIdForProvenance = new Map(sourcesManifest.sources.map(source => [source.id, source]));
const conceptsByTopic = new Map(knowledge.topics.map(topic => [topic.id, conceptsManifest.concepts.filter(concept => concept.topicId === topic.id)]));
function renderProvenance(prefix) {
  const coverageCards = conceptsManifest.coverage.map(row => {
    const topic = knowledge.topics.find(item => item.id === row.topicId);
    const mapped = row.status === "mapped";
    return `<article class="kv-provenance-coverage"><div><span>${mapped ? "CONCEPT MAPPED" : "CONTENT ONLY"}</span><strong>${esc(topic?.title || row.topicId)}</strong></div><b>${row.conceptCount} Concept</b><p>${mapped ? "已有稳定 Concept / Competency 与显式先修关系；具体掌握状态取决于个人评估事件。" : "已有专题内容，尚未建立正式 Concept / Competency 模型；不推断章节顺序或先修门槛。"}</p><a href="${esc(href(topic?.href || "./knowledge/",prefix))}">查看专题 ↗</a></article>`;
  }).join("");
  const sourceCards = sourcesManifest.sources.map(source => {
    const linked = conceptsManifest.concepts.filter(concept => concept.sources?.includes(source.id));
    const topicNames = [...new Set(linked.map(concept => knowledge.topics.find(topic => topic.id === concept.topicId)?.short_title || concept.topicId))];
    return `<a class="kv-provenance-source" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer"><span>${esc(source.kind)} · ${esc(source.publisher)}</span><strong>${esc(source.title)}</strong><small>覆盖：${esc(topicNames.join("、") || "通用参考")} · 核对日期 ${esc(source.accessed || "未记录")}</small></a>`;
  }).join("");
  return `<section class="kv-provenance-registry"><div class="kv-provenance-heading"><span>KNOWLEDGE COVERAGE / 3.0</span><h2>哪些知识已经建立正式模型？</h2><p>专题数量不等同于能力图谱覆盖率。只有明确建模的能力点和先修边才会参与学习门控；未建模专题仍可正常阅读与探索。</p></div><div class="kv-provenance-coverage-grid">${coverageCards}</div><div class="kv-provenance-heading"><span>SOURCE REGISTRY / ${sourcesManifest.sources.length} RECORDS</span><h2>概念与教材的参考来源</h2><p>来源对象独立登记，再由 Concept 引用；访问日期和适用专题公开展示。引用来源不代表页面内容逐字复制。</p></div><div class="kv-provenance-source-grid">${sourceCards}</div><p class="kv-provenance-footnote">当前数据模型包含 ${conceptsManifest.concepts.length} 个 Concept、${[...conceptsByTopic.values()].reduce((n,items)=>n+items.length,0)} 个映射对象和 ${sourcesManifest.sources.length} 条来源。学习事件、个人掌握状态和私人资料不进入公开内容注册表。</p></section>`;
}
const htmlFiles = await walk(root);
let catalogCount = 0, conceptCount = 0, homeCount = 0;
for (const { file, rel } of htmlFiles) {
  let html = await readFile(file, "utf8");
  const prefix = prefixFor(rel);
  const grids = [...html.matchAll(/<div\b([^>]*data-knowledge-catalog=["'](all|featured)["'][^>]*)>([\s\S]*?)<\/div>/gi)];
  for (const match of grids.reverse()) {
    const kind = match[2];
    const topics = kind === "featured" ? knowledge.topics.filter(item => item.featured) : knowledge.topics;
    html = html.replace(match[0], `<div class="topic-grid" data-knowledge-catalog="${kind}">${topics.map(topic => topicCard(topic,prefix)).join("\n")}</div>`);
    catalogCount++;
  }
  if (rel === "index.html") {
    const portal = `<section class="kv-home-portal" data-kv-home-portal="true"><div class="kv-home-copy"><span>KNOWVERSE / YOUR LEARNING HOME</span><h2>从这里开始。一次只做下一步。</h2><p>不必先弄懂所有菜单，也不必同时打开知识图谱、策略分析和 Agent。KNOWVERSE 会根据真实学习记录，告诉你当前最重要的行动。</p></div><div class="kv-home-actions"><a class="kv-home-action primary" href="./start/"><small>YOUR NEXT STEP</small><strong>进入学习中枢</strong><span>设定目标、确认计划，再按任务一步步学习 ↗</span></a><div class="kv-home-secondary"><a href="./knowledge/">我想先浏览知识库 <span aria-hidden="true">↗</span></a><a href="./works/">我想先体验互动作品 <span aria-hidden="true">↗</span></a></div></div></section>`;
    const portalPattern = /<section class="kv-home-portal" data-kv-home-portal="true">[\s\S]*?<\/section>/;
    if (portalPattern.test(html)) {
      html = html.replace(portalPattern, portal);
    } else {
      html = html.replace(/(<main\b[^>]*>)/i, `$1${portal}`);
    }
    homeCount++;
  }
  if (rel === "knowledge/index.html") {
    html = html.replace(/查看全部\s*\d+\s*个专题/g, `查看全部 ${knowledge.topics.length} 个专题`);
    html = html.replace(/<strong>\d+<\/strong>\s*个领域/g, `<strong>${knowledge.topics.length}</strong> 个领域`);
  }
  if (rel === "provenance/index.html") {
    const marker = '<div data-kv-provenance-registry="true">';
    const start = html.indexOf(marker);
    const readerStart = start >= 0
      ? html.indexOf('<div class="layout-narrow reader">', start)
      : -1;
    const freshRegistry = `<div data-kv-provenance-registry="true">${renderProvenance(prefix)}</div>`;
    if (start >= 0 && readerStart > start) {
      // Refresh the whole generated registry on every build. A presence-only
      // guard leaves stale coverage counts and source records in the public page.
      html = html.slice(0, start) + freshRegistry + html.slice(readerStart);
    } else {
      html = html.replace(/<div class="layout-narrow reader">/i, `${freshRegistry}<div class="layout-narrow reader">`);
    }
  }
  await writeFile(file, html);
}

const topicById = new Map(knowledge.topics.map(topic => [topic.id, topic]));
const conceptById = new Map(conceptsManifest.concepts.map(concept => [concept.id, concept]));
const sourceById = new Map(sourcesManifest.sources.map(source => [source.id, source]));
for (const concept of conceptsManifest.concepts) {
  const topic = topicById.get(concept.topicId);
  if (!topic) throw new Error(`Unknown topic for concept ${concept.id}`);
  const rel = `concept/${concept.id}/index.html`;
  const page = path.join(root, rel);
  await mkdir(path.dirname(page), { recursive: true });
  await writeFile(page, conceptPage(concept, topic, conceptById, sourceById, "../../"));
  conceptCount++;
}
console.log(`Public content generated: ${catalogCount} registry-backed knowledge catalogues; ${conceptCount} concept detail pages; ${homeCount} home learning portals.`);
