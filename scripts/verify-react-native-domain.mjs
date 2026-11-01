import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createChallengeProgressStore, recordAttempt, completeStep, setStepData } from "../assets/js/challenge-engine.mjs";
import { createLearningProgressStore, deriveLearningInsights } from "../assets/js/learning-progress.mjs";

const readJSON = async path => JSON.parse(await readFile(new URL("../" + path, import.meta.url), "utf8"));

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

function assertAcyclic(competencies) {
  const map = new Map(competencies.map(item => [item.id, item]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    assert.ok(map.has(id), "Unknown competency or prerequisite: " + id);
    if (visiting.has(id)) throw new Error("Learning prerequisite cycle detected at " + id);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of map.get(id).prerequisites || []) visit(parent);
    visiting.delete(id);
    visited.add(id);
  }
  competencies.forEach(item => visit(item.id));
}

test("React Native is a complete third learning domain across the three product pillars", async () => {
  const [knowledge, works, map, challenges, checkpoints, reviews] = await Promise.all([
    readJSON("content/knowledge.json"),
    readJSON("content/works.json"),
    readJSON("content/learning-map.json"),
    readJSON("content/challenges.json"),
    readJSON("content/learning-checkpoints.json"),
    readJSON("content/review-assessments.json"),
  ]);

  const topic = knowledge.topics.find(item => item.id === "react-native");
  const rnMap = map.topics.find(item => item.id === "react-native");
  assert.ok(topic && rnMap, "React Native topic and learning map must exist");
  assert.equal(rnMap.competencies.length, 6);
  assertAcyclic(rnMap.competencies);

  const liveWorks = works.works.filter(item => item.status === "live" && item.knowledge_ids.includes("react-native"));
  assert.equal(liveWorks.length, 3);
  assert.deepEqual([...new Set(liveWorks.map(item => item.pillar))].sort(), ["gallery", "lab", "puzzles"]);

  for (const work of liveWorks) {
    assert.equal(work.learning.activityTracking, true, work.id);
    assert.ok(work.learning.competencyIds.length > 0, work.id);
    assert.ok(work.learning.competencyIds.every(id => rnMap.competencies.some(item => item.id === id)), work.id);
    const route = work.href.replace(/^\.\//, "") + "index.html";
    const html = await readFile(new URL("../" + route, import.meta.url), "utf8");
    assert.match(html, /learning-integration\.mjs/, work.id);
  }

  const quest = challenges.challenges.find(item => item.id === "rn-architecture-quest");
  assert.ok(quest);
  assert.equal(quest.steps.length, 6);
  assert.deepEqual([...new Set(quest.steps.flatMap(step => step.competencyIds || []))].sort(),
    rnMap.competencies.map(item => item.id).sort());

  const rnGaps = map.gaps.filter(item => item.id.startsWith("rn-"));
  assert.equal(rnGaps.length, 12);
  for (const gap of rnGaps) {
    assert.ok(gap.competencyIds.length > 0, gap.id);
    assert.ok(gap.competencyIds.every(id => rnMap.competencies.some(item => item.id === id)), gap.id);
    const variants = reviews.assessments.filter(item =>
      item.topicId === "react-native" && item.gapIds?.includes(gap.id));
    assert.equal(variants.length, 2, "Every RN gap needs two review variants: " + gap.id);
    assert.equal(new Set(variants.map(item => item.id)).size, 2);
  }

  const rnCheckpoints = checkpoints.checkpoints.filter(item => item.topicId === "react-native");
  assert.equal(rnCheckpoints.length, 2);
  assert.ok(rnCheckpoints.every(checkpoint => liveWorks.some(work => work.id === checkpoint.workId)));
});

test("React Native challenge creates a precise gap and only adds evidence on completion", async () => {
  const [map, registry] = await Promise.all([
    readJSON("content/learning-map.json"),
    readJSON("content/challenges.json"),
  ]);
  const challenge = registry.challenges.find(item => item.id === "rn-architecture-quest");
  const storage = memoryStorage();
  const challengeStore = createChallengeProgressStore({ storage });
  const learningStore = createLearningProgressStore({ storage });
  let progress = challengeStore.load(challenge);
  const step = challenge.steps[0];
  const wrong = step.options.find(option => option.gapId);
  assert.ok(wrong, "The first challenge step must include a diagnosable wrong answer");

  progress = recordAttempt(progress, step.id);
  progress = setStepData(progress, step.id, { lastOptionId: wrong.id, correctOptionId: step.answer });
  assert.equal(challengeStore.save(progress), true);

  let insights = deriveLearningInsights(map, registry, learningStore.load(), new Date("2026-11-01T12:00:00.000Z"));
  let competency = insights.competencyInsights.find(item => item.id === step.competencyIds[0]);
  assert.equal(competency.status, "weak");
  assert.ok(competency.activeGaps.some(item => item.id === wrong.gapId));

  progress = recordAttempt(progress, step.id);
  progress = setStepData(progress, step.id, { lastOptionId: step.answer, correctOptionId: step.answer });
  progress = completeStep(progress, challenge, step.id);
  assert.equal(challengeStore.save(progress), true);

  insights = deriveLearningInsights(map, registry, learningStore.load(), new Date("2026-11-01T12:00:00.000Z"));
  competency = insights.competencyInsights.find(item => item.id === step.competencyIds[0]);
  assert.equal(competency.evidenceCount, 1);
  assert.ok(competency.activeGaps.some(item => item.id === wrong.gapId),
    "Completing a campaign step must not silently resolve the previously observed gap");
});
