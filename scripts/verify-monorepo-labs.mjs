/** Offline checks for the real Monorepo graph model and cache-key teaching lab. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  getAffectedIds,
  getReadyBuildNodes,
  tryBuildNode,
} from "../assets/js/monorepo-graph-model.mjs";

const graph = JSON.parse(readFileSync(new URL("../data/monorepo-graph.json", import.meta.url), "utf8"));
const labProgram = readFileSync(new URL("../assets/js/monorepo-labs.js", import.meta.url), "utf8");

function makeCacheLab() {
  const elements = new Map();
  const node = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        id, value: "", checked: true, disabled: false, textContent: "", innerHTML: "",
        listeners: new Map(),
        addEventListener(name, callback) { this.listeners.set(name, callback); },
        querySelectorAll() { return []; },
        click() { this.onclick?.(); },
        change() { this.listeners.get("change")?.(); },
      });
    }
    return elements.get(id);
  };
  node("include-env").checked = false;
  node("env-mode").value = "alpha";
  node("source-ver").value = "v1";
  const document = {
    currentScript: null,
    querySelector: selector => selector === "[data-lab]" ? { dataset: { lab: "cache" } } : null,
    getElementById: node,
  };
  runInNewContext(labProgram, { document, navigator: {}, console, Map, Set, Math, JSON, String, Number, Array });
  return node;
}

test("domain change affects every real consumer, including mobile", () => {
  assert.deepEqual(getAffectedIds(graph, "domain"), ["domain", "api", "mobile", "web"]);
  assert.equal(getAffectedIds(graph, "domain").includes("contracts"), false);
});

test("contracts change propagates through the complete five-package workspace", () => {
  assert.deepEqual(getAffectedIds(graph, "contracts"), graph.build_order);
  assert.deepEqual(getAffectedIds(graph, "mobile"), ["mobile"]);
});

test("build readiness follows the manifest-derived layers and blocks premature apps", () => {
  assert.deepEqual(getReadyBuildNodes(graph).map(node => node.id), ["contracts"]);
  assert.deepEqual(getReadyBuildNodes(graph, ["contracts"]).map(node => node.id), ["domain"]);
  assert.deepEqual(
    getReadyBuildNodes(graph, ["contracts", "domain"]).map(node => node.id),
    ["api", "mobile", "web"]
  );
  assert.equal(tryBuildNode(graph, [], "api").reason, "dependencies-not-built");
  let completed = [];
  for (const id of graph.build_order) {
    const result = tryBuildNode(graph, completed, id);
    assert.equal(result.ok, true, id);
    completed = result.completed;
  }
  assert.equal(completed.length, 5);
});

test("cache lab still demonstrates a false hit when MODE is omitted", () => {
  const element = makeCacheLab();
  element("run-cache").listeners.get("click")();
  element("env-mode").value = "beta";
  element("run-cache").listeners.get("click")();
  assert.match(element("cache-result").textContent, /错误命中/);

  element("include-env").checked = true;
  element("run-cache").listeners.get("click")();
  assert.match(element("cache-result").textContent, /产物与当前输入匹配/);
});

test("browser lab loads the generated workspace graph instead of a hard-coded demo topology", () => {
  assert.match(labProgram, /data\/monorepo-graph\.json/);
  assert.match(labProgram, /monorepo-graph-model\.mjs/);
  assert.doesNotMatch(labProgram, /ui-adapter/);
});

console.log("PASS: real Monorepo graph closure, parallel build layers, cache-key lab, browser lab data source");
