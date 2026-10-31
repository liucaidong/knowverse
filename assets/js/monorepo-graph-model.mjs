export function getNode(graph, id) {
  return graph.nodes.find(node => node.id === id) || null;
}

export function getAffectedIds(graph, sourceId) {
  if (!getNode(graph, sourceId)) return [];
  const consumers = new Map(graph.nodes.map(node => [node.id, []]));
  graph.nodes.forEach(node => {
    node.dependencies.forEach(dependency => consumers.get(dependency)?.push(node.id));
  });

  const visited = new Set([sourceId]);
  const queue = [sourceId];
  while (queue.length) {
    const current = queue.shift();
    for (const consumer of consumers.get(current) || []) {
      if (!visited.has(consumer)) {
        visited.add(consumer);
        queue.push(consumer);
      }
    }
  }
  const order = graph.build_order?.length ? graph.build_order : graph.nodes.map(node => node.id);
  return order.filter(id => visited.has(id));
}

export function getReadyBuildNodes(graph, completedIds = []) {
  const completed = new Set(completedIds);
  return graph.nodes.filter(node =>
    !completed.has(node.id) &&
    node.dependencies.every(dependency => completed.has(dependency))
  );
}

export function tryBuildNode(graph, completedIds, nodeId) {
  const completed = new Set(completedIds);
  const node = getNode(graph, nodeId);
  if (!node) return { ok: false, reason: "unknown-node", missing: [] };
  if (completed.has(nodeId)) return { ok: false, reason: "already-built", missing: [] };
  const missing = node.dependencies.filter(dependency => !completed.has(dependency));
  if (missing.length) return { ok: false, reason: "dependencies-not-built", missing };
  const nextCompleted = [...completed, nodeId];
  return {
    ok: true,
    completed: nextCompleted,
    ready: getReadyBuildNodes(graph, nextCompleted).map(item => item.id),
    finished: nextCompleted.length === graph.nodes.length,
  };
}

export function hasDirectDependency(graph, consumerId, dependencyId) {
  const consumer = getNode(graph, consumerId);
  return Boolean(consumer && consumer.dependencies.includes(dependencyId));
}

export function sameSet(left, right) {
  if (left.length !== right.length) return false;
  const a = new Set(left);
  return a.size === right.length && right.every(value => a.has(value));
}
