#!/usr/bin/env python3
"""Validate KNOWVERSE static-site routes and the shared work registry."""
import json
from pathlib import Path
from urllib.parse import unquote, urlsplit

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "content/works.json").read_text(encoding="utf-8"))
works = manifest["works"]
pillars = {pillar["id"]: pillar for pillar in manifest["pillars"]}

ids = [work["id"] for work in works]
assert len(ids) == len(set(ids)), "Duplicate work IDs"

live_routes = []
for work in works:
    assert work["pillar"] in pillars, work
    assert work["status"] in ("live", "planned", "archived"), work
    href = unquote(urlsplit(work["href"]).path)
    assert href.startswith("./"), href
    page = (root / href[2:]).resolve()
    assert page.is_relative_to(root.resolve()), href
    target = page / "index.html" if href.endswith("/") else page
    assert target.is_file(), f"Missing work page: {href}"
    if work["status"] == "live":
        assert href not in ("./lab/", "./gallery/", "./puzzles/"), (
            f"Live work must link to a dedicated experience, not a pillar hub: {work['id']}"
        )
        live_routes.append(href)

assert len(live_routes) == len(set(live_routes)), "Two live works share the same route"
for pillar_id in pillars:
    assert any(work["pillar"] == pillar_id and work["status"] == "live" for work in works), (
        f"No live work registered for pillar: {pillar_id}"
    )
    page = root / pillar_id / "index.html"
    assert page.is_file(), f"Missing pillar page: {page}"
    html = page.read_text(encoding="utf-8")
    assert f'data-pillar="{pillar_id}"' in html, f"Pillar page is not connected to registry: {pillar_id}"
    assert "assets/js/catalog.js" in html, f"Missing shared catalog script: {pillar_id}"

for path in [
    "index.html", "works/index.html", "lab/index.html", "gallery/index.html",
    "puzzles/index.html", "puzzles/worlds/first-realm/index.html"
]:
    assert (root / path).is_file(), f"Missing page: {path}"

home = (root / "index.html").read_text(encoding="utf-8")
assert 'href="./works/"' in home, "Homepage must link to the full work catalogue"
print(
    f"OK: {len(works)} registered works, {len(live_routes)} unique live routes, "
    f"{len(pillars)} product pillars"
)
