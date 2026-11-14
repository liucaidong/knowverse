"""Generate static topic and article context from canonical KNOWVERSE registries."""
from html import escape
from html.parser import HTMLParser
from pathlib import Path
import json
import re
from urllib.parse import urlsplit


def _read_json(content: Path, name: str) -> dict:
    return json.loads((content / f"{name}.json").read_text(encoding="utf-8"))


def build_knowledge_context(root: Path) -> dict:
    content = root / "content"
    knowledge = _read_json(content, "knowledge")
    works_manifest = _read_json(content, "works")
    learning_map = _read_json(content, "learning-map")
    search_manifest = _read_json(content, "search-metadata")

    topics = [
        {key: topic.get(key) for key in ("id", "title", "category", "summary")}
        for topic in knowledge.get("topics", [])
    ]
    map_topics = {topic.get("id"): topic for topic in learning_map.get("topics", [])}
    topic_contexts = {}

    for topic in knowledge.get("topics", []):
        topic_id = topic["id"]
        prefix = f"knowledge/{topic_id}/"
        records = []
        for record in search_manifest.get("records", []):
            href = record.get("href")
            if not isinstance(href, str):
                continue
            normalized = href.removeprefix("./")
            if normalized.startswith(prefix):
                records.append({"title": record.get("title"), "href": href})

        related_works = [
            {
                "title": work.get("title"),
                "kind": work.get("kind"),
                "href": work.get("href"),
                "pillar": work.get("pillar"),
            }
            for work in works_manifest.get("works", [])
            if work.get("status") in ("live", "planned")
            and topic_id in work.get("knowledge_ids", [])
        ]

        map_topic = map_topics.get(topic_id) or {}
        competencies = [
            {
                "id": competency.get("id"),
                "title": competency.get("title"),
                "prerequisites": competency.get("prerequisites") or [],
            }
            for competency in map_topic.get("competencies", [])
        ]
        topic_contexts[topic_id] = {
            "records": records,
            "works": related_works,
            "competencies": competencies,
        }

    return {"topics": topics, "topicContexts": topic_contexts}


def _href(root_href: str, value: str | None) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    path = value.removeprefix("./")
    parsed = urlsplit(path)
    if parsed.scheme or parsed.netloc or path.startswith("/") or path.startswith("../"):
        return None
    return root_href + path


def _link(root_href: str, href: str | None, label: str, class_name: str = "") -> str:
    target = _href(root_href, href)
    if not target:
        return ""
    class_attr = f' class="{escape(class_name, quote=True)}"' if class_name else ""
    return f'<a{class_attr} href="{escape(target, quote=True)}">{escape(str(label))}</a>'


def _render_competencies(competencies: list[dict]) -> str:
    if not competencies:
        return (
            '<p class="kv-context-note">本专题尚未建立正式的能力点先修图谱。'
            '当前只展示已登记的内容与互动作品关系，不把文章排列顺序误当作因果或必修顺序。</p>'
        )
    by_id = {item.get("id"): item for item in competencies}
    items = []
    edge_count = 0
    for index, item in enumerate(competencies, 1):
        prerequisites = item.get("prerequisites") or []
        edge_count += len(prerequisites)
        names = [by_id.get(value, {}).get("title") or value for value in prerequisites]
        note = "前置能力：" + "、".join(names) if names else "起点能力 · 无先修门槛"
        items.append(
            '<li class="kv-competency-item">'
            f'<span class="kv-competency-index">{index:02d}</span>'
            '<div class="kv-competency-body">'
            f'<strong>{escape(str(item.get("title") or ""))}</strong>'
            f'<small>{escape(note)}</small>'
            '</div></li>'
        )
    return (
        '<h3 class="kv-context-subtitle">能力点与前置关系</h3>'
        '<ol class="kv-competency-list">' + "".join(items) + '</ol>'
        f'<p class="kv-context-meta">{len(competencies)} 个能力点 · {edge_count} 条明确先修关系</p>'
    )


