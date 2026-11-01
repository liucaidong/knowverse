import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createLearningProgressStore, deriveLearningInsights } from "../assets/js/learning-progress.mjs";
import { createReviewSessionEngine } from "../assets/js/review-engine.mjs";

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
    values,
  };
}

const fixtureMap = {
  topics: [{
    id: "promise",
    title: "Promise",
    href: "./knowledge/promise/",
    challengeId: "campaign",
    competencies: [{
      id: "thenable-adoption",
      title: "Thenable 解析与采用",
      prerequisites: [],
      lessonHref: "./knowledge/promise/",
      challengeHref: "./puzzles/",
    }],
  }],
  gaps: [{
    id: "thenable-get-vs-call",
    label: "then 属性读取与调用混淆",
    description: "Getter 同步读取，函数由 ThenableJob 调用。",
    challengeId: "campaign",
  }],
};
const campaignFailure = {
  id: "campaign:attempt:thenable:1",
  eventSchemaVersion: 2,
  type: "attempt",
  at: "2026-11-01T10:00:00.000Z",
  topicId: "promise",
  challengeId: "campaign",
  challengeTitle: "原始挑战",
  stepId: "thenable",
  stepTitle: "Thenable",
  competencyIds: ["thenable-adoption"],
  sessionId: "campaign-run-1",
  sessionType: "campaign",
  variantId: "campaign:thenable",
  attemptNumber: 1,
  correct: false,
  gapId: "thenable-get-vs-call",
  hintsUsed: 0,
};
const testRegistry = {
  assessments: [
    {
      id: "review-variant-a",
      competencyId: "thenable-adoption",
      topicId: "promise",
      gapIds: ["thenable-get-vs-call"],
      title: "变体 A · 属性读取与函数调用",
      prompt: "哪一个步骤同步发生？",
      options: [{ id: "wrong", label: "then 函数一定同步调用。", gapId: "thenable-get-vs-call" }, { id: "right", label: "then getter 的读取同步发生。"}],
      answer: "right",
      hints: ["把 getter 与 then 函数调用分开。"],
      explanation: "读取属性同步发生，函数调用在 ThenableJob。",
    },
    {
      id: "review-variant-b",
      competencyId: "thenable-adoption",
      topicId: "promise",
      gapIds: ["thenable-get-vs-call"],
      title: "变体 B · 执行时序",
      prompt: "start、get、end、call 的正确顺序是什么？",
      code: "Promise.resolve(thenable); console.log('end');",
      options: [{ id: "wrong", label: "start → end → get → call", gapId: "thenable-get-vs-call" }, { id: "right", label: "start → get → end → call" }],
      answer: "right",
      hints: ["getter 同步读取；then 函数通过 Job 调用。"],
      explanation: "正确顺序是 start → get → end → call。",
    },
  ],
};

test("v1 snapshots migrate to v2 without changing or dropping historical events", () => {
  const legacy = {
    schemaVersion: 1,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    events: [{
      id: "legacy-event",
      type: "completed",
      at: "2026-10-20T00:00:00.000Z",
      challengeId: "old-challenge",
      stepId: "old-step",
      competencyIds: ["thenable-adoption"],
      scorePct: 90,
    }],
  };
  const storage = memoryStorage({ "knowverse:learning-progress:v1": JSON.stringify(legacy) });
  const store = createLearningProgressStore({ storage });
  const snapshot = store.load();
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].id, "legacy-event");
  assert.equal(snapshot.events[0].eventSchemaVersion, 2);
  assert.equal(snapshot.events[0].sessionType, "campaign");
  assert.equal(store.appendMany([{ ...campaignFailure, id: "new-event" }]), true);
  assert.equal(store.load().events.length, 2);
  assert.ok(storage.getItem("knowverse:learning-progress:v2"));
});

test("event history is not silently truncated at an arbitrary event count", () => {
  const store = createLearningProgressStore({ storage: memoryStorage() });
  const events = Array.from({ length: 5200 }, (_, index) => ({
    id: "event-" + index,
    type: "activity",
    at: "2026-11-01T10:00:00.000Z",
    challengeId: "activity:gallery",
    stepId: "page_view",
    competencyIds: [],
    sessionType: "exploration",
    sessionId: "session-1",
  }));
  assert.equal(store.appendMany(events), true);
  assert.equal(store.load().events.length, 5200);
  assert.equal(store.load().events[0].id, "event-0");
  assert.equal(store.load().events.at(-1).id, "event-5199");
});

