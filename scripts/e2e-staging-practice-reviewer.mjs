#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = "/Users/geeker/ai-projects/knowverse";
const PROJECT_URL = "https://ypthoicwrfsblaidllyy.supabase.co";
const CANDIDATE_ID = "e2e-review-785ad611e6bf48c7962434b741f30457";

function parseEnv(raw) {
  return Object.fromEntries(raw.split(/\r?\n/)
    .filter(line => line && !line.trimStart().startsWith("#") && line.includes("="))
    .map(line => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
    }));
}
const env = parseEnv(await readFile(ROOT + "/.env.n2.local", "utf8"));
assert.equal(env.N2_SUPABASE_URL, PROJECT_URL, "This E2E script is pinned to KNOWVERSE Staging.");
const publishableKey = env.N2_SUPABASE_PUBLISHABLE_KEY;
assert.ok(publishableKey && env.N2_SYNC_A_EMAIL && env.N2_SYNC_A_PASSWORD);
assert.ok(env.N2_SYNC_B_EMAIL && env.N2_SYNC_B_PASSWORD);

async function request(path, { token, method = "GET", body, timeoutMs = 15_000 } = {}) {
  const response = await fetch(PROJECT_URL + path, {
    method,
    headers: {
      apikey: publishableKey,
      Accept: "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    // A fresh deadline per request. The Reviewer receives its own 110s budget;
    // earlier login/profile/archive requests cannot consume that deadline.
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return { status: response.status, ok: response.ok, data };
}
function check(result, label) {
  assert.ok(result.ok, label + " HTTP " + result.status + " " + JSON.stringify(result.data).slice(0, 800));
  return result.data;
}
async function login(email, password) {
  const result = check(await request("/auth/v1/token?grant_type=password", {
    method: "POST", body: { email, password },
  }), "Staging test account login");
  assert.equal(String(result.user?.email).toLowerCase(), email.toLowerCase());
  return result.access_token;
}
async function edge(token, action, timeoutMs = 15_000) {
  return request("/functions/v1/practice-quality-review", {
    token, method: "POST", timeoutMs, body: { version: 1, action, candidateId: CANDIDATE_ID,
      ...(action === "review" ? { candidate: candidateSnapshot } : {}) },
  });
}

const tokenA = await login(env.N2_SYNC_A_EMAIL, env.N2_SYNC_A_PASSWORD);
const profile = check(await request("/rest/v1/rpc/get_learning_sync_profile", {
  token: tokenA, method: "POST", body: {},
}), "Staging learning profile");
assert.equal(profile.authorized, true);

const archive = check(await request(
  "/rest/v1/learning_archive_documents?select=document_payload&document_key=eq.practice-candidate%3A" + CANDIDATE_ID,
  { token: tokenA },
), "Load existing synthetic candidate");
assert.equal(archive.length, 1);
const candidateSnapshot = archive[0].document_payload;
assert.equal(candidateSnapshot.candidateId, CANDIDATE_ID);

const prior = check(await edge(tokenA, "history"), "Read existing candidate history");
assert.equal(prior.status, "validation", "Only the previously validated synthetic candidate may be reviewed.");
assert.ok(prior.records.some(record => record.recordType === "validation" &&
  record.payload?.validationStatus === "passed"), "A matching passed deterministic validation is required.");
assert.equal(prior.canApprove, false, "Synthetic account must not have human reviewer privileges.");

console.log("PASS  Staging identity, private candidate archive and prior validation", JSON.stringify({
  candidateId: CANDIDATE_ID, status: prior.status, records: prior.records.length,
}));

const started = Date.now();
const review = check(await edge(tokenA, "review", 145_000), "Independent AI Reviewer execution");
const elapsedMs = Date.now() - started;
assert.equal(review.ok, true);
assert.equal(review.candidateId, CANDIDATE_ID);
assert.equal(review.review?.reviewerModel, "step-5-preview");
assert.ok(review.review?.reviewId);
assert.equal(review.review?.candidateHash, prior.records.find(record => record.recordType === "validation")?.candidateHash);
assert.ok(["pass", "needs_revision", "reject"].includes(review.review?.verdict));
assert.ok(["low", "medium", "high", "critical"].includes(review.review?.riskLevel));
assert.equal(review.canApprove, false);
for (const key of ["sourceAlignment", "solvability", "answerConsistency", "pedagogicalQuality"]) {
  assert.ok(["pass", "concern", "unverified"].includes(review.review?.[key]?.status), "Invalid " + key);
  assert.ok(review.review?.[key]?.evidence?.length >= 1, "Missing " + key + " evidence");
}
console.log("PASS  live Step 5 independent review", JSON.stringify({
  model: review.review.reviewerModel,
  verdict: review.review.verdict,
  status: review.status,
  riskLevel: review.review.riskLevel,
  findings: review.review.findings.length,
  elapsedMs,
}));

const history = check(await edge(tokenA, "history"), "Read persisted Reviewer history");
const types = history.records.map(record => record.recordType);
assert.ok(types.includes("validation"));
assert.ok(types.includes("review"));
assert.ok(types.includes("state"));
const reviewRecord = history.records.find(record => record.recordType === "review");
assert.equal(reviewRecord.payload.reviewId, review.review.reviewId);
assert.equal(reviewRecord.candidateHash, review.review.candidateHash);
console.log("PASS  append-only Staging audit history", JSON.stringify({
  status: history.status, recordCount: history.records.length, recordTypes: types,
  reviewIdMatches: true, candidateHashMatches: true,
}));

const tokenB = await login(env.N2_SYNC_B_EMAIL, env.N2_SYNC_B_PASSWORD);
const cross = check(await edge(tokenB, "history"), "Read history as second Staging account");
assert.deepEqual(cross.records, [], "Account B must not see Account A candidate or audit records.");
console.log("PASS  cross-account audit isolation", JSON.stringify({
  accountBStatus: cross.status, visibleRecords: cross.records.length,
}));

console.log("E2E_RESULT " + JSON.stringify({
  candidateId: CANDIDATE_ID,
  model: review.review.reviewerModel,
  verdict: review.review.verdict,
  status: history.status,
  persistedReview: true,
  crossAccountIsolation: true,
}));
