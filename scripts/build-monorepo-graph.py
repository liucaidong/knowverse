#!/usr/bin/env python3
"""Generate a deterministic workspace dependency graph from the verified full-stack project."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "knowledge/monorepo/fullstack/project"
OUTPUT = ROOT / "data/monorepo-graph.json"


def build_graph() -> dict:
    root_package = json.loads((PROJECT / "package.json").read_text(encoding="utf-8"))
    package_files = sorted(
        list((PROJECT / "apps").glob("*/package.json"))
        + list((PROJECT / "packages").glob("*/package.json"))
    )
    if not package_files:
        raise ValueError("No app or package manifests found in the Monorepo reference project")

    manifests = []
    names = set()
    for manifest_path in package_files:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        name = data.get("name")
        if not name or name in names:
            raise ValueError(f"Missing or duplicate workspace package name: {manifest_path}")
        names.add(name)
        manifests.append((manifest_path, data))

    id_by_name = {data["name"]: data["name"].split("/")[-1] for _, data in manifests}
    nodes = []
    for manifest_path, data in manifests:
        relative = manifest_path.parent.relative_to(PROJECT).as_posix()
        dependencies = data.get("dependencies", {})
        local_dependencies = sorted(
            id_by_name[name] for name in dependencies if name in id_by_name
        )
        for name in dependencies:
            if name in id_by_name and not str(dependencies[name]).startswith("workspace:"):
                raise ValueError(
                    f"Local dependency {name} in {relative} must use workspace: protocol"
                )
        nodes.append({
            "id": id_by_name[data["name"]],
            "name": data["name"],
            "path": relative,
            "kind": "app" if relative.startswith("apps/") else "package",
            "dependencies": local_dependencies,
            "scripts": sorted(data.get("scripts", {}).keys()),
        })
    nodes.sort(key=lambda item: item["id"])

    ids = {node["id"] for node in nodes}
    for node in nodes:
        unknown = set(node["dependencies"]) - ids
        if unknown:
            raise ValueError(f"Unknown local dependencies for {node['id']}: {sorted(unknown)}")

    remaining = set(ids)
    built = set()
    layers = []
    while remaining:
        ready = sorted(
            node["id"] for node in nodes
            if node["id"] in remaining and set(node["dependencies"]).issubset(built)
        )
        if not ready:
            raise ValueError(f"Workspace dependency cycle detected: {sorted(remaining)}")
        layers.append(ready)
        built.update(ready)
        remaining.difference_update(ready)

    edges = [
        {"consumer": node["id"], "dependency": dependency}
        for node in nodes
        for dependency in node["dependencies"]
    ]
    return {
        "schema_version": 1,
        "source": "knowledge/monorepo/fullstack/project",
        "package_manager": root_package.get("packageManager", "pnpm"),
        "nodes": nodes,
        "edges": edges,
        "build_layers": layers,
        "build_order": [node_id for layer in layers for node_id in layer],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if committed graph differs from manifests")
    args = parser.parse_args()
    generated = json.dumps(build_graph(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != generated:
            print("Monorepo graph is stale. Run: python3 scripts/build-monorepo-graph.py")
            return 1
        print(f"Monorepo graph is current: {len(json.loads(generated)['nodes'])} packages")
        return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(generated, encoding="utf-8")
    print(f"Built Monorepo graph: {len(json.loads(generated)['nodes'])} packages, "
          f"{len(json.loads(generated)['edges'])} edges")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
