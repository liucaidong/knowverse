import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getAffectedIds,
  getReadyBuildNodes,
  hasDirectDependency,
  tryBuildNode,
} from "../assets/js/monorepo-graph-model.mjs";
import {
  applyBuildChoice,
  validateAffectedSelection,
  validatePackageDependency,
  validateWorkspaceProtocol,
} from "../assets/js/monorepo-quest-core.mjs";

const graph = JSON.parse(readFileSync(new URL("../data/monorepo-graph.json", import.meta.url), "utf8"));

assert.equal(graph.nodes.length, 5);
assert.equal(graph.edges.length, 7);
assert.deepEqual(graph.build_layers, [
  ["contracts"],
  ["domain"],
  ["api", "mobile", "web"],
]);
assert.deepEqual(getReadyBuildNodes(graph).map(node => node.id), ["contracts"]);
assert.equal(hasDirectDependency(graph, "web", "domain"), true);
assert.equal(hasDirectDependency(graph, "web", "contracts"), true);
assert.equal(hasDirectDependency(graph, "contracts", "domain"), false);

assert.deepEqual(getAffectedIds(graph, "contracts"), graph.build_order);
assert.deepEqual(getAffectedIds(graph, "domain"), ["domain", "api", "mobile", "web"]);
assert.deepEqual(getAffectedIds(graph, "mobile"), ["mobile"]);
assert.deepEqual(getAffectedIds(graph, "missing"), []);

assert.equal(validateWorkspaceProtocol("workspace:*"), true);
assert.equal(validateWorkspaceProtocol("^0.1.0"), false);
assert.equal(validatePackageDependency(graph, "web", "domain"), true);
assert.equal(validatePackageDependency(graph, "contracts", "domain"), false);
assert.equal(validateAffectedSelection(graph, "contracts", graph.build_order).ok, true);
assert.equal(validateAffectedSelection(graph, "contracts", ["contracts", "domain"]).ok, false);

assert.equal(tryBuildNode(graph, [], "api").ok, false);
assert.deepEqual(tryBuildNode(graph, [], "api").missing, ["contracts", "domain"]);
let completed = [];
for (const nodeId of graph.build_order) {
  const result = applyBuildChoice(graph, completed, nodeId);
  assert.equal(result.ok, true, nodeId);
  completed = result.completed;
}
assert.equal(completed.length, 5);
assert.equal(tryBuildNode(graph, completed, "api").reason, "already-built");

console.log("PASS: Monorepo graph invariants, affected closure, workspace protocol and quest build gates");