test("exploration activity never counts as mastery evidence", () => {
  const store = createLearningProgressStore({ storage: memoryStorage() });
  store.appendMany([{
    id: "gallery-view",
    type: "activity",
    at: "2026-11-01T10:00:00.000Z",
    topicId: "immersive-gallery",
    challengeId: "activity:immersive-gallery",
    stepId: "page_view",
    competencyIds: [],
    sessionType: "exploration",
  }]);
  const result = deriveLearningInsights(fixtureMap, { challenges: [] }, store.load(), new Date("2026-11-01T11:00:00.000Z"));
  assert.equal(result.competencyInsights[0].evidenceCount, 0);
  assert.equal(result.competencyInsights[0].masteryScore, null);
  assert.equal(result.competencyInsights[0].status, "unverified");
});

test("a hint-assisted pass leaves the gap pending; a different no-hint review variant resolves only that gap", () => {
  const storage = memoryStorage();
  const progressStore = createLearningProgressStore({ storage });
  assert.equal(progressStore.appendMany([campaignFailure]), true);
  const engine = createReviewSessionEngine({ storage, progressStore, registry: testRegistry });

  const first = engine.start({ competencyId: "thenable-adoption", gapId: "thenable-get-vs-call" });
  assert.equal(first.variantId, "review-variant-a");
  const hint = engine.revealHint(first.sessionId);
  assert.equal(hint.hint, testRegistry.assessments[0].hints[0]);
  const assisted = engine.submit(first.sessionId, "right");
  assert.equal(assisted.correct, true);
  assert.equal(assisted.session.hintsUsed, 1);

  let result = deriveLearningInsights(fixtureMap, { challenges: [] }, progressStore.load(), new Date("2026-11-01T12:00:00.000Z"));
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].lifecycle, "pending-verification");
  assert.equal(result.competencyInsights[0].status, "weak");
  assert.equal(result.reviewQueue[0].kind, "gap");

  const second = engine.start({ competencyId: "thenable-adoption", gapId: "thenable-get-vs-call" });
  assert.equal(second.variantId, "review-variant-b");
  const independent = engine.submit(second.sessionId, "right");
  assert.equal(independent.correct, true);
  assert.equal(independent.session.hintsUsed, 0);

  result = deriveLearningInsights(fixtureMap, { challenges: [] }, progressStore.load(), new Date("2026-11-01T12:00:00.000Z"));
  assert.equal(result.gaps.length, 0);
  assert.equal(result.resolvedGaps.length, 1);
  assert.equal(result.resolvedGaps[0].id, "thenable-get-vs-call");
  assert.equal(result.resolvedGaps[0].verificationVariantId, "review-variant-b");
  assert.equal(result.competencyInsights[0].status, "initial");
  assert.equal(engine.getHistory().length, 2);

  const importedStorage = memoryStorage();
  const importedStore = createLearningProgressStore({ storage: importedStorage });
  const importResult = importedStore.importJSON(progressStore.exportJSON());
  const importedEngine = createReviewSessionEngine({ storage: importedStorage, progressStore: importedStore, registry: testRegistry });
  assert.equal(importResult.total, progressStore.load().events.length);
  assert.equal(importedEngine.getHistory().length, 2);
  assert.deepEqual(importedEngine.getHistory().map(item => item.variantId).sort(), ["review-variant-a","review-variant-b"]);
});

test("same-variant no-hint repetition cannot clear a pending gap", () => {
  const storage = memoryStorage();
  const progressStore = createLearningProgressStore({ storage });
  progressStore.appendMany([campaignFailure]);
  const engine = createReviewSessionEngine({ storage, progressStore, registry: testRegistry });
  const assisted = engine.start({ competencyId: "thenable-adoption", gapId: "thenable-get-vs-call", variantId: "review-variant-a" });
  engine.revealHint(assisted.sessionId);
  engine.submit(assisted.sessionId, "right");
  const repeat = engine.start({ competencyId: "thenable-adoption", gapId: "thenable-get-vs-call", variantId: "review-variant-a" });
  engine.submit(repeat.sessionId, "right");
  const result = deriveLearningInsights(fixtureMap, { challenges: [] }, progressStore.load(), new Date("2026-11-01T12:00:00.000Z"));
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].lifecycle, "pending-verification");
});

