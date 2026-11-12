import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { countLearningEvents, countOutbox, deleteLocalDatabaseForTests, getLearningDocument } from "../assets/js/backend/local-event-store.mjs";
import { resetLearningRepositoryForTests } from "../assets/js/backend/learning-repository.mjs";

beforeEach(async () => {
  resetLearningRepositoryForTests();
  await deleteLocalDatabaseForTests();
});
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

test("learning progress is read asynchronously from the IndexedDB event journal", async () => {
  const store = createLearningProgressStore({ storage: memoryStorage() });
  assert.equal((await store.load()).schemaVersion, 1);
  assert.equal((await store.load()).events.length, 0);
  assert.equal(await store.appendMany([{ ...campaignFailure, id: "current-event" }]), true);
  assert.equal((await store.load()).events.length, 1);
});

test("cloud-received events never re-enter the local upload queue", async () => {
  const source = createLearningProgressStore();
  const remote = { ...campaignFailure, id: "remote-event" };
  assert.equal(await source.appendMany([remote], { remote: true }), true);
  assert.equal(await countLearningEvents(), 1);
  assert.equal(await countOutbox(), 0);
  assert.equal((await source.load()).events[0].id, "remote-event");
});

test("event history is not silently truncated at an arbitrary event count", async () => {
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
  assert.equal(await store.appendMany(events), true);
  const snapshot = await store.load();
  assert.equal(snapshot.events.length, 5200);
  assert.equal(snapshot.events[0].id, "event-0");
  assert.equal(snapshot.events.at(-1).id, "event-5199");
});

test("exploration activity never counts as mastery evidence", async () => {
  const store = createLearningProgressStore({ storage: memoryStorage() });
  await store.appendMany([{
    id: "gallery-view",
    type: "activity",
    at: "2026-11-01T10:00:00.000Z",
    topicId: "immersive-gallery",
    challengeId: "activity:immersive-gallery",
    stepId: "page_view",
    competencyIds: [],
    sessionType: "exploration",
  }]);
  const result = deriveLearningInsights(fixtureMap, { challenges: [] }, await store.load(), new Date("2026-11-01T11:00:00.000Z"));
  assert.equal(result.competencyInsights[0].evidenceCount, 0);
  assert.equal(result.competencyInsights[0].masteryScore, null);
  assert.equal(result.competencyInsights[0].status, "unverified");
});

test("a hint-assisted pass leaves the gap pending; a different no-hint review variant resolves only that gap", async () => {
  const storage = memoryStorage();
  const progressStore = createLearningProgressStore({ storage });
  assert.equal(await progressStore.appendMany([campaignFailure]), true);
  const engine = createReviewSessionEngine({ storage, progressStore, registry: testRegistry });

  const first = await engine.start({ competencyId: "thenable-adoption", gapId: "thenable-get-vs-call" });
  assert.equal(first.variantId, "review-variant-a");
  const hint = await engine.revealHint(first.sessionId);
  assert.equal(hint.hint, testRegistry.assessments[0].hints[0]);
  const assisted = await engine.submit(first.sessionId, "right");
  assert.equal(assisted.correct, true);
  assert.equal(assisted.session.hintsUsed, 1);

  let result = deriveLearningInsights(fixtureMap, { challenges: [] }, await progressStore.load(), new Date("2026-11-01T12:00:00.000Z"));
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].lifecycle, "pending-verification");
  assert.equal(result.competencyInsights[0].status, "weak");
  assert.equal(result.reviewQueue[0].kind, "gap");

  const second = await engine.start({ competencyId: "thenable-adoption", gapId: "thenable-get-vs-call" });
  assert.equal(second.variantId, "review-variant-b");
  const independent = await engine.submit(second.sessionId, "right");
  assert.equal(independent.correct, true);
  assert.equal(independent.session.hintsUsed, 0);

  result = deriveLearningInsights(fixtureMap, { challenges: [] }, await progressStore.load(), new Date("2026-11-01T12:00:00.000Z"));
  assert.equal(result.gaps.length, 0);
  assert.equal(result.resolvedGaps.length, 1);
  assert.equal(result.resolvedGaps[0].id, "thenable-get-vs-call");
  assert.equal(result.resolvedGaps[0].verificationVariantId, "review-variant-b");
  assert.equal(result.competencyInsights[0].status, "initial");
  assert.equal((await engine.getHistory()).length, 2);

  const importedStorage = memoryStorage();
  const importedStore = createLearningProgressStore({ storage: importedStorage });
  const importResult = await importedStore.importJSON(await progressStore.exportJSON());
  const importedEngine = createReviewSessionEngine({ storage: importedStorage, progressStore: importedStore, registry: testRegistry });
  assert.equal(importResult.total, (await progressStore.load()).events.length);
  assert.equal((await importedEngine.getHistory()).length, 2);
  assert.deepEqual((await importedEngine.getHistory()).map(item => item.variantId).sort(), ["review-variant-a","review-variant-b"]);
});

