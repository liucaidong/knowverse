#!/usr/bin/env python3
"""Validate the Monorepo cross-pillar product and its manifest-derived graph."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
graph = json.loads((root / "data/monorepo-graph.json").read_text(encoding="utf-8"))
works = json.loads((root / "content/works.json").read_text(encoding="utf-8"))["works"]

nodes = {node["id"]: node for node in graph["nodes"]}
assert set(nodes) == {"api", "contracts", "domain", "mobile", "web"}, nodes
assert graph["build_layers"] == [["contracts"], ["domain"], ["api", "mobile", "web"]]
assert graph["build_order"] == ["contracts", "domain", "api", "mobile", "web"]
assert nodes["domain"]["dependencies"] == ["contracts"]
for app in ("api", "mobile", "web"):
    assert nodes[app]["kind"] == "app"
    assert nodes[app]["dependencies"] == ["contracts", "domain"]
assert nodes["contracts"]["dependencies"] == []

expected = {
    "monorepo-dependency-graph": ("lab", "./knowledge/monorepo/labs/graph/"),
    "monorepo-cache-key": ("lab", "./knowledge/monorepo/labs/cache/"),
    "monorepo-build-order": ("lab", "./knowledge/monorepo/labs/build/"),
    "monorepo-architecture-exhibition": ("gallery", "./gallery/exhibits/monorepo-architecture/"),
    "monorepo-dependency-quest": ("puzzles", "./puzzles/worlds/monorepo-quest/"),
}
indexed = {work["id"]: work for work in works}
for work_id, (pillar, href) in expected.items():
    assert work_id in indexed, f"Missing registered Monorepo work: {work_id}"
    item = indexed[work_id]
    assert item["pillar"] == pillar, item
    assert item["href"] == href, item
    assert "monorepo" in item["knowledge_ids"], item

for path in [
    "gallery/exhibits/monorepo-architecture/index.html",
    "puzzles/worlds/monorepo-quest/index.html",
    "assets/js/monorepo-world.js",
    "assets/js/monorepo-exhibition.js",
    "assets/js/monorepo-quest.js",
    "assets/js/monorepo-quest-core.mjs",
    "assets/js/monorepo-graph-model.mjs",
    "scripts/build-monorepo-graph.py",
    "scripts/verify-monorepo-product.mjs",
]:
    assert (root / path).is_file(), f"Missing Monorepo product file: {path}"

graph_lab = (root / "knowledge/monorepo/labs/graph/index.html").read_text(encoding="utf-8")
build_lab = (root / "knowledge/monorepo/labs/build/index.html").read_text(encoding="utf-8")
quest = (root / "puzzles/worlds/monorepo-quest/index.html").read_text(encoding="utf-8")
exhibit = (root / "gallery/exhibits/monorepo-architecture/index.html").read_text(encoding="utf-8")
assert "ui-adapter" not in graph_lab
assert "monorepo-labs.js" in graph_lab and "monorepo-labs.js" in build_lab
assert "data-quest-stage" in quest and "monorepo-quest.js" in quest
assert "monorepo-exhibition.js" in exhibit and "WEBGL" in exhibit
assert "knowledge_ids" not in graph_lab

print(
    "PASS: manifest-derived 5-package graph, 7 workspace edges, 3 build layers, "
    "3 lab experiments + 1 exhibition + 1 puzzle are connected to the Monorepo topic"
)
