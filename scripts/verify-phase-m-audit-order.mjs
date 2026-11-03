import assert from "node:assert/strict";
import test from "node:test";
import {
  allPracticeCandidateHistory,
  collectAllPracticePages,
  currentPracticeStatus,
  latestPracticeRecord,
} from "../supabase/functions/_shared/practice-audit.mjs";

const state = (revision, to, created_at, id) => ({
  record_type: "state", payload: { revision, to }, created_at, id,
});

test("current state follows monotonic revision, not timestamp or UUID ordering", () => {
  const records = [
    state(12, "registration_pending", "2026-11-04T02:00:00.000Z", "z-later-revision"),
    state(11, "approved", "2026-11-04T05:00:00.000Z", "a-newer-timestamp"),
    state(10, "machine_reviewed", "2026-11-04T05:30:00.000Z", "zz"),
  ];
  assert.equal(currentPracticeStatus(records), "registration_pending");
});

test("same-transaction timestamps still resolve to the greatest revision", () => {
  const records = [
    state(8, "registration_pending", "2026-11-04T00:00:00.000Z", "000-first-id"),
    state(9, "registered", "2026-11-04T00:00:00.000Z", "zzz-second-id"),
  ];
  assert.equal(currentPracticeStatus(records), "registered");
});

test("legacy state rows without revisions retain deterministic timestamp and ID fallback", () => {
  const records = [
    { record_type: "state", payload: { to: "draft" }, created_at: "2026-11-03T00:00:00.000Z", id: "a" },
    { record_type: "state", payload: { to: "validation" }, created_at: "2026-11-03T00:00:00.000Z", id: "b" },
  ];
  assert.equal(currentPracticeStatus(records), "validation");
});

test("latest audit record uses the same created_at then ID ordering as database RPCs", () => {
  const records = [
    { record_type: "review", candidate_hash: "abc", payload: { reviewId: "newer" }, created_at: "2026-11-04T01:00:00.000Z", id: "a" },
    { record_type: "review", candidate_hash: "abc", payload: { reviewId: "older" }, created_at: "2026-11-04T00:00:00.000Z", id: "z" },
    { record_type: "review", candidate_hash: "other", payload: { reviewId: "other" }, created_at: "2026-11-04T02:00:00.000Z", id: "z" },
  ];
  assert.equal(latestPracticeRecord(records, "review", "abc").payload.reviewId, "newer");
});

test("audit pagination reads every page without a fixed historical row cap", async () => {
  const calls = [];
  const result = await collectAllPracticePages(async (offset, pageSize) => {
    calls.push([offset, pageSize]);
    const remaining = Math.max(0, 1205 - offset);
    return Array.from({ length: Math.min(pageSize, remaining) }, (_, index) => offset + index);
  }, 500);
  assert.equal(result.length, 1205);
  assert.deepEqual(calls, [[0, 500], [500, 500], [1000, 500]]);
  assert.equal(result.at(-1), 1204);
});

test("pagination fails closed for malformed pages and invalid limits", async () => {
  await assert.rejects(() => collectAllPracticePages(async () => null), /did not return an array/);
  await assert.rejects(() => collectAllPracticePages(async () => [], 0), /positive integer page size/);
});

test("duplicate-check history retains candidate 31 and later instead of silently truncating", () => {
  const history = Array.from({ length: 1205 }, (_, index) => ({ candidateId: "candidate-" + index }));
  const checked = allPracticeCandidateHistory(history);
  assert.equal(checked.length, 1205);
  assert.equal(checked.at(-1).candidateId, "candidate-1204");
  assert.notEqual(checked, history);
  assert.throws(() => allPracticeCandidateHistory(null), /must be an array/);
});
