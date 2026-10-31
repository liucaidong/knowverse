import { getAffectedIds, hasDirectDependency, sameSet, tryBuildNode } from "./monorepo-graph-model.mjs";

export function validateWorkspaceProtocol(value) {
  return value === "workspace:*";
}

export function validatePackageDependency(graph, consumerId, dependencyId) {
  return hasDirectDependency(graph, consumerId, dependencyId);
}

export function applyBuildChoice(graph, completedIds, nodeId) {
  return tryBuildNode(graph, completedIds, nodeId);
}

export function validateAffectedSelection(graph, sourceId, selectedIds) {
  const expected = getAffectedIds(graph, sourceId);
  return {
    ok: sameSet(expected, selectedIds),
    expected,
    selected: [...selectedIds],
  };
}
