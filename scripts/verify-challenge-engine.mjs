import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  completeStep,
  createChallengeProgress,
  createChallengeProgressStore,
  getStepProgress,
  recordAttempt,
  resetChallengeProgress,
  revealNextHint,
  setStepData,
  summarizeChallenge,
} from "../assets/js/challenge-engine.mjs";

const challenge = {
  id: "sample-quest",
  scoring: { attemptPenalty: 8, hintPenalty: 15 },
  steps: [
    { id: "first", points: 100, hints: ["hint one", "hint two"] },
    { id: "second", points: 80, hints: ["another hint"] },
    { id: "third", points: 60, hints: [] },
  ],
};

const registry = JSON.parse(readFileSync(new URL("../content/challenges.json", import.meta.url), "utf8"));
const monorepoChallenge = registry.challenges.find(item => item.id === "monorepo-dependency-quest");

test("the published Monorepo challenge is data-driven and has progressive hints for every gate", () => {
  assert.ok(monorepoChallenge);
  assert.deepEqual(monorepoChallenge.steps.map(step => step.id), [
    "workspace-protocol",
    "build-order",
    "affected-closure",
  ]);
  assert.ok(monorepoChallenge.steps.every(step => step.hints.length === 3));
  assert.equal(monorepoChallenge.scoring.attemptPenalty, 8);
  assert.equal(monorepoChallenge.scoring.hintPenalty, 15);
});

test("creates a sequential challenge: only the first step is active", () => {
  const progress = createChallengeProgress(challenge);
  assert.equal(progress.status, "not-started");
  assert.deepEqual(progress.steps.map(step => step.status), ["active", "locked", "locked"]);
  assert.equal(getStepProgress(progress, "first").attempts, 0);
});

test("records attempts and progressive hints, then calculates a transparent score", () => {
  let progress = createChallengeProgress(challenge);
  progress = recordAttempt(progress, "first");
  progress = recordAttempt(progress, "first");

  const firstHint = revealNextHint(progress, challenge, "first");
  assert.equal(firstHint.hint, "hint one");
  progress = firstHint.progress;
  assert.equal(revealNextHint(progress, challenge, "first").hint, "hint two");

  progress = completeStep(progress, challenge, "first");
  const summary = summarizeChallenge(challenge, progress);
  assert.equal(summary.completedSteps, 1);
  assert.equal(summary.earnedPoints, 77);
  assert.equal(summary.maxPoints, 240);
  assert.equal(summary.attempts, 2);
  assert.equal(summary.hintsUsed, 1);
  assert.equal(getStepProgress(progress, "second").status, "active");
});

test("stores challenge-specific activity data and preserves it after reload", () => {
  let progress = createChallengeProgress(challenge);
  progress = setStepData(progress, "first", { completedNodeIds: ["contracts"] });
  const storageData = new Map();
  const storage = {
    getItem: key => storageData.get(key) ?? null,
    setItem: (key, value) => storageData.set(key, value),
    removeItem: key => storageData.delete(key),
  };
  const store = createChallengeProgressStore({ storage });
  assert.equal(store.save(progress), true);

  const restored = store.load(challenge);
  assert.deepEqual(getStepProgress(restored, "first").data, { completedNodeIds: ["contracts"] });
  assert.equal(getStepProgress(restored, "first").status, "active");
  assert.equal(store.clear(challenge.id), true);
  assert.equal(store.load(challenge).steps[0].data.completedNodeIds, undefined);
});

test("prevents skipping locked steps and sanitizes incompatible saved progress", () => {
  const fresh = createChallengeProgress(challenge);
  assert.throws(() => recordAttempt(fresh, "second"), /not active/);
  assert.throws(() => completeStep(fresh, challenge, "third"), /not active/);

  const malformed = createChallengeProgress(challenge, {
    engineVersion: 999,
    challengeId: challenge.id,
    steps: [{ id: "first", status: "completed" }],
  });
  assert.deepEqual(malformed.steps.map(step => step.status), ["active", "locked", "locked"]);
});

test("unlocks every step in order and marks the challenge completed", () => {
  let progress = resetChallengeProgress(challenge);
  for (const step of challenge.steps) {
    progress = completeStep(progress, challenge, step.id);
  }
  const summary = summarizeChallenge(challenge, progress);
  assert.equal(progress.status, "completed");
  assert.equal(summary.completionRate, 1);
  assert.equal(summary.completedSteps, 3);
  assert.equal(summary.earnedPoints, 240);
});

test("works without browser storage", () => {
  const store = createChallengeProgressStore({ storage: null });
  assert.equal(store.available, false);
  assert.equal(store.save(createChallengeProgress(challenge)), false);
  assert.equal(store.clear(challenge.id), false);
});
