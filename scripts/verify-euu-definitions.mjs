// T2.6: validate the EUU definition registry (independent of validate-content.py).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const euu = JSON.parse(readFileSync(new URL("../content/euu-definitions.json", import.meta.url), "utf8"));
const concepts = JSON.parse(readFileSync(new URL("../content/concepts.json", import.meta.url), "utf8"));
const assessments = JSON.parse(readFileSync(new URL("../content/review-assessments.json", import.meta.url), "utf8"));
const works = JSON.parse(readFileSync(new URL("../content/works.json", import.meta.url), "utf8"));
const manifest = (await import("../src/interface/router/route-manifest.js")).ROUTE_MANIFEST;

const conceptIds = new Set(concepts.concepts.map((c) => c.id));
const assessmentIds = new Set(assessments.assessments.map((a) => a.id));
const workIds = new Set(works.works.map((w) => w.id));
const euuIds = new Set(euu.euus.map((e) => e.euuId));

test("registry shape and unique stable IDs", () => {
  assert.equal(euu.schemaVersion, 1);
  assert.ok(euu.euus.length > 0);
  assert.equal(euuIds.size, euu.euus.length, "euuId must be unique");
  for (const e of euu.euus) assert.match(e.euuId, /^euu\.[a-z0-9-]+$/, e.euuId);
});

test("anchors reference real Concepts and do not merge the three-part split", () => {
  for (const e of euu.euus) {
    assert.ok(e.anchors.length > 0, `${e.euuId} has no anchor`);
    for (const a of e.anchors) {
      assert.equal(a.kind, "Concept", "EUU anchors to Concept; Competency/Evidence stay separate");
      assert.ok(conceptIds.has(a.canonicalId), `${e.euuId}: unknown concept ${a.canonicalId}`);
    }
  }
});

test("prerequisites reference existing EUUs and are acyclic", () => {
  for (const e of euu.euus) {
    for (const p of e.prerequisiteEuus) assert.ok(euuIds.has(p), `${e.euuId}: unknown prereq ${p}`);
    assert.ok(!e.prerequisiteEuus.includes(e.euuId), `${e.euuId}: self prerequisite`);
  }
  // DFS cycle detection
  const visiting = new Set(); const visited = new Set();
  const byId = Object.fromEntries(euu.euus.map((e) => [e.euuId, e]));
  const visit = (id) => {
    if (visiting.has(id)) throw new Error(`cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const p of byId[id].prerequisiteEuus) visit(p);
    visiting.delete(id); visited.add(id);
  };
  for (const id of euuIds) visit(id);
});

test("calibration assessments and legacy works reference real IDs", () => {
  for (const e of euu.euus) {
    for (const a of e.calibrationAssessmentIds) assert.ok(assessmentIds.has(a), `${e.euuId}: unknown assessment ${a}`);
    for (const w of e.legacyWorkIds) assert.ok(workIds.has(w), `${e.euuId}: unknown work ${w}`);
  }
});

test("every MVP EUU has a matching route-manifest problem", () => {
  const problems = new Set(manifest.map((m) => m.problemId));
  for (const e of euu.euus.filter((x) => x.mvp)) {
    assert.ok(problems.has(e.problemId), `${e.euuId}: problemId ${e.problemId} not in route manifest`);
  }
});