def _render_topic(topic: dict, context: dict, root_href: str) -> str:
    topic_id = str(topic["id"])
    competencies = context.get("competencies") or []
    records = context.get("records") or []
    works = context.get("works") or []
    content_links = []
    for record in records[:8]:
        link = _link(root_href, record.get("href"), record.get("title") or "")
        if link:
            content_links.append("<li>" + link + "</li>")
    if not content_links:
        content_links.append("<li>暂无单独登记的文章索引。</li>")

    learning_action = ""
    if competencies:
        learning_action = _link(
            root_href, "progress/#knowledge-map", "在学习驾驶舱查看掌握证据 ↗", "kv-context-action"
        )

    pillar_info = [
        ("lab", "01 · 原理实验室"),
        ("gallery", "02 · 沉浸展厅"),
        ("puzzles", "03 · 知识解谜"),
    ]
    groups = []
    for pillar_id, label in pillar_info:
        matches = [work for work in works if work.get("pillar") == pillar_id]
        links = [_link(root_href, work.get("href"), work.get("title") or "", "kv-topic-work-link") for work in matches]
        links = [link for link in links if link]
        body = "".join(links) if links else "<small>暂无关联作品</small>"
        groups.append(
            '<div class="kv-topic-work-group">'
            f'<strong>{escape(label)}</strong>{body}</div>'
        )

    summary = topic.get("summary") or "从这里进入本专题的文章、能力点和互动体验。"
    return (
        f'<section class="kv-topic-context" data-kv-topic-context="{escape(topic_id, quote=True)}">'
        '<div class="kv-topic-context-head"><div>'
        f'<span class="kv-topic-context-kicker">KNOWLEDGE DOMAIN / {escape(str(topic.get("category") or ""))}</span>'
        f'<h2>当前专题：{escape(str(topic.get("title") or ""))}</h2>'
        f'<p>{escape(str(summary))}</p>'
        '<span class="kv-topic-context-location">专题是知识归属；原理实验室、展厅和解谜是体验方式，两者不会互相替代。</span>'
        '</div>'
        + _link(root_href, "knowledge/", "返回全部知识专题 ↗", "kv-topic-back")
        + '</div><div class="kv-topic-context-grid">'
        '<section class="kv-context-panel"><span class="kv-context-kicker">LEARNING STRUCTURE</span>'
        + _render_competencies(competencies)
        + learning_action
        + '</section><section class="kv-context-panel">'
        '<span class="kv-context-kicker">CANONICAL CONTENT</span>'
        '<h3 class="kv-context-subtitle">本专题内容入口</h3>'
        '<p class="kv-context-note">文章是专题下的具体知识单元；这里提供入口，不在其他页面复制正文。</p>'
        '<ul class="kv-context-link-list">' + "".join(content_links) + '</ul>'
        + (f'<small class="kv-context-meta">另有 {len(records) - 8} 条相关索引，可通过全站搜索继续查找。</small>' if len(records) > 8 else "")
        + '</section></div><section class="kv-topic-works">'
        '<div class="kv-topic-works-head">关联互动体验</div>'
        '<p class="kv-context-note">同一专题可以同时进入实验、展览和解谜；作品通过 knowledge_ids 反向关联，不复制知识内容。</p>'
        '<div class="kv-topic-work-groups">' + "".join(groups) + '</div>'
        '</section></section>'
    )


def _normalize_path(path: str) -> str:
    path = re.sub(r"/index\.html$", "/", path)
    return path.rstrip("/") + "/"


def _render_article(topic: dict, context: dict, current_route: str, root_href: str) -> str:
    topic_id = str(topic["id"])
    competencies = context.get("competencies") or []
    records = context.get("records") or []
    works = context.get("works") or []
    edge_count = sum(len(item.get("prerequisites") or []) for item in competencies)
    if competencies:
        meta = (
            f"本专题已定义 {len(competencies)} 个能力点和 {edge_count} 条先修关系／"
            "个人掌握证据在学习驾驶舱统一记录。"
        )
    else:
        meta = "本专题当前通过文章索引和作品注册表组织内容；尚未定义正式的能力点先修关系。"

    current_normalized = _normalize_path("/" + current_route.lstrip("/"))
    sibling_links = []
    for record in records:
        href = record.get("href")
        if not isinstance(href, str):
            continue
        normalized_href = _normalize_path("/" + href.removeprefix("./").lstrip("/"))
        if normalized_href == current_normalized:
            continue
        link = _link(root_href, href, record.get("title") or "")
        if link:
            sibling_links.append(link)
        if len(sibling_links) == 5:
            break

    columns = []
    if sibling_links:
        columns.append(
            '<div class="kv-article-context-column"><strong>同专题内容</strong>'
            + "".join(sibling_links) + '</div>'
        )
    work_links = [
        _link(root_href, work.get("href"), work.get("title") or "")
        for work in works[:6]
    ]
    work_links = [link for link in work_links if link]
    if not work_links:
        work_links = ["<small>暂无已登记作品</small>"]
    columns.append(
        '<div class="kv-article-context-column"><strong>关联互动体验</strong>'
        + "".join(work_links) + '</div>'
    )

    return (
        f'<section class="kv-article-context" data-kv-article-context="{escape(topic_id, quote=True)}">'
        '<div class="kv-article-context-top"><span class="kv-context-kicker">YOU ARE HERE</span>'
        f'<strong>{escape(str(topic.get("title") or ""))}</strong>'
        + _link(root_href, "knowledge/" + topic_id + "/", "打开专题全景图 ↗", "kv-context-action")
        + '</div>'
        f'<p class="kv-article-context-meta">{escape(meta)}</p>'
        '<details class="kv-article-context-details"><summary>展开本专题相关内容与体验入口</summary>'
        '<div class="kv-article-context-links">' + "".join(columns) + '</div>'
        '</details></section>'
    )


