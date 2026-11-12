import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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

test("AI Agent formal graph is evidence-backed and has an explicit prerequisite chain", async () => {
  const [map, concepts, sources, reviews] = await Promise.all([
    readJSON("../content/learning-map.json"),
    readJSON("../content/concepts.json"),
    readJSON("../content/sources.json"),
    readJSON("../content/review-assessments.json"),
  ]);
  const topic = map.topics.find(item => item.id === "ai-agents");
  assert.ok(topic);
  assert.deepEqual(topic.competencies.map(item => item.id), [
    "agent-architecture-selection",
    "agent-tool-execution-contract",
    "agent-safety-governance",
  ]);
  assert.deepEqual(topic.competencies[0].prerequisites, []);
  assert.deepEqual(topic.competencies[1].prerequisites, ["agent-architecture-selection"]);
  assert.deepEqual(topic.competencies[2].prerequisites, ["agent-tool-execution-contract"]);
  const conceptIds = new Set(concepts.concepts.map(item => item.id));
  for (const competency of topic.competencies) {
    const concept = concepts.concepts.find(item => item.competencyIds?.includes(competency.id));
    assert.ok(concept, `missing Concept for ${competency.id}`);
    assert.deepEqual(concept.prerequisites, competency.prerequisites.map(id => `ai-agents.${id}`));
    assert.ok(concept.learningObjectives.length >= 3);
    assert.ok(concept.sources.length > 0);
    for (const sourceId of concept.sources) {
      const source = sources.sources.find(item => item.id === sourceId);
      assert.ok(source && source.topics.includes("ai-agents"));
      assert.match(source.url, /^https:\/\//);
    }
    const variants = reviews.assessments.filter(item => item.competencyId === competency.id);
    assert.equal(variants.length, 2, `${competency.id} needs two independent review variants`);
    assert.ok(variants.every(item => item.topicId === "ai-agents" && item.sourceHref.startsWith("./knowledge/ai-agents/")));
  }
});

test("an AI Agent Learning Gap requires a distinct, independent no-hint review variant to resolve", async () => {
  const [map, challenges, registry] = await Promise.all([
    readJSON("../content/learning-map.json"),
    readJSON("../content/challenges.json"),
    readJSON("../content/review-assessments.json"),
  ]);
  const gapId = "agent-prompt-injection-authorization";
  const competencyId = "agent-safety-governance";
  const store = createLearningProgressStore({ storage: memoryStorage() });
  await store.appendMany([{
    id: "ai-agent-gap-seed",
    eventSchemaVersion: 3,
    type: "attempt",
    at: "2026-11-12T00:00:00.000Z",
    topicId: "ai-agents",
    challengeId: "ai-agent-security-seed",
    challengeTitle: "AI Agent 安全诊断",
    stepId: "prompt-injection-seed",
    stepTitle: "不可信上下文识别",
    competencyIds: [competencyId],
    sessionId: "ai-agent-security-seed-session",
    sessionType: "challenge",
    variantId: "ai-agent-security-seed-variant",
    attemptNumber: 1,
    correct: false,
    hintsUsed: 0,
    gapId,
    gapObservationId: "ai-agent-gap-seed",
    causationEventIds: [],
    targetGapEventIds: [],
  }]);
  const engine = createReviewSessionEngine({ progressStore: store, registry });
  const first = await engine.start({ competencyId, gapId });
  const wrong = first.options.find(option => option.gapId === gapId);
  assert.ok(wrong, "first variant must contain a targeted distractor");
  assert.equal((await engine.submit(first.sessionId, wrong.id)).correct, false);

  const second = await engine.start({ competencyId, gapId });
  assert.notEqual(second.variantId, first.variantId, "the retry must use a different assessment variant");
  assert.equal(second.hintsUsed, 0);
  assert.equal((await engine.submit(second.sessionId, second.answer)).correct, true);

  const insights = deriveLearningInsights(map, challenges, await store.load(), new Date("2026-11-12T00:00:00.000Z"));
  assert.ok(insights.resolvedGaps.some(item => item.id === gapId));
  assert.ok(!insights.gaps.some(item => item.id === gapId));
});
