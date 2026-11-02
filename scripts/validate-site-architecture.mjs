import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async file => JSON.parse(await readFile(path.join(root, file), "utf8"));
const routeExists = async raw => {
  assert.equal(typeof raw, "string");
  assert.ok(raw.length > 0, "route must not be empty");
  assert.ok(!/^(?:https?:)?\/\//i.test(raw), `expected an internal route: ${raw}`);
  const route = decodeURIComponent(raw.split(/[?#]/, 1)[0]).replace(/^\.\//, "").replace(/^\//, "");
  const file = route === "" ? "index.html"
    : route.endsWith("/") ? route + "index.html"
      : path.extname(route) ? route : route + "/index.html";
  await access(path.join(root, file), constants.R_OK);
};
const unique = (items, label) => {
  assert.equal(new Set(items).size, items.length, `${label} contains duplicates`);
};

const [navigation, knowledge, works, learningMap, search] = await Promise.all([
  readJson("content/navigation.json"),
  readJson("content/knowledge.json"),
  readJson("content/works.json"),
  readJson("content/learning-map.json"),
  readJson("content/search-metadata.json"),
]);

assert.equal(navigation.groups?.length, 3, "navigation must have exactly three top-level groups");
unique(navigation.groups.map(group => group.id), "navigation group IDs");
unique(navigation.groups.map(group => group.label), "navigation labels");
for (const group of navigation.groups) {
  await routeExists(group.path);
  for (const route of group.activePaths || []) await routeExists(route);
  for (const section of group.sections || []) {
    unique((section.items || []).map(item => item.path), `${group.id}/${section.label || "section"} routes`);
    for (const item of section.items || []) await routeExists(item.path);
  }
}

assert.ok(Array.isArray(knowledge.topics), "knowledge topics are required");
unique(knowledge.topics.map(topic => topic.id), "knowledge topic IDs");
const topicIds = new Set(knowledge.topics.map(topic => topic.id));
for (const topic of knowledge.topics) await routeExists(topic.href);

assert.equal(works.pillars?.length, 3, "exactly three experience pillars are required");
unique(works.pillars.map(pillar => pillar.id), "experience pillar IDs");
for (const pillar of works.pillars) await routeExists(pillar.href);
unique(works.works.map(work => work.id), "work IDs");
for (const work of works.works) {
  await routeExists(work.href);
  assert.ok(works.pillars.some(pillar => pillar.id === work.pillar), `${work.id} references an unknown pillar`);
  for (const topicId of work.knowledge_ids || []) {
    assert.ok(topicIds.has(topicId), `${work.id} references unknown topic ${topicId}`);
  }
}

unique((learningMap.topics || []).map(topic => topic.id), "learning-map topic IDs");
for (const topic of learningMap.topics || []) {
  assert.ok(topicIds.has(topic.id), `learning map references unknown topic ${topic.id}`);
  const competencies = topic.competencies || [];
  const byId = new Map(competencies.map(item => [item.id, item]));
  unique([...byId.keys()], `${topic.id} competency IDs`);
  for (const item of competencies) {
    for (const prerequisite of item.prerequisites || []) {
      assert.ok(byId.has(prerequisite), `${item.id} references unknown prerequisite ${prerequisite}`);
    }
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

assert.ok(Array.isArray(search.records), "search metadata records are required");
for (const record of search.records) await routeExists(record.href);

console.log(`Site architecture verified: ${navigation.groups.length} nav groups, ${knowledge.topics.length} topics, ${works.pillars.length} pillars, ${works.works.length} works, ${(learningMap.topics || []).length} competency graphs, ${search.records.length} search records.`);