test("same-variant no-hint repetition cannot clear a pending gap", async () => {
  const storage = memoryStorage();
  const progressStore = createLearningProgressStore({ storage });
  await progressStore.appendMany([campaignFailure]);
  const engine = createReviewSessionEngine({ storage, progressStore, registry: testRegistry });
  const assisted = await engine.start({ competencyId: "thenable-adoption", gapId: "thenable-get-vs-call", variantId: "review-variant-a" });
  await engine.revealHint(assisted.sessionId);
  await engine.submit(assisted.sessionId, "right");
  const repeat = await engine.start({ competencyId: "thenable-adoption", gapId: "thenable-get-vs-call", variantId: "review-variant-a" });
  await engine.submit(repeat.sessionId, "right");
  const result = deriveLearningInsights(fixtureMap, { challenges: [] }, await progressStore.load(), new Date("2026-11-01T12:00:00.000Z"));
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].lifecycle, "pending-verification");
});



test("gap correction follows explicit causal IDs, not timestamps or merged event arrival order", async () => {
  const failure = {
    ...campaignFailure,
    id: "campaign-failure:1",
    at: "2035-01-01T00:00:00.000Z",
    eventSchemaVersion: 3,
    gapObservationId: "campaign-failure:1",
    causationEventIds: [],
    targetGapEventIds: [],
  };
  const targetGapEventIds = [failure.id];
  const started = {
    id: "review-causal:started",
    eventSchemaVersion: 3,
    type: "review_started",
    at: "2001-01-01T00:00:00.000Z",
    topicId: "promise",
    challengeId: "review-assessment",
    challengeTitle: "针对性复习",
    stepId: "review-variant-b",
    stepTitle: "变体 B",
    competencyIds: ["thenable-adoption"],
    sessionId: "review-causal",
    sessionType: "review",
    variantId: "review-variant-b",
    gapId: "thenable-get-vs-call",
    causationEventIds: [],
    targetGapEventIds,
  };
  const attempt = {
    ...started,
    id: "review-causal:attempt:1",
    type: "attempt",
    correct: true,
    hintsUsed: 0,
    selectedOptionId: "right",
    causationEventIds: [started.id],
  };
  const passed = {
    ...attempt,
    id: "review-causal:passed",
    type: "assessment_passed",
    scorePct: 100,
    independent: true,
    causationEventIds: [started.id, attempt.id],
  };

  // A cloud merge may deliver the pass before the attempt, start and original failure.
  const shuffled = { events: [passed, attempt, started, failure] };
  const result = deriveLearningInsights(
    fixtureMap, { challenges: [] }, shuffled, new Date("2026-11-01T12:00:00.000Z")
  );
  assert.equal(result.gaps.length, 0);
  assert.equal(result.resolvedGaps.length, 1);

  // A later-arriving failure is not closed merely because its timestamp predates the pass.
  const nextFailure = {
    ...failure,
    id: "campaign-failure:2",
    at: "1999-01-01T00:00:00.000Z",
    gapObservationId: "campaign-failure:2",
  };
  const withNewFailure = deriveLearningInsights(
    fixtureMap, { challenges: [] }, { events: [passed, nextFailure, attempt, started, failure] },
    new Date("2026-11-01T12:00:00.000Z")
  );
  assert.equal(withNewFailure.gaps.length, 1);
  assert.equal(withNewFailure.gaps[0].count, 1);
});

