import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateLearningPracticeQualityCandidate } from "../assets/js/learning-practice-quality-validator.mjs";

const [candidate, learningMap, registry] = await Promise.all([
  readFile(new URL("fixtures/staging-practice-reviewer-candidate.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../content/learning-map.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../content/review-assessments.json", import.meta.url), "utf8").then(JSON.parse),
]);

const report = validateLearningPracticeQualityCandidate(candidate, { learningMap, registry });
assert.equal(report.validationStatus, "passed", JSON.stringify(report.errors, null, 2));
assert.equal(report.sourceValidation.status, "passed");
assert.deepEqual(report.sourceValidation.sourceVariantIds, [
  "review-thenable-job-timing-a",
  "review-thenable-job-timing-b",
]);
assert.deepEqual(candidate.context.allowedSourceVariantIds, candidate.exercise.sourceVariantIds);
assert.equal(candidate.context.gapId, "thenable-job-timing");
assert.equal(candidate.exercise.hints.length, 2);
assert.ok(candidate.exercise.hints.every(hint => !/\b(inner|outer|ready)\b/.test(hint)),
  "Hints must not refer to undeclared stimulus variables.");

const logs = [];
const createThenable = label => ({
  then(resolve) {
    logs.push(label);
    resolve(label);
  },
});
Promise.resolve(createThenable("first"));
queueMicrotask(() => logs.push("marker"));
Promise.resolve(createThenable("second"));
logs.push("sync");
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(logs, ["sync", "first", "marker", "second"]);

console.log("PASS Staging Reviewer fixture: deterministic source mapping, content schema, hints and native Promise/queueMicrotask order.");
console.log(JSON.stringify({
  candidateId: candidate.candidateId,
  competencyId: candidate.context.competencyId,
  gapId: candidate.context.gapId,
  sourceVariantIds: report.sourceValidation.sourceVariantIds,
  validationStatus: report.validationStatus,
  warnings: report.warnings.map(item => item.code),
  runtimeOrder: logs,
}, null, 2));
