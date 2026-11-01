#!/usr/bin/env python3
"""Validate KNOWVERSE knowledge, work, pillar and local route relationships."""
import json
import os
from pathlib import Path
from urllib.parse import unquote, urlsplit

root = Path(__file__).resolve().parents[1]
work_manifest = json.loads((root / "content/works.json").read_text(encoding="utf-8"))
learning_map = json.loads((root / "content/learning-map.json").read_text(encoding="utf-8"))
challenge_registry = json.loads((root / "content/challenges.json").read_text(encoding="utf-8"))
checkpoint_registry = json.loads((root / "content/learning-checkpoints.json").read_text(encoding="utf-8"))
knowledge_manifest = json.loads((root / "content/knowledge.json").read_text(encoding="utf-8"))
works = work_manifest["works"]
pillars = {pillar["id"]: pillar for pillar in work_manifest["pillars"]}
topics = knowledge_manifest["topics"]
topic_map = {topic["id"]: topic for topic in topics}

assert len(pillars) == 3, "KNOWVERSE must keep its three product pillars"
assert len(topic_map) == len(topics), "Duplicate knowledge topic IDs"
assert len(pillars) == len(work_manifest["pillars"]), "Duplicate pillar IDs"
assert len({work["id"] for work in works}) == len(works), "Duplicate work IDs"

for topic in topics:
    assert topic["href"].startswith("./knowledge/"), topic
    assert isinstance(topic.get("featured"), bool), topic
    assert isinstance(topic.get("tags"), list), topic
    href = unquote(urlsplit(topic["href"]).path)
    page = (root / href[2:]).resolve()
    assert page.is_relative_to((root / "knowledge").resolve()), topic
    target = page / "index.html" if href.endswith("/") else page
    assert target.is_file(), f"Missing knowledge topic page: {topic['id']}"
    landing = page / "index.html"
    html = landing.read_text(encoding="utf-8")
    assert "knowledge-graph.js" in html, f"Topic page is not connected to the knowledge graph: {topic['id']}"
    assert "knowledge-graph.css" in html, f"Missing relationship styles: {topic['id']}"

live_routes = []
reverse_links = {topic_id: [] for topic_id in topic_map}
for work in works:
    assert work["pillar"] in pillars, work
    assert work["status"] in ("live", "planned", "archived"), work
    knowledge_ids = work.get("knowledge_ids")
    assert isinstance(knowledge_ids, list) and knowledge_ids, f"Work must declare its knowledge relationship: {work['id']}"
    assert len(knowledge_ids) == len(set(knowledge_ids)), f"Duplicate knowledge relationships: {work['id']}"
    for topic_id in knowledge_ids:
        assert topic_id in topic_map, f"Unknown topic {topic_id} in work {work['id']}"
        reverse_links[topic_id].append(work["id"])

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
for pillar_id, pillar in pillars.items():
    assert pillar.get("href") == f"./{pillar_id}/", f"Missing canonical pillar route: {pillar_id}"
    assert any(work["pillar"] == pillar_id and work["status"] == "live" for work in works), (
        f"No live work registered for pillar: {pillar_id}"
    )
    page = root / pillar_id / "index.html"
    assert page.is_file(), f"Missing pillar page: {page}"
    html = page.read_text(encoding="utf-8")
    assert f'data-pillar="{pillar_id}"' in html, f"Pillar page is not connected to registry: {pillar_id}"
    assert "assets/js/catalog.js" in html, f"Missing shared catalog script: {pillar_id}"

for path in [
    "index.html", "knowledge/index.html", "works/index.html",
    "lab/index.html", "gallery/index.html", "puzzles/index.html",
    "puzzles/worlds/first-realm/index.html"
]:
    assert (root / path).is_file(), f"Missing page: {path}"

home = (root / "index.html").read_text(encoding="utf-8")
assert 'data-pillar-catalog' in home, "Homepage pillar cards must use the shared pillar registry"
assert 'data-knowledge-catalog="featured"' in home, "Homepage featured topics must use the knowledge registry"
knowledge_home = (root / "knowledge/index.html").read_text(encoding="utf-8")
assert 'data-knowledge-catalog="all"' in knowledge_home, "Knowledge directory must use the shared knowledge registry"
assert "knowledge-graph.js" in home and "knowledge-graph.js" in knowledge_home


