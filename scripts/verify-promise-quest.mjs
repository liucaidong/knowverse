import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import {
  completeStep,
  createChallengeProgress,
  recordAttempt,
  revealNextHint,
  summarizeChallenge,
} from "../assets/js/challenge-engine.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const registry = JSON.parse(readFileSync(resolve(root, "content/challenges.json"), "utf8"));
const challenge = registry.challenges.find(item => item.id === "promise-mechanism-quest");

async function runSnippet(code, waitMs = 0) {
  const output = [];
  const sandbox = {
    console: {
      log: (...values) => output.push(values.map(value =>
        Array.isArray(value) ? "[" + value.join(",") + "]" : String(value)
      ).join(" ")),
    },
    Promise,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    Error,
  };
  runInNewContext(code, sandbox);
  await new Promise(resolveWait => setTimeout(resolveWait, waitMs));
  return output;
}

test("Promise quest registry contains five concept-linked stages with one unambiguous answer each", () => {
  assert.ok(challenge);
  assert.equal(challenge.steps.length, 5);
  for (const step of challenge.steps) {
    assert.ok(step.title && step.prompt && step.code, step.id);
    assert.equal(step.options.length, 4, step.id);
    assert.equal(step.options.filter(option => option.id === step.answer).length, 1, step.id);
    assert.ok(step.hints.length >= 3, step.id);
    assert.ok(step.focus.length >= 2, step.id);
    assert.ok(step.lessonHref.startsWith("../../../knowledge/promise/"), step.id);
    assert.ok(step.labHref.startsWith("../../../lab/"), step.id);
    assert.ok(step.options.filter(option => option.id !== step.answer).every(option => option.diagnosis && option.gap), step.id);
  }
});

test("Promise quest and course links point to real local pages", () => {
  const pageRoot = resolve(root, "puzzles/worlds/promise-mechanism-quest");
  assert.ok(existsSync(resolve(pageRoot, "index.html")));
  assert.ok(existsSync(resolve(root, "assets/css/promise-quest.css")));
  assert.ok(existsSync(resolve(root, "assets/js/promise-quest.mjs")));
  assert.ok(existsSync(resolve(root, "assets/js/promise-quest-world.mjs")));
  for (const step of challenge.steps) {
    const lesson = resolve(pageRoot, step.lessonHref, "index.html");
    const lab = resolve(pageRoot, step.labHref, "index.html");
    assert.ok(existsSync(lesson), "Missing lesson route for " + step.id + ": " + lesson);
    assert.ok(existsSync(lab), "Missing experiment route for " + step.id + ": " + lab);
  }
});

test("the microtask FIFO lesson example really logs A, E, B, C, D", async () => {
  const step = challenge.steps.find(item => item.id === "microtask-fifo");
  assert.deepEqual(await runSnippet(step.code), ["A", "E", "B", "C", "D"]);
});

test("the thenable adoption example preserves synchronous getter and deferred call", async () => {
  const step = challenge.steps.find(item => item.id === "thenable-adoption");
  assert.deepEqual(await runSnippet(step.code), ["start", "get", "end", "call", "value 42"]);
});

test("the chain example demonstrates rejection of the new Promise and recovery by catch", async () => {
  const step = challenge.steps.find(item => item.id === "chain-error-recovery");
  assert.deepEqual(await runSnippet(step.code), ["recover: boom", "done: ok"]);
});

test("the integrated thenable/inner/microtask example matches the verified event order", async () => {
  const step = challenge.steps.find(item => item.id === "integrated-timeline");
  assert.deepEqual(await runSnippet(step.code), [
    "start", "get", "end", "call", "M1", "M2", "value 42",
  ]);
});


test("the combinator example distinguishes race settlement from all result ordering", async () => {
  const step = challenge.steps.find(item => item.id === "combinator-semantics");
  assert.deepEqual(await runSnippet(step.code, 50), ["fast", "[slow,fast]"]);
});
\ntest("the shared challenge engine scores Promise stages and unlocks them sequentially", () => {
  let progress = createChallengeProgress(challenge);
  assert.deepEqual(progress.steps.map(step => step.status), [
    "active", "locked", "locked", "locked", "locked",
  ]);

  for (const [index, step] of challenge.steps.entries()) {
    progress = recordAttempt(progress, step.id);
    if (index === 0) progress = revealNextHint(progress, challenge, step.id).progress;
    progress = completeStep(progress, challenge, step.id);
    assert.equal(progress.steps[index].status, "completed");
    if (index < challenge.steps.length - 1) {
      assert.equal(progress.steps[index + 1].status, "active");
    }
  }

  const summary = summarizeChallenge(challenge, progress);
  assert.equal(progress.status, "completed");
  assert.equal(summary.completedSteps, 5);
  assert.equal(summary.earnedPoints, 485);
  assert.equal(summary.maxPoints, 500);
  assert.equal(summary.hintsUsed, 1);
});