class _PageHeadLocator(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self, source: str):
        super().__init__(convert_charrefs=False)
        self.source = source
        self.lines = source.splitlines(keepends=True)
        self.line_offsets = []
        offset = 0
        for line in self.lines:
            self.line_offsets.append(offset)
            offset += len(line)
        self.stack = []
        self.end_offset = None
        self.target_priority = 0
        self.main_start_offset = None

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        classes = (attributes.get("class") or "").split()
        priority = 3 if "pagehead" in classes else 2 if "breadcrumbs" in classes else 1 if "hero" in classes else 0
        if (tag == "main" or attributes.get("id") == "main") and self.main_start_offset is None:
            line, column = self.getpos()
            start = self.line_offsets[line - 1] + column
            self.main_start_offset = start + len(self.get_starttag_text() or "")
        if tag not in self.VOID:
            self.stack.append((tag, priority))

    def handle_startendtag(self, tag, attrs):
        return

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] != tag:
                continue
            _, priority = self.stack[index]
            del self.stack[index:]
            if priority > self.target_priority:
                line, column = self.getpos()
                start = self.line_offsets[line - 1] + column
                end = self.source.find(">", start)
                if end < 0:
                    raise ValueError("Could not locate context anchor closing tag")
                self.end_offset = end + 1
                self.target_priority = priority
            return


def _strip_context_markers(source: str) -> str:
    marker_start = "<!-- KNOWVERSE_CONTEXT_START -->"
    marker_end = "<!-- KNOWVERSE_CONTEXT_END -->"
    if marker_start in source and marker_end in source:
        start = source.index(marker_start)
        end = source.index(marker_end, start) + len(marker_end)
        if start > 0 and source[start - 1] == "\n":
            start -= 1
        if source[end:end + 2] == "\r\n":
            end += 2
        elif source[end:end + 1] == "\n":
            end += 1
        return source[:start] + source[end:]
    return source


def _context_slot_offset(source: str) -> int:
    locator = _PageHeadLocator(source)
    locator.feed(source)
    locator.close()
    if locator.end_offset is not None:
        return locator.end_offset
    if locator.main_start_offset is not None:
        return locator.main_start_offset
    raise ValueError("Knowledge page is missing a main/context insertion anchor")


def build_static_context_pages(root: Path) -> dict[Path, str]:
    context = build_knowledge_context(root)
    topics = {topic["id"]: topic for topic in context["topics"]}
    pages = {}
    knowledge_root = root / "knowledge"

    for page in sorted(knowledge_root.rglob("*.html")):
        relative = page.relative_to(root)
        parts = relative.parts
        if len(parts) < 3 or "node_modules" in parts or "project" in parts:
            continue
        topic_id = parts[1]
        topic = topics.get(topic_id)
        if not topic:
            continue
        topic_context = context["topicContexts"].get(topic_id) or {}
        depth = len(parts) - 1
        root_href = "../" * depth
        if page.parent == knowledge_root / topic_id:
            markup = _render_topic(topic, topic_context, root_href)
        else:
            if page.name == "index.html":
                current_route = page.parent.relative_to(root).as_posix() + "/"
            else:
                current_route = relative.as_posix()
            markup = _render_article(topic, topic_context, current_route, root_href)

        source = _strip_context_markers(page.read_text(encoding="utf-8"))
        offset = _context_slot_offset(source)
        marker_start = "<!-- KNOWVERSE_CONTEXT_START -->"
        marker_end = "<!-- KNOWVERSE_CONTEXT_END -->"
        updated = (
            source[:offset] + "\n" + marker_start + "\n" + markup + "\n"
            + marker_end + "\n" + source[offset:]
        )
        pages[page] = updated
    return pages