# A single learning contract connects every work to activity, competency and evidence.
competencies = {
    item["id"]: topic["id"]
    for topic in learning_map["topics"]
    for item in topic["competencies"]
}
challenges = {item["id"]: item for item in challenge_registry["challenges"]}
checkpoints = {item["id"]: item for item in checkpoint_registry["checkpoints"]}
assert len(checkpoints) == len(checkpoint_registry["checkpoints"]), "Duplicate checkpoint IDs"
checkpoint_work_ids = set()
for work in works:
    learning = work.get("learning")
    assert isinstance(learning, dict), f"Work is missing its learning contract: {work['id']}"
    assert learning.get("activityTracking") is True, f"Work must track privacy-safe activity: {work['id']}"
    competency_ids = learning.get("competencyIds")
    assert isinstance(competency_ids, list) and competency_ids, f"Work must declare competencies: {work['id']}"
    assert len(competency_ids) == len(set(competency_ids)), f"Duplicate competency links: {work['id']}"
    assert all(item in competencies for item in competency_ids), f"Unknown competency in work: {work['id']}"
    assessment = learning.get("assessment", {})
    if assessment.get("type") == "challenge":
        challenge = challenges.get(assessment.get("challengeId"))
        assert challenge, f"Unknown challenge for work: {work['id']}"
        assert challenge.get("workId") == work["id"], f"Challenge/work identity mismatch: {work['id']}"
        mapped = {item for step in challenge["steps"] for item in step.get("competencyIds", [])}
        assert set(competency_ids).issubset(mapped), f"Challenge does not assess all declared competencies: {work['id']}"
    elif assessment.get("type") == "checkpoint":
        checkpoint_id = assessment.get("checkpointId")
        checkpoint = checkpoints.get(checkpoint_id)
        assert checkpoint, f"Unknown checkpoint for work: {work['id']}"
        assert checkpoint["workId"] == work["id"], f"Checkpoint/work identity mismatch: {work['id']}"
        assert checkpoint["competencyId"] in competency_ids, f"Checkpoint competency is not declared by work: {work['id']}"
        assert work["id"] not in checkpoint_work_ids, f"Duplicate checkpoint work mapping: {work['id']}"
        checkpoint_work_ids.add(work["id"])
    else:
        raise AssertionError(f"Live work needs a challenge or checkpoint assessment: {work['id']}")

    href = unquote(urlsplit(work["href"]).path)
    page = (root / href[2:]).resolve()
    target = page / "index.html" if href.endswith("/") else page
    relative_module = Path(os.path.relpath(root / "assets/js/learning-integration.mjs", target.parent)).as_posix()
    html = target.read_text(encoding="utf-8")
    assert relative_module in html, f"Work is not connected to the unified learning integration: {work['id']}"

assert checkpoint_work_ids == {
    work["id"] for work in works
    if work["status"] == "live" and work["learning"]["assessment"]["type"] == "checkpoint"
}, "Checkpoint work registration is incomplete"
for checkpoint in checkpoint_registry["checkpoints"]:
    assert checkpoint["workId"] in {work["id"] for work in works}, checkpoint
    assert checkpoint["competencyId"] in competencies, checkpoint
    assert len({option["id"] for option in checkpoint["options"]}) == len(checkpoint["options"]), checkpoint
    assert any(option["id"] == checkpoint["answer"] for option in checkpoint["options"]), checkpoint
    for option in checkpoint["options"]:
        if option.get("gapId"):
            gap = next((item for item in learning_map["gaps"] if item["id"] == option["gapId"]), None)
            assert gap and checkpoint["competencyId"] in gap["competencyIds"], checkpoint

metadata = json.loads((root / "content/search-metadata.json").read_text(encoding="utf-8"))
assert len(metadata["records"]) >= 40, "Curated search metadata is unexpectedly small"
print(
    f"OK: {len(topics)} knowledge topics, {len(works)} registered works, "
    f"{len(live_routes)} unique live routes, {len(pillars)} pillars, "
    f"{sum(bool(ids) for ids in reverse_links.values())} topics with linked experiences"
)