test("a pass with a target ID but no complete causal chain cannot clear the gap", async () => {
  const failure = { ...campaignFailure, id: "causal-failure", gapObservationId: "causal-failure" };
  const pass = {
    ...campaignFailure,
    id: "orphan-pass",
    type: "assessment_passed",
    correct: true,
    sessionType: "review",
    sessionId: "orphan-review",
    variantId: "review-variant-b",
    gapId: "thenable-get-vs-call",
    hintsUsed: 0,
    targetGapEventIds: [failure.id],
    causationEventIds: [],
    scorePct: 100,
  };
  const result = deriveLearningInsights(
    fixtureMap, { challenges: [] }, { events: [pass, failure] },
    new Date("2026-11-01T12:00:00.000Z")
  );
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].lifecycle, "detected");
});



test("concurrent same-variant passes from disconnected devices are not independent evidence", async () => {
  const failure = {
    ...campaignFailure,
    id: "concurrent-source-failure",
    gapObservationId: "concurrent-source-failure",
  };
  const target = [failure.id];
  const sessionEvents = sessionId => {
    const started = {
      ...campaignFailure,
      id: sessionId + ":started",
      type: "review_started",
      sessionId,
      sessionType: "review",
      variantId: "review-variant-b",
      gapId: "thenable-get-vs-call",
      targetGapEventIds: target,
      causationEventIds: [],
    };
    const attempt = {
      ...started,
      id: sessionId + ":attempt:1",
      type: "attempt",
      correct: true,
      hintsUsed: 0,
      causationEventIds: [started.id],
    };
    const passed = {
      ...attempt,
      id: sessionId + ":passed",
      type: "assessment_passed",
      scorePct: 100,
      causationEventIds: [started.id, attempt.id],
    };
    return [started, attempt, passed];
  };
  const [firstStart, firstAttempt, firstPass] = sessionEvents("offline-device-a");
  const [secondStart, secondAttempt, secondPass] = sessionEvents("offline-device-b");
  const result = deriveLearningInsights(
    fixtureMap, { challenges: [] },
    { events: [firstPass, secondAttempt, secondStart, failure, firstAttempt, secondPass, firstStart] },
    new Date("2026-11-01T12:00:00.000Z")
  );
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].lifecycle, "detected");
});



test("a targeted pass for one competency cannot close the same gap in another competency", async () => {
  const dualMap = structuredClone(fixtureMap);
  dualMap.topics[0].competencies.push({
    id: "promise-resolution",
    title: "Promise Resolution Procedure",
    prerequisites: [],
    lessonHref: "./knowledge/promise/",
    challengeHref: "./puzzles/",
  });
  const failure = {
    ...campaignFailure,
    id: "shared-gap-failure",
    gapObservationId: "shared-gap-failure",
    competencyIds: ["thenable-adoption", "promise-resolution"],
  };
  const target = [failure.id];
  const started = {
    ...campaignFailure,
    id: "single-competency-review:started",
    type: "review_started",
    sessionId: "single-competency-review",
    sessionType: "review",
    variantId: "review-variant-b",
    gapId: "thenable-get-vs-call",
    competencyIds: ["thenable-adoption"],
    targetGapEventIds: target,
    causationEventIds: [],
  };
  const attempt = {
    ...started,
    id: "single-competency-review:attempt:1",
    type: "attempt",
    correct: true,
    hintsUsed: 0,
    causationEventIds: [started.id],
  };
  const passed = {
    ...attempt,
    id: "single-competency-review:passed",
    type: "assessment_passed",
    scorePct: 100,
    causationEventIds: [started.id, attempt.id],
  };
  const result = deriveLearningInsights(
    dualMap, { challenges: [] }, { events: [passed, attempt, started, failure] },
    new Date("2026-11-01T12:00:00.000Z")
  );
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].competencyId, "promise-resolution");
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
  assert.equal(tracked.length, 18);
  assert.equal(registry.assessments.length, 78);
  assert.equal(gapVariants.size, map.gaps.length);
  assert.equal(map.gaps.length, 34);
  for (const id of tracked) assert.ok((byCompetency.get(id)?.length || 0) >= 2, "expected at least 2 variants for " + id);
  for (const [gapId, variants] of gapVariants) assert.ok(variants.size >= 2, "gap needs two independent variants: " + gapId);
  for (const key of sourcePairs) assert.ok((reviewPairs.get(key)?.size || 0) >= 2, "gap/competency mapping needs two targeted variants: " + key);
});


