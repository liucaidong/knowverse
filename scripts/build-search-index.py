#!/usr/bin/env python3
"""Build KNOWVERSE search index from curated metadata and canonical page content."""
from __future__ import annotations

import argparse
import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
METADATA = ROOT / "content/search-metadata.json"
KNOWLEDGE = ROOT / "content/knowledge.json"
CONCEPTS = ROOT / "content/concepts.json"
OUTPUT = ROOT / "data/search.json"
SKIP_TAGS = {"script", "style", "nav", "header", "footer", "noscript", "svg", "button"}
BLOCK_TAGS = {
    "address", "article", "aside", "blockquote", "br", "dd", "div", "dl",
    "dt", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6", "li",
    "main", "ol", "p", "pre", "section", "table", "td", "th", "tr", "ul",
}


class VisibleText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden_depth = 0
        self.search_overlay_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if self.search_overlay_depth:
            if tag == "div":
                self.search_overlay_depth += 1
            return
        if tag == "div" and (attributes.get("id") == "search-overlay" or "searchoverlay" in (attributes.get("class") or "").split()):
            self.search_overlay_depth = 1
            return
        if tag in SKIP_TAGS:
            self.hidden_depth += 1
            return
        if self.hidden_depth == 0 and tag in BLOCK_TAGS:
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if self.search_overlay_depth:
            if tag == "div":
                self.search_overlay_depth -= 1
            return
        if tag in SKIP_TAGS and self.hidden_depth:
            self.hidden_depth -= 1
            return
        if self.hidden_depth == 0 and tag in BLOCK_TAGS:
            self.parts.append(" ")

    def handle_data(self, data: str) -> None:
        if self.hidden_depth == 0 and self.search_overlay_depth == 0:
            self.parts.append(data)


def normalize(text: str) -> str:
    text = html.unescape(text).replace("\u00a0", " ")
    return re.sub(r"\s+", " ", text).strip()


def markdown_text(source: str) -> str:
    fence = re.escape(chr(96) * 3)
    source = re.sub(r"(?m)^---+\s*$", " ", source)
    source = re.sub(r"(?m)^" + fence + r"[^\n]*$", " ", source)
    source = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", source)
    source = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", source)
    source = re.sub(r"<https?://[^>]+>", " ", source)
    source = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", " ", source)
    source = re.sub(r"(?m)^\s*>\s?", " ", source)
    source = source.replace("**", " ").replace("__", " ")
    source = source.replace(chr(96), " ")
    return normalize(source)


def page_body(href: str) -> str:
    relative = href.removeprefix("./").lstrip("/")
    if not (relative.startswith("knowledge/") or relative.startswith("concept/")) or ".." in Path(relative).parts:
        raise ValueError(f"Search href must resolve inside knowledge/ or concept/: {href}")
    page_dir = (ROOT / relative.rstrip("/")).resolve()
    allowed_roots = ((ROOT / "knowledge").resolve(), (ROOT / "concept").resolve())
    if not any(page_dir.is_relative_to(allowed) for allowed in allowed_roots):
        raise ValueError(f"Search href escapes public knowledge content: {href}")
    markdown = page_dir / "index.md"
    if markdown.is_file():
        body = markdown_text(markdown.read_text(encoding="utf-8"))
    else:
        page = page_dir / "index.html"
        if not page.is_file():
            raise FileNotFoundError(f"Missing search page for {href}")
        parser = VisibleText()
        parser.feed(page.read_text(encoding="utf-8"))
        body = normalize(" ".join(parser.parts))
    if not body:
        raise ValueError(f"Extracted empty search body for {href}")
    return body


def build() -> list[dict[str, str]]:
    metadata = json.loads(METADATA.read_text(encoding="utf-8"))
    knowledge = json.loads(KNOWLEDGE.read_text(encoding="utf-8"))
    concepts = json.loads(CONCEPTS.read_text(encoding="utf-8"))
    topic_by_id = {topic["id"]: topic for topic in knowledge["topics"]}
    topic_ids = set(topic_by_id)
    records: list[dict[str, str]] = []
    seen: set[str] = set()

    for item in metadata["records"]:
        href = item["href"]
        if href in seen:
            raise ValueError(f"Duplicate search href: {href}")
        seen.add(href)
        parts = Path(href).parts
        if len(parts) < 2 or parts[0] != "knowledge":
            raise ValueError(f"Invalid knowledge route: {href}")
        knowledge_id = parts[1]
        if knowledge_id not in topic_ids:
            raise ValueError(f"Unknown knowledge topic {knowledge_id}: {href}")
        records.append({
            "title": item["title"],
            "topic": item["topic"],
            "summary": item["summary"],
            "tags": item["tags"],
            "body": page_body(href),
            "href": href,
            "knowledge_id": knowledge_id,
        })

    for concept in concepts["concepts"]:
        topic = topic_by_id.get(concept["topicId"])
        if topic is None:
            raise ValueError(f"Unknown topic for concept search entry: {concept['id']}")
        href = f"concept/{concept['id']}/"
        if href in seen:
            raise ValueError(f"Duplicate search href: {href}")
        seen.add(href)
        records.append({
            "title": concept["title"],
            "topic": topic.get("category", topic["title"]),
            "summary": concept["summary"],
            "tags": " ".join([topic.get("short_title", topic["title"]), concept["id"], "Concept"]),
            "body": page_body(href),
            "href": href,
            "knowledge_id": concept["topicId"],
            "concept_id": concept["id"],
        })
    return records


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if committed index differs from generated output")
    args = parser.parse_args()
    generated = json.dumps(build(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != generated:
            print("Search index is stale. Run: python3 scripts/build-search-index.py")
            return 1
        print(f"Search index is current: {len(json.loads(generated))} records")
        return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(generated, encoding="utf-8")
    print(f"Built deterministic search index: {len(json.loads(generated))} records")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
