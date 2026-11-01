import assert from "node:assert/strict";
import test from "node:test";
import {
  completeStep,
  createChallengeProgressStore,
  recordAttempt,
  resetChallengeProgress,
  setStepData,
} from "../assets/js/challenge-engine.mjs";
import {
  createChallengeLearningEvents,
  createLearningProgressStore,
  deriveLearningInsights,
} from "../assets/js/learning-progress.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

const learningMap = {
  topics: [{
    id: "promise", title: "Promise", accent: "#188", href: "./knowledge/promise/",
    competencies: [
      { id: "thenable-adoption", title: "Thenable", prerequisites: [], position: { x: 0, y: 0 } },
      { id: "microtask-scheduling", title: "Microtask", prerequisites: ["thenable-adoption"], position: { x: 220, y: 0 } },
    ],
  }],
  gaps: [{ id: "thenable-get-vs-call", label: "Get 与 Call 混淆", description: "读取与调用不同。" }],
};

const challenge = {
  id: "promise-quest", topic: "promise", title: "Promise Quest",
  scoring: { attemptPenalty: 8, hintPenalty: 15 },
  steps: [{
    id: "thenable", title: "Thenable step", competencyIds: ["thenable-adoption"],
    points: 100, options: [{ id: "wrong", gapId: "thenable-get-vs-call" }, { id: "right" }],
  }],
};

function progress(runId, attempts, status, data = {}, completedAt = null, hintsUsed = 0) {
  return {
    runId,
    challengeId: challenge.id,
    updatedAt: "2026-11-01T10:00:00.000Z",
    steps: [{ id: "thenable", attempts, hintsUsed, status, data, completedAt }],
  };
}

test("challenge progress changes create idempotent attempt, hint and completion evidence", () => {
  const before = progress("run-one", 0, "active");
  const after = progress("run-one", 2, "completed", { lastOptionId: "wrong", correctOptionId: "right" }, "2026-11-01T10:00:00.000Z", 1);
  const events = createChallengeLearningEvents(challenge, before, after, { now: "2026-11-01T10:00:00.000Z" });
  assert.equal(events.filter(item => item.type === "attempt").length, 2);
  assert.equal(events.filter(item => item.type === "hint").length, 1);
  assert.equal(events.filter(item => item.type === "completed").length, 1);
  assert.equal(events.find(item => item.type === "attempt").gapId, "thenable-get-vs-call");
  assert.equal(events.find(item => item.type === "completed").scorePct, 77);
});

test("local progress store merges imports and deduplicates event ids", () => {
  const storage = memoryStorage();
  const store = createLearningProgressStore({ storage });
  const event = {
    id: "run:completed:thenable", type: "completed", at: "2026-11-01T10:00:00.000Z",
    challengeId: challenge.id, stepId: "thenable", competencyIds: ["thenable-adoption"],
  };
  assert.equal(store.appendMany([event, event]), true);
  const exported = store.exportJSON();
  const second = createLearningProgressStore({ storage: memoryStorage() });
  const imported = second.importJSON(exported);
  assert.equal(imported.imported, 1);
  assert.equal(imported.total, 1);
  second.importJSON(exported);
  assert.equal(second.load().events.length, 1);
});

test("mastery stays unverified without evidence and does not treat a failed attempt as a completion", () => {
  const empty = deriveLearningInsights(learningMap, { challenges: [challenge] }, { events: [] }, new Date("2026-11-01T12:00:00Z"));
  assert.equal(empty.competencyInsights[0].status, "unverified");
  assert.equal(empty.competencyInsights[0].masteryScore, null);
  const failed = {
    events: [{
      id: "failed", type: "attempt", at: "2026-11-01T10:00:00Z", challengeId: challenge.id,
      stepId: "thenable", competencyIds: ["thenable-adoption"], correct: false, gapId: "thenable-get-vs-call",
    }],
  };
  const afterFailure = deriveLearningInsights(learningMap, { challenges: [challenge] }, failed, new Date("2026-11-01T12:00:00Z"));
  assert.equal(afterFailure.competencyInsights[0].status, "weak");
  assert.equal(afterFailure.gaps.length, 1);
});