test("a generic competency review cannot accidentally resolve a specific active gap", async () => {
  const storage = memoryStorage();
  const progressStore = createLearningProgressStore({ storage });
  await progressStore.appendMany([campaignFailure]);
  const engine = createReviewSessionEngine({ storage, progressStore, registry: testRegistry });
  const session = await engine.start({ competencyId: "thenable-adoption" });
  const result = await engine.submit(session.sessionId, "right");
  assert.equal(result.correct, true);
  const snapshot = await progressStore.load();
  const genericPass = snapshot.events.find(event => event.type === "assessment_passed");
  assert.equal(genericPass.gapId, null);
  const insight = deriveLearningInsights(fixtureMap, { challenges: [] }, snapshot, new Date("2026-11-01T12:00:00.000Z"));
  assert.equal(insight.gaps.length, 1);
  assert.equal(insight.gaps[0].id, "thenable-get-vs-call");
});


test("a failed targeted review must be followed by a different variant, not a retry of the same item", async () => {
  const storage = memoryStorage();
  const progressStore = createLearningProgressStore({ storage });
  await progressStore.appendMany([campaignFailure]);
  const engine = createReviewSessionEngine({ storage, progressStore, registry: testRegistry });

  const failed = await engine.start({ competencyId: "thenable-adoption", gapId: "thenable-get-vs-call", variantId: "review-variant-a" });
  await engine.submit(failed.sessionId, "wrong");

  const retry = await engine.start({ competencyId: "thenable-adoption", gapId: "thenable-get-vs-call", variantId: "review-variant-a" });
  await engine.submit(retry.sessionId, "right");
  let insight = deriveLearningInsights(fixtureMap, { challenges: [] }, await progressStore.load(), new Date("2026-11-01T12:00:00.000Z"));
  assert.equal(insight.gaps.length, 1, "same-variant retry must not resolve the gap");

  const different = await engine.start({ competencyId: "thenable-adoption", gapId: "thenable-get-vs-call", variantId: "review-variant-b" });
  await engine.submit(different.sessionId, "right");
  insight = deriveLearningInsights(fixtureMap, { challenges: [] }, await progressStore.load(), new Date("2026-11-01T12:00:00.000Z"));
  assert.equal(insight.gaps.length, 0, "a new no-hint variant should resolve the gap");
});


test("review start, hint, and answer atomically persist documents with append-only events", async () => {
  const progressStore = createLearningProgressStore();
  const engine = createReviewSessionEngine({ progressStore, registry: testRegistry });

  const session = await engine.start({ competencyId: "thenable-adoption" });
  assert.equal(await countLearningEvents(), 1);
  let document = await getLearningDocument("review_session", session.sessionId);
  assert.equal(document.payload.status, "active");
  assert.equal(await countOutbox(), 1);

  await engine.revealHint(session.sessionId);
  assert.equal(await countLearningEvents(), 2);
  assert.equal((await getLearningDocument("review_session", session.sessionId)).payload.hintsUsed, 1);
  assert.equal(await countOutbox(), 2);

  const result = await engine.submit(session.sessionId, "right");
  assert.equal(result.correct, true);
  assert.equal(await countLearningEvents(), 4);
  document = await getLearningDocument("review_session", session.sessionId);
  assert.equal(document.payload._deleted, true);
  assert.equal(await countOutbox(), 4);
  const events = (await progressStore.load()).events.filter(item => item.sessionId === session.sessionId);
  assert.deepEqual(events.map(item => item.type), [
    "review_started", "hint_revealed", "attempt", "assessment_passed",
  ]);
});
