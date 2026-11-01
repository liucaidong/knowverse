import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createLearningCheckpointEngine } from "../assets/js/learning-checkpoint-engine.mjs";
import { createLearningProgressStore, deriveLearningInsights } from "../assets/js/learning-progress.mjs";
import { createReviewSessionEngine } from "../assets/js/review-engine.mjs";

const readJSON = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

test("all live works declare a learning contract and use the shared integration entry", async () => {
  const works = await readJSON("../content/works.json");
  const knowledge = await readJSON("../content/knowledge.json");
  const map = await readJSON("../content/learning-map.json");
  const challenges = await readJSON("../content/challenges.json");
  const checkpoints = await readJSON("../content/learning-checkpoints.json");
  const topicIds = new Set(knowledge.topics.map(item => item.id));
  const competencyIds = new Set(map.topics.flatMap(topic => topic.competencies.map(item => item.id)));
  const challengeMap = new Map(challenges.challenges.map(item => [item.id, item]));
  const checkpointMap = new Map(checkpoints.checkpoints.map(item => [item.id, item]));
  assert.equal(works.pillars.length, 3);
  assert.equal(works.works.length, 17);
  assert.equal(checkpoints.checkpoints.length, 14);
  for (const work of works.works.filter(item => item.status === "live")) {
    assert.equal(work.learning.activityTracking, true, work.id);
    assert.ok(work.knowledge_ids.every(id => topicIds.has(id)), work.id);
    assert.ok(work.learning.competencyIds.length > 0, work.id);
    assert.ok(work.learning.competencyIds.every(id => competencyIds.has(id)), work.id);
    const assessment = work.learning.assessment;
    if (assessment.type === "challenge") {
      const challenge = challengeMap.get(assessment.challengeId);
      assert.ok(challenge, work.id);
      assert.equal(challenge.workId, work.id);
      const mapped = new Set(challenge.steps.flatMap(step => step.competencyIds || []));
      assert.ok(work.learning.competencyIds.every(id => mapped.has(id)), work.id);
    } else {
      const checkpoint = checkpointMap.get(assessment.checkpointId);
      assert.ok(checkpoint, work.id);
      assert.equal(checkpoint.workId, work.id);
      assert.ok(work.learning.competencyIds.includes(checkpoint.competencyId), work.id);
      const route = work.href.replace(/^\.\//, "") + "index.html";
      const html = await readFile(new URL("../" + route, import.meta.url), "utf8");
      assert.match(html, /learning-integration\.mjs/, work.id);
    }
  }
});

test("checkpoint errors create precise gaps but only independent Review can resolve them", async () => {
  const [map, challenges, checkpointRegistry, reviewRegistry] = await Promise.all([
    readJSON("../content/learning-map.json"),
    readJSON("../content/challenges.json"),
    readJSON("../content/learning-checkpoints.json"),
    readJSON("../content/review-assessments.json"),
  ]);
  const checkpoint = checkpointRegistry.checkpoints.find(item => item.id === "cp-monorepo-cache");
  const storage = memoryStorage();
  const store = createLearningProgressStore({ storage });
  const engine = createLearningCheckpointEngine({ store, registry: [checkpoint] });
  const session = engine.start(checkpoint.id);
  const wrong = checkpoint.options.find(item => item.gapId);
  const result = engine.submit(session.sessionId, wrong.id);
  assert.equal(result.correct, false);
  let insight = deriveLearningInsights(map, challenges, store.load(), new Date("2026-11-01T12:00:00.000Z"));
  let node = insight.competencyInsights.find(item => item.id === checkpoint.competencyId);
  assert.equal(node.evidenceCount, 0);
  assert.equal(node.status, "weak");
  assert.equal(node.activeGaps[0].id, "build-cache-input-coverage");

  const second = engine.start(checkpoint.id);
  engine.submit(second.sessionId, checkpoint.answer);
  insight = deriveLearningInsights(map, challenges, store.load(), new Date("2026-11-01T12:00:00.000Z"));
  node = insight.competencyInsights.find(item => item.id === checkpoint.competencyId);
  assert.equal(node.evidenceCount, 1);
  assert.equal(insight.gaps.length, 1, "checkpoint success must not clear a diagnosed gap");

  const review = createReviewSessionEngine({ storage, progressStore: store, registry: reviewRegistry });
  const reviewA = review.start({ competencyId: checkpoint.competencyId, gapId: "build-cache-input-coverage" });
  assert.equal(reviewA.hintsUsed, 0);
  const wrongReviewOption = reviewA.options.find(option => option.gapId === "build-cache-input-coverage");
  assert.equal(review.submit(reviewA.sessionId, wrongReviewOption.id).correct, false);
  const reviewB = review.start({ competencyId: checkpoint.competencyId, gapId: "build-cache-input-coverage" });
  assert.notEqual(reviewB.variantId, reviewA.variantId);
  assert.equal(review.submit(reviewB.sessionId, reviewB.answer).correct, true);
  insight = deriveLearningInsights(map, challenges, store.load(), new Date("2026-11-01T12:00:00.000Z"));
  assert.ok(insight.resolvedGaps.some(item => item.id === "build-cache-input-coverage"));
});

test("a correct checkpoint creates one independent no-hint evidence variant", async () => {
  const registry = await readJSON("../content/learning-checkpoints.json");
  const checkpoint = registry.checkpoints.find(item => item.id === "cp-promise-identity");
  const storage = memoryStorage();
  const store = createLearningProgressStore({ storage });
  const engine = createLearningCheckpointEngine({ store, registry: [checkpoint] });
  const session = engine.start(checkpoint.id);
  assert.equal(engine.submit(session.sessionId, checkpoint.answer).correct, true);
  const events = store.load().events;
  assert.equal(events.filter(item => item.type === "assessment_passed").length, 1);
  const passed = events.find(item => item.type === "assessment_passed");
  assert.equal(passed.sessionType, "checkpoint");
  assert.equal(passed.variantId, checkpoint.id);
  assert.equal(passed.hintsUsed, 0);
  assert.equal(passed.workId, checkpoint.workId);
});

test("the assessment catalog covers 9 competencies, 19 gaps and 40 targeted variants", async () => {
  const map = await readJSON("../content/learning-map.json");
  const registry = await readJSON("../content/review-assessments.json");
  const ids = new Set(map.topics.flatMap(topic => topic.competencies.map(item => item.id)));
  const gaps = new Set(map.gaps.map(item => item.id));
  assert.equal(ids.size, 9);
  assert.equal(gaps.size, 19);
  assert.equal(registry.assessments.length, 40);
  for (const item of registry.assessments) {
    assert.ok(ids.has(item.competencyId), item.id);
    assert.ok(item.gapIds.length > 0, item.id);
    assert.ok(item.gapIds.every(id => gaps.has(id)), item.id);
  }
});
