import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async file => JSON.parse(await readFile(path.join(root, file), "utf8"));
const unique = (items, label) => assert.equal(new Set(items).size, items.length, `${label} contains duplicates`);
const localFileForRoute = raw => {
  assert.equal(typeof raw, "string");
  assert.ok(!/^(?:https?:)?\/\//i.test(raw) && !raw.startsWith("/"), `route must be internal: ${raw}`);
  const clean = decodeURIComponent(raw.replace(/^\.\//, "").split(/[?#]/, 1)[0]);
  return clean === "" ? "index.html" : clean.endsWith("/") ? clean + "index.html" : path.extname(clean) ? clean : clean + "/index.html";
};
const routeExists = async raw => access(path.join(root, localFileForRoute(raw)), constants.R_OK);
const routeAnchorExists = async raw => {
  const hash = raw.split("#")[1];
  if (!hash) return;
  const html = await readFile(path.join(root, localFileForRoute(raw)), "utf8");
  assert.ok(html.includes(`id="${decodeURIComponent(hash)}"`), `route anchor does not exist: ${raw}`);
};
async function walk(dir, rel = "") {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "_site"].includes(entry.name)) continue;
    const childRel = path.posix.join(rel, entry.name);
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await walk(child, childRel));
    else if (entry.isFile() && entry.name.endsWith(".html")) output.push({ file: child, rel: childRel });
  }
  return output;
}
async function validateInternalReferences(page) {
  const html = await readFile(page.file, "utf8");
  const attrs = /\b(?:href|src|poster)=(["'])(.*?)\1/gi;
  for (const match of html.matchAll(attrs)) {
    const raw = match[2].trim().replace(/&amp;/g, "&");
    if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw) || raw.startsWith("#")) continue;
    const pathname = decodeURIComponent(raw.split(/[?#]/, 1)[0]);
    if (!pathname) continue;
    let target = pathname.startsWith("/")
      ? path.resolve(root, pathname.replace(/^\/+/, ""))
      : path.resolve(root, path.posix.dirname(page.rel), pathname);
    if (!target.startsWith(root + path.sep) && target !== root) {
      throw new Error(page.rel + " has an out-of-repository reference: " + raw);
    }
    try {
      const info = await (await import("node:fs/promises")).stat(target);
      if (info.isDirectory()) target = path.join(target, "index.html");
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
      if (!path.extname(target)) target = path.join(target, "index.html");
    }
    await access(target, constants.R_OK).catch(() => {
      throw new Error(page.rel + " references a missing local resource: " + raw + " -> " + path.relative(root, target));
    });
  }
}

const [navigation, routesManifest, knowledge, works, learningMap, search, conceptsManifest, sourcesManifest, checkpointsManifest, reviewManifest] = await Promise.all([
  readJson("content/navigation.json"), readJson("content/routes.json"), readJson("content/knowledge.json"),
  readJson("content/works.json"), readJson("content/learning-map.json"), readJson("content/search-metadata.json"),
  readJson("content/concepts.json"), readJson("content/sources.json"), readJson("content/learning-checkpoints.json"), readJson("content/review-assessments.json"),
]);

assert.equal(navigation.groups?.length, 3, "navigation must have exactly three top-level groups");
unique(navigation.groups.map(group => group.id), "navigation group IDs");
unique(navigation.groups.map(group => group.label), "navigation labels");
assert.deepEqual(navigation.groups.map(group => group.id), ["knowledge", "experience", "learning"]);
const searchIndex = JSON.parse(await readFile(path.join(root, "data/search.json"), "utf8"));
unique(searchIndex.map(record => record.href), "generated search hrefs");
const searchByConcept = new Map(searchIndex.filter(record => record.concept_id).map(record => [record.concept_id, record]));
const routeById = new Map(routesManifest.routes.map(route => [route.id, route]));
unique(routesManifest.routes.map(route => route.id), "route IDs");
unique(routesManifest.routes.map(route => route.path), "canonical route paths");
for (const route of routesManifest.routes) {
  assert.ok(route.label && route.pageType, `route ${route.id} must have a label and pageType`);
  if (!route.id.startsWith("concept.")) {
    await routeExists(route.path);
    await routeAnchorExists(route.path);
  }
}
for (const group of navigation.groups) {
  assert.ok(routeById.has(group.routeId), `${group.id} references missing route ${group.routeId}`);
  for (const routeId of group.activeRouteIds || []) assert.ok(routeById.has(routeId), `${group.id} active route is unknown: ${routeId}`);
  for (const section of group.sections || []) {
    for (const item of section.items || []) assert.ok(routeById.has(item.routeId), `${group.id} item references unknown route ${item.routeId}`);
    if (section.dynamic) assert.equal(section.dynamic, "knowledge.topics", `unsupported dynamic section: ${section.dynamic}`);
  }
}
const requiredRoutes = ["knowledge.overview","knowledge.sources","experience.overview","experience.lab","experience.gallery","experience.puzzles","learning.overview","learning.today","learning.mastery","learning.gaps","learning.review","learning.history","account.archive"];
for (const id of requiredRoutes) assert.ok(routeById.has(id), `required route missing: ${id}`);

assert.ok(Array.isArray(knowledge.topics), "knowledge topics are required");
unique(knowledge.topics.map(topic => topic.id), "knowledge topic IDs");
const topicIds = new Set(knowledge.topics.map(topic => topic.id));
for (const topic of knowledge.topics) {
  await routeExists(topic.href);
  assert.ok(routeById.has(`topic.${topic.id}`), `topic ${topic.id} is missing its canonical route`);
}
assert.equal(works.pillars?.length, 3, "exactly three experience pillars are required");
unique(works.pillars.map(pillar => pillar.id), "experience pillar IDs");
for (const pillar of works.pillars) await routeExists(pillar.href);
unique(works.works.map(work => work.id), "work IDs");
const workIds = new Set(works.works.map(work => work.id));
for (const work of works.works) {
  await routeExists(work.href);
  assert.ok(works.pillars.some(pillar => pillar.id === work.pillar), `${work.id} references an unknown pillar`);
  for (const topicId of work.knowledge_ids || []) assert.ok(topicIds.has(topicId), `${work.id} references unknown topic ${topicId}`);
}

const competencyToConcept = new Map();
const competencyById = new Map();
unique((learningMap.topics || []).map(topic => topic.id), "learning-map topic IDs");
for (const topic of learningMap.topics || []) {
  assert.ok(topicIds.has(topic.id), `learning map references unknown topic ${topic.id}`);
  const competencies = topic.competencies || [];
  const byId = new Map(competencies.map(item => [item.id, item]));
  unique([...byId.keys()], `${topic.id} competency IDs`);
  for (const item of competencies) {
    competencyById.set(item.id, { ...item, topicId: topic.id });
    for (const prerequisite of item.prerequisites || []) assert.ok(byId.has(prerequisite), `${item.id} references unknown prerequisite ${prerequisite}`);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) throw new Error(`${topic.id} prerequisite graph has a cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const prerequisite of byId.get(id)?.prerequisites || []) visit(prerequisite);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
}

unique(conceptsManifest.concepts.map(concept => concept.id), "concept IDs");
const concepts = new Map(conceptsManifest.concepts.map(concept => [concept.id, concept]));
const coverage = new Map(conceptsManifest.coverage.map(row => [row.topicId, row]));
unique([...coverage.keys()], "concept coverage topic IDs");
assert.equal(coverage.size, knowledge.topics.length, "every knowledge topic must declare Concept coverage status");
for (const topic of knowledge.topics) {
  const row = coverage.get(topic.id);
  assert.ok(row, `missing concept coverage for ${topic.id}`);
  const actualCount = conceptsManifest.concepts.filter(concept => concept.topicId === topic.id).length;
  assert.equal(row.conceptCount, actualCount, `concept coverage count mismatch for ${topic.id}`);
  assert.ok(["mapped", "content-only"].includes(row.status), `invalid coverage status for ${topic.id}`);
  if (row.status === "mapped") assert.ok(actualCount > 0, `${topic.id} mapped status requires concepts`);
  if (row.status === "content-only") assert.equal(actualCount, 0, `${topic.id} content-only must not imply an unmodelled competency graph`);
}
const checkpointIds = new Set(checkpointsManifest.checkpoints.map(item => item.id));
const reviewIds = new Set(reviewManifest.assessments.map(item => item.id));
const sourceIds = new Set(sourcesManifest.sources.map(item => item.id));
for (const source of sourcesManifest.sources) assert.ok(/^https:\/\//.test(source.url), `source ${source.id} must be HTTPS`);
for (const concept of conceptsManifest.concepts) {
  assert.ok(topicIds.has(concept.topicId), `${concept.id} references an unknown topic`);
  assert.ok(concept.title && concept.summary && concept.learningObjectives?.length, `${concept.id} is missing required learning content`);
  assert.ok(["beginner","intermediate","advanced"].includes(concept.difficulty), `${concept.id} has invalid difficulty`);
  for (const id of concept.prerequisites || []) {
    assert.ok(concepts.has(id), `${concept.id} references unknown prerequisite concept ${id}`);
    assert.equal(concepts.get(id).topicId, concept.topicId, `${concept.id} has cross-topic prerequisite ${id}`);
  }
  for (const id of concept.relatedConcepts || []) assert.ok(concepts.has(id), `${concept.id} references unknown related concept ${id}`);
  for (const id of concept.competencyIds || []) {
    assert.ok(competencyById.has(id), `${concept.id} references unknown competency ${id}`);
    assert.equal(competencyById.get(id).topicId, concept.topicId, `${concept.id} maps a competency from another topic`);
    assert.ok(!competencyToConcept.has(id), `competency ${id} must not be silently duplicated across concepts`);
    competencyToConcept.set(id, concept.id);
  }
  for (const id of concept.sources || []) assert.ok(sourceIds.has(id), `${concept.id} references unknown source ${id}`);
  for (const item of concept.articles || []) await routeExists(item.href);
  for (const item of concept.works || []) {
    assert.ok(workIds.has(item.id), `${concept.id} references unknown work ${item.id}`);
    assert.ok(item.href, `${concept.id} work relation needs a route`);
  }
  for (const item of concept.assessmentRefs || []) {
    if (item.type === "checkpoint") {
      assert.ok(checkpointIds.has(item.id), `${concept.id} references unknown checkpoint ${item.id}`);
      if (item.workId) assert.ok(workIds.has(item.workId), `${concept.id} checkpoint references unknown work ${item.workId}`);
    } else if (item.type === "review") assert.ok(reviewIds.has(item.id), `${concept.id} references unknown review assessment ${item.id}`);
    else throw new Error(`${concept.id} has unsupported assessment reference type ${item.type}`);
  }
}
for (const [competencyId, data] of competencyById) {
  const concept = concepts.get(competencyToConcept.get(competencyId));
  assert.ok(concept, `Competency ${competencyId} has no Concept mapping`);
  const expected = (data.prerequisites || []).map(id => `${data.topicId}.${id}`).sort();
  const actual = [...(concept.prerequisites || [])].sort();
  assert.deepEqual(actual, expected, `${concept.id} prerequisite edges must match the explicit learning-map DAG`);
}
const cycleVisiting = new Set(), cycleVisited = new Set();
const visitConcept = id => {
  if (cycleVisiting.has(id)) throw new Error(`Concept prerequisite graph contains a cycle at ${id}`);
  if (cycleVisited.has(id)) return;
  cycleVisiting.add(id);
  for (const prerequisite of concepts.get(id)?.prerequisites || []) visitConcept(prerequisite);
  cycleVisiting.delete(id); cycleVisited.add(id);
};
for (const id of concepts.keys()) visitConcept(id);
for (const record of searchIndex) {
  assert.ok(!record.body.includes("搜索 KNOWVERSE 知识宇宙"), "Shared search dialog UI must never be indexed as knowledge content");
}
for (const concept of conceptsManifest.concepts) {
  const indexed = searchByConcept.get(concept.id);
  assert.ok(indexed, "Concept " + concept.id + " must be searchable");
  assert.equal(indexed.href, "concept/" + concept.id + "/", "Concept " + concept.id + " search route must be canonical");
  assert.equal(indexed.knowledge_id, concept.topicId, "Concept " + concept.id + " search topic must match its registry relation");
}
assert.equal(searchByConcept.size, conceptsManifest.concepts.length, "generated search index must contain each Concept exactly once");
for (const concept of conceptsManifest.concepts) {
  const generatedPath = `concept/${concept.id}/index.html`;
  await access(path.join(root, generatedPath), constants.R_OK);
  const route = routeById.get(`concept.${concept.id}`);
  assert.equal(route?.path, `./concept/${concept.id}/`, `concept route mismatch for ${concept.id}`);
}

assert.ok(Array.isArray(search.records), "search metadata records are required");
for (const record of search.records) await routeExists(record.href);

const shellSource = await readFile(path.join(root, "assets/js/site-shell.mjs"), "utf8");
assert.ok(shellSource.includes('header[data-kv-static-shell="true"]'), "runtime must hydrate the statically generated shared shell");
assert.ok(!shellSource.includes("replaceWith(links)"), "runtime must not replace legacy navigation after page load");
assert.ok(shellSource.includes("auth.signInWithGitHub(root, location.href)"), "global sign-in must preserve the initiating page");
assert.ok(!shellSource.includes("kv-account-quick-login"), "there must not be a second account/login entry in the navbar");
const pages = await walk(root);
const staticPages = [];
const immersivePages = new Set([
  "puzzles/worlds/first-realm/index.html",
  "puzzles/worlds/promise-realm/index.html",
  "gallery/exhibits/promise-cosmos/index.html",
]);
const excludedPages = new Set([
  "scripts/fixtures/archive-harness.html",
  "auth/callback/index.html",
  "knowledge/monorepo/fullstack/project/apps/web/index.html",
]);
for (const page of pages) {
  const html = await readFile(page.file, "utf8");
  if (excludedPages.has(page.rel)) continue;
  if (immersivePages.has(page.rel)) {
    assert.ok(html.includes("kv-immersive-exit"), page.rel + " must provide a consistent exit from full-screen experience");
    assert.equal((html.match(/class="kv-footer-links"/g) || []).length, 0, page.rel + " must keep the full-screen canvas free of the shared page footer");
    continue;
  }
  assert.ok(html.includes('data-kv-static-shell="true"'), page.rel + " must use the shared static shell");
  staticPages.push(page.rel);
  assert.equal((html.match(/id="kv-global-account"/g) || []).length, 1, page.rel + " must have exactly one global account control");
  assert.equal((html.match(/data-group-id="knowledge"/g) || []).length, 1, page.rel + " must have one Knowledge navigation group");
  assert.equal((html.match(/data-group-id="experience"/g) || []).length, 1, page.rel + " must have one Experience navigation group");
  assert.equal((html.match(/data-group-id="learning"/g) || []).length, 1, page.rel + " must have one Learning navigation group");
  assert.equal((html.match(/id="search-overlay"/g) || []).length, 1, page.rel + " must have one shared search overlay");
  const sharedFooterCount = (html.match(/class="kv-footer-links"/g) || []).length;
  if (page.rel === "lab/experiments/promise-debugger/index.html") {
    assert.equal(sharedFooterCount, 0, "Promise debugger retains its dedicated workbench footer and boundary placement");
  } else {
    assert.equal(sharedFooterCount, 1, page.rel + " must have exactly one set of shared footer links");
  }
  assert.ok(html.includes('data-kv-shell-version="3.0"'), page.rel + " must use the current shell version");
  assert.ok(html.includes("assets/css/site-architecture.css"), page.rel + " must load shared shell styling");
  assert.ok(html.includes("assets/js/v2.js"), page.rel + " must load shared navigation behavior");
  await validateInternalReferences(page);
}
assert.equal(pages.length, staticPages.length + immersivePages.size + excludedPages.size,
  "every HTML page must be covered by the shared shell or an explicit documented exception");
assert.ok(staticPages.length >= 135, "expected at least 135 static shell pages, found " + staticPages.length);
for (const file of [
  "knowledge/monorepo/guides/cross-platform/index.html",
  "knowledge/monorepo/guides/ghost-deps/index.html",
  "knowledge/monorepo/guides/nx24-affected/index.html",
  "knowledge/monorepo/guides/rush-rollout/index.html",
]) {
  const page = await readFile(path.join(root, file), "utf8");
  assert.ok(page.includes('data-kv-static-shell="true"'), file + " must use the shared shell");
  assert.ok(page.includes("../../../../assets/js/v2.js"), file + " must load the shared interaction runtime");
}
console.log("KNOWVERSE 3.0 architecture verified: " + navigation.groups.length + " nav groups, " + knowledge.topics.length + " topics, " + concepts.size + " concepts, " + competencyToConcept.size + " competencies, " + works.pillars.length + " pillars, " + works.works.length + " works, " + sourcesManifest.sources.length + " sources, " + routesManifest.routes.length + " canonical routes, " + searchIndex.length + " search records, " + staticPages.length + " static-shell pages, " + immersivePages.size + " immersive exits.");
