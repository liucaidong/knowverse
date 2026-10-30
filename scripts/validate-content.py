#!/usr/bin/env python3
"""Validate KNOWVERSE static-site references and content registry."""
import json
from pathlib import Path
from urllib.parse import unquote, urlsplit

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "content/works.json").read_text(encoding="utf-8"))
works = manifest["works"]
ids = [work["id"] for work in works]
assert len(ids) == len(set(ids)), "Duplicate work IDs"
pillars = {p["id"] for p in manifest["pillars"]}
for work in works:
    assert work["pillar"] in pillars, work
    assert work["status"] in ("live", "planned", "archived"), work
    href = unquote(urlsplit(work["href"]).path)
    assert href.startswith("./"), href
    page = (root / href[2:]).resolve()
    assert page.is_relative_to(root.resolve()), href
    assert (page / "index.html").is_file() if href.endswith("/") else page.is_file(), f"Missing work page: {href}"
for path in ["index.html","lab/index.html","gallery/index.html","puzzles/index.html",
             "puzzles/worlds/first-realm/index.html"]:
    assert (root / path).is_file(), f"Missing page: {path}"
print(f"OK: {len(works)} published work entries, {len(pillars)} pillars, core pages present")
