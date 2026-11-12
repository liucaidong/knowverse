import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReviewerDimensionStatuses } from "../supabase/functions/_shared/practice-reviewer-normalize.mjs";

function review(findings = []) {
  return {
    findings,
    sourceAlignment: { status: "pass" },
    solvability: { status: "pass" },
    answerConsistency: { status: "pass" },
    pedagogicalQuality: { status: "pass" },
  };
}

test("a high pedagogical finding cannot coexist with a passing pedagogical dimension", () => {
  const value = review([{ category: "pedagogical_quality", severity: "high" }]);
  assert.equal(normalizeReviewerDimensionStatuses(value).pedagogicalQuality.status, "concern");
});

test("high source, solvability and answer findings downgrade their matching dimensions", () => {
  const value = review([
    { category: "source_alignment", severity: "critical" },
    { category: "solvability", severity: "high" },
    { category: "answer_quality", severity: "high" },
  ]);
  const normalized = normalizeReviewerDimensionStatuses(value);
  assert.equal(normalized.sourceAlignment.status, "concern");
  assert.equal(normalized.solvability.status, "concern");
  assert.equal(normalized.answerConsistency.status, "concern");
});

test("registration compatibility findings map to pedagogical quality", () => {
  const value = review([{ category: "registration_compatibility", severity: "critical" }]);
  assert.equal(normalizeReviewerDimensionStatuses(value).pedagogicalQuality.status, "concern");
});

test("low and informational findings do not downgrade passing dimensions", () => {
  const value = review([
    { category: "pedagogical_quality", severity: "low" },
    { category: "answer_quality", severity: "info" },
  ]);
  const normalized = normalizeReviewerDimensionStatuses(value);
  assert.equal(normalized.pedagogicalQuality.status, "pass");
  assert.equal(normalized.answerConsistency.status, "pass");
});

test("existing concern and unverified statuses are preserved", () => {
  const value = review([{ category: "pedagogical_quality", severity: "high" }]);
  value.pedagogicalQuality.status = "unverified";
  assert.equal(normalizeReviewerDimensionStatuses(value).pedagogicalQuality.status, "unverified");
});