test("the assessment catalog covers every tracked gap/competency pair with two targeted variants", async () => {
  const map = JSON.parse(await readFile(new URL("../content/learning-map.json", import.meta.url), "utf8"));
  const registry = JSON.parse(await readFile(new URL("../content/review-assessments.json", import.meta.url), "utf8"));
  const challenges = JSON.parse(await readFile(new URL("../content/challenges.json", import.meta.url), "utf8"));
  const tracked = map.topics.flatMap(topic => topic.competencies.map(item => item.id));
  const byCompetency = new Map();
  const gapVariants = new Map();
  const reviewPairs = new Map();
  const gapIds = new Set(map.gaps.map(gap => gap.id));
  registry.assessments.forEach(item => {
    assert.ok(tracked.includes(item.competencyId), "unknown competency: " + item.competencyId);
    assert.ok(Array.isArray(item.gapIds) && item.gapIds.length > 0, "assessment must target a gap: " + item.id);
    assert.ok(item.gapIds.every(id => gapIds.has(id)), "unknown gap in " + item.id);
    const variants = byCompetency.get(item.competencyId) || [];
    variants.push(item.id);
    byCompetency.set(item.competencyId, variants);
    for (const gapId of item.gapIds) {
      const mapped = gapVariants.get(gapId) || new Set();
      mapped.add(item.id);
      gapVariants.set(gapId, mapped);
      const key = gapId + "::" + item.competencyId;
      const pair = reviewPairs.get(key) || new Set();
      pair.add(item.id);
      reviewPairs.set(key, pair);
    }
  });
  const sourcePairs = new Set();
  for (const gap of map.gaps) {
    assert.ok(Array.isArray(gap.competencyIds) && gap.competencyIds.length > 0, "gap must map to at least one competency: " + gap.id);
    for (const competencyId of gap.competencyIds) {
      assert.ok(tracked.includes(competencyId), "gap maps to unknown competency: " + gap.id);
      sourcePairs.add(gap.id + "::" + competencyId);
    }
  }
  for (const challenge of challenges.challenges) {
    for (const step of challenge.steps || []) {
      for (const option of step.options || []) {
        if (!option.gapId) continue;
        for (const competencyId of step.competencyIds || []) {
          assert.ok(map.gaps.find(gap => gap.id === option.gapId)?.competencyIds.includes(competencyId),
            "challenge gap mapping must agree with learning map: " + option.gapId + "::" + competencyId);
        }
      }
    }
  }
  assert.equal(tracked.length, 15);
  assert.equal(registry.assessments.length, 72);
  assert.equal(gapVariants.size, map.gaps.length);
  assert.equal(map.gaps.length, 31);
  for (const id of tracked) assert.ok((byCompetency.get(id)?.length || 0) >= 2, "expected at least 2 variants for " + id);
  for (const [gapId, variants] of gapVariants) assert.ok(variants.size >= 2, "gap needs two independent variants: " + gapId);
  for (const key of sourcePairs) assert.ok((reviewPairs.get(key)?.size || 0) >= 2, "gap/competency mapping needs two targeted variants: " + key);
});


test("a generic competency review cannot accidentally resolve a specific active gap", () => {
  const storage = memoryStorage();
  const progressStore = createLearningProgressStore({ storage });
  progressStore.appendMany([campaignFailure]);
  const engine = createReviewSessionEngine({ storage, progressStore, registry: testRegistry });
  const session = engine.start({ competencyId: "thenable-adoption" });
  const result = engine.submit(session.sessionId, "right");
  assert.equal(result.correct, true);
  const snapshot = progressStore.load();
  const genericPass = snapshot.events.find(event => event.type === "assessment_passed");
  assert.equal(genericPass.gapId, null);
  const insight = deriveLearningInsights(fixtureMap, { challenges: [] }, snapshot, new Date("2026-11-01T12:00:00.000Z"));
  assert.equal(insight.gaps.length, 1);
  assert.equal(insight.gaps[0].id, "thenable-get-vs-call");
});


test("a failed targeted review must be followed by a different variant, not a retry of the same item", () => {
  const storage = memoryStorage();
  const progressStore = createLearningProgressStore({ storage });
  progressStore.appendMany([campaignFailure]);
  const engine = createReviewSessionEngine({ storage, progressStore, registry: testRegistry });

  const failed = engine.start({ competencyId: "thenable-adoption", gapId: "thenable-get-vs-call", variantId: "review-variant-a" });
  engine.submit(failed.sessionId, "wrong");

  const retry = engine.start({ competencyId: "thenable-adoption", gapId: "thenable-get-vs-call", variantId: "review-variant-a" });
  engine.submit(retry.sessionId, "right");
  let insight = deriveLearningInsights(fixtureMap, { challenges: [] }, progressStore.load(), new Date("2026-11-01T12:00:00.000Z"));
  assert.equal(insight.gaps.length, 1, "same-variant retry must not resolve the gap");

  const different = engine.start({ competencyId: "thenable-adoption", gapId: "thenable-get-vs-call", variantId: "review-variant-b" });
  engine.submit(different.sessionId, "right");
  insight = deriveLearningInsights(fixtureMap, { challenges: [] }, progressStore.load(), new Date("2026-11-01T12:00:00.000Z"));
  assert.equal(insight.gaps.length, 0, "a new no-hint variant should resolve the gap");
});