test("generic campaign success does not resolve a gap; gap-specific verification is required", () => {
  const snapshot = { events: [
    {
      id: "failed", type: "attempt", at: "2026-11-01T10:00:00Z", challengeId: challenge.id,
      stepId: "thenable", competencyIds: ["thenable-adoption"], correct: false, gapId: "thenable-get-vs-call",
    },
    {
      id: "passed", type: "completed", at: "2026-11-02T10:00:00Z", challengeId: challenge.id,
      stepId: "thenable", competencyIds: ["thenable-adoption"], scorePct: 100, hintsUsed: 0,
    },
  ] };
  const result = deriveLearningInsights(learningMap, { challenges: [challenge] }, snapshot, new Date("2026-11-03T10:00:00Z"));
  assert.equal(result.gaps.length, 1);
  assert.equal(result.competencyInsights[0].status, "weak");
  assert.equal(result.competencyInsights[0].intervalDays, 1);
  assert.equal(result.competencyInsights[0].isDue, true);
});

test("stable mastery requires independent verification on different dates", () => {
  const snapshot = { events: [
    { id: "a", type: "completed", at: "2026-10-20T10:00:00Z", challengeId: challenge.id, stepId: "thenable", competencyIds: ["thenable-adoption"], scorePct: 100, hintsUsed: 0, variantId: "variant-a" },
    { id: "b", type: "completed", at: "2026-10-25T10:00:00Z", challengeId: challenge.id, stepId: "thenable", competencyIds: ["thenable-adoption"], scorePct: 92, hintsUsed: 0, variantId: "variant-b" },
  ] };
  const result = deriveLearningInsights(learningMap, { challenges: [challenge] }, snapshot, new Date("2026-10-26T10:00:00Z"));
  assert.equal(result.competencyInsights[0].status, "stable");
});

test("published map has valid challenge links, unique competency ids and acyclic prerequisites", async () => {
  const { readFile } = await import("node:fs/promises");
  const map = JSON.parse(await readFile(new URL("../content/learning-map.json", import.meta.url), "utf8"));
  const registry = JSON.parse(await readFile(new URL("../content/challenges.json", import.meta.url), "utf8"));
  const ids = new Set();
  for (const topic of map.topics) {
    for (const item of topic.competencies) {
      assert.ok(!ids.has(item.id), "duplicate competency id: " + item.id);
      ids.add(item.id);
      assert.ok(registry.challenges.some(challengeItem => challengeItem.id === topic.challengeId));
      assert.ok(Array.isArray(item.prerequisites));
      for (const prerequisite of item.prerequisites) {
        assert.ok(topic.competencies.some(node => node.id === prerequisite), "unknown prerequisite " + prerequisite);
      }
    }
  }
  for (const challengeItem of registry.challenges) {
    for (const step of challengeItem.steps) {
      if (step.competencyIds) assert.ok(step.competencyIds.every(id => ids.has(id)));
    }
  }

  for (const topic of map.topics) {
    const byId = new Map(topic.competencies.map(item => [item.id, item]));
    const visiting = new Set();
    const visited = new Set();
    const visit = id => {
      assert.ok(!visiting.has(id), "prerequisite cycle detected at " + id);
      if (visited.has(id)) return;
      visiting.add(id);
      for (const parent of byId.get(id).prerequisites) visit(parent);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of byId.keys()) visit(id);

    const challengeItem = registry.challenges.find(item => item.id === topic.challengeId);
    const mapped = new Set(challengeItem.steps.flatMap(step => step.competencyIds || []));
    for (const competency of topic.competencies) {
      assert.ok(mapped.has(competency.id), "competency has no challenge evidence mapping: " + competency.id);
    }
  }
});

test("challenge engine appends learning history and reset never erases it", () => {
  const storage = memoryStorage();
  const challengeStore = createChallengeProgressStore({ storage });
  let state = challengeStore.load(challenge);
  state = recordAttempt(state, "thenable");
  state = setStepData(state, "thenable", { lastOptionId: "wrong", lastGapId: "thenable-get-vs-call" });
  assert.equal(challengeStore.save(state), true);

  state = recordAttempt(state, "thenable");
  state = setStepData(state, "thenable", { correctOptionId: "right", lastGapId: null });
  state = completeStep(state, challenge, "thenable");
  assert.equal(challengeStore.save(state), true);

  const progressStore = createLearningProgressStore({ storage });
  const beforeReset = progressStore.load();
  assert.equal(beforeReset.events.filter(event => event.type === "attempt").length, 2);
  assert.equal(beforeReset.events.filter(event => event.type === "completed").length, 1);
  assert.equal(beforeReset.events.find(event => event.type === "attempt" && event.gapId).gapId, "thenable-get-vs-call");

  challengeStore.clear(challenge.id);
  state = resetChallengeProgress(challenge);
  assert.equal(challengeStore.save(state), true);
  const afterReset = progressStore.load();
  assert.equal(afterReset.events.length, beforeReset.events.length);
  assert.equal(afterReset.events.filter(event => event.type === "completed").length, 1);
});
