// Verify route-manifest invariants (T1.1). Read-only; no page behavior change.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ROUTE_MANIFEST, resolveRoute } from "../src/interface/router/route-manifest.js";

const routes = JSON.parse(readFileSync(new URL("../content/routes.json", import.meta.url), "utf8"));
const works = JSON.parse(readFileSync(new URL("../content/works.json", import.meta.url), "utf8"));
const concepts = JSON.parse(readFileSync(new URL("../content/concepts.json", import.meta.url), "utf8"));

const routePaths = new Set(routes.routes.map((r) => r.path));
const workPaths = new Set(works.works.map((w) => w.href));
const conceptIds = new Set(concepts.concepts.map((c) => c.id));

test("manifest has entries and all are Promise domain (MVP)", () => {
  assert.ok(ROUTE_MANIFEST.length > 0);
  for (const e of ROUTE_MANIFEST) {
    assert.match(e.problemId, /^[a-z0-9-]+$/, e.problemId);
    assert.match(e.conceptId, /^promise\./, "MVP domain is Promise only");
  }
});

test("conceptId anchors to a real registered Concept", () => {
  for (const e of ROUTE_MANIFEST) {
    assert.ok(conceptIds.has(e.conceptId), `${e.problemId}: unknown concept ${e.conceptId}`);
  }
});

test("every legacyPath resolves to a registered route or work", () => {
  for (const e of ROUTE_MANIFEST) {
    assert.ok(e.legacyPaths.length > 0, `${e.problemId}: no legacy path`);
    for (const p of e.legacyPaths) {
      assert.ok(routePaths.has(p) || workPaths.has(p),
        `${e.problemId}: legacy path not registered: ${p}`);
    }
  }
});

test("newPath format is /q/:problemId/<stage> and stage is valid", () => {
  for (const e of ROUTE_MANIFEST) {
    assert.equal(e.newPath, `/q/${e.problemId}/${e.stage}`, e.problemId);
    assert.ok(["explore", "check", "express"].includes(e.stage));
  }
});

test("no duplicate problemId or legacyPath", () => {
  const problems = new Set();
  const legacy = new Set();
  for (const e of ROUTE_MANIFEST) {
    assert.ok(!problems.has(e.problemId), `duplicate problemId ${e.problemId}`);
    problems.add(e.problemId);
    for (const p of e.legacyPaths) {
      assert.ok(!legacy.has(p), `duplicate legacyPath ${p}`);
      legacy.add(p);
    }
  }
});

test("resolveRoute finds both new and legacy paths", () => {
  for (const e of ROUTE_MANIFEST) {
    assert.equal(resolveRoute(e.newPath)?.problemId, e.problemId);
    assert.equal(resolveRoute(e.legacyPaths[0])?.problemId, e.problemId);
  }
  assert.equal(resolveRoute("/q/does-not-exist/explore"), null);
});
