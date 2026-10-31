#!/usr/bin/env python3
"""KNOWVERSE V2 cross-linked static content validation without dependencies."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import json

root = Path(__file__).resolve().parents[1]


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []

    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if tag in ("a", "link", "script", "img"):
            url = data.get("href") if tag in ("a", "link") else data.get("src")
            if url:
                self.refs.append((tag, url))


missing = []
checked = 0
for file in root.rglob("*.html"):
    parser = Links()
    parser.feed(file.read_text(encoding="utf-8"))
    for kind, href in parser.refs:
        if href.startswith(("#", "http:", "https:", "mailto:", "tel:", "javascript:", "data:")):
            continue
        url = unquote(urlsplit(href).path)
        if not url:
            continue
        target = (file.parent / url).resolve()
        if not target.is_relative_to(root):
            missing.append((str(file.relative_to(root)), href, "path traversal"))
            continue
        if target.is_dir():
            target = target / "index.html"
        if not target.exists():
            missing.append((str(file.relative_to(root)), href, "missing"))
        checked += 1

panoramas = list((root / "assets/panoramas").glob("*.mmd"))
svgs = list((root / "assets/panoramas").glob("*.svg"))
assert len(panoramas) >= 12 and {item.stem for item in panoramas} == {item.stem for item in svgs}, (len(panoramas), len(svgs))
for diagram in panoramas:
    assert diagram.read_text(encoding="utf-8").startswith("flowchart LR"), diagram

search = json.loads((root / "data/search.json").read_text(encoding="utf-8"))
knowledge = json.loads((root / "content/knowledge.json").read_text(encoding="utf-8"))
metadata = json.loads((root / "content/search-metadata.json").read_text(encoding="utf-8"))
topic_ids = {topic["id"] for topic in knowledge["topics"]}
assert len(search) == len(metadata["records"]), "Generated search index and metadata counts differ"
assert len(search) >= 40, len(search)
assert len({item["href"] for item in search}) == len(search), "Duplicate search route"
for item in search:
    assert item["knowledge_id"] in topic_ids, item
    assert item["body"].strip(), item
    target = root / item["href"]
    assert (target / "index.html").is_file(), item["href"]

print(f"checked {checked} local links, {len(panoramas)} Mermaid panoramas, {len(search)} generated search records")
if missing:
    print("BROKEN LINKS:")
    for item in missing:
        print(*item)
    raise SystemExit(1)
