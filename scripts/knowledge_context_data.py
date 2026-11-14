"""Build the compact, page-facing knowledge context from canonical registries."""
from pathlib import Path
import json


def build_knowledge_context(root: Path) -> dict:
    content = root / "content"

    def read(name: str) -> dict:
        return json.loads((content / f"{name}.json").read_text(encoding="utf-8"))

    knowledge = read("knowledge")
    works_manifest = read("works")
    learning_map = read("learning-map")
    search_manifest = read("search-metadata")

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

    return {
        "schemaVersion": 1,
        "topics": topics,
        "topicContexts": topic_contexts,
    }
