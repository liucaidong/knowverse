import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { currentPracticeStatus } from "../supabase/functions/_shared/practice-audit.mjs";

const pagesBase = "https://liucaidong.github.io/knowverse";
const pagesRegistryUrl = pagesBase + "/content/review-assessments.json";
const candidateFilter = String(process.env.PRACTICE_CANDIDATE_ID || "").trim();
const deploymentSha = String(process.env.PAGES_DEPLOY_SHA || "").trim().toLowerCase();
if (candidateFilter && !/^[A-Za-z0-9_-]{8,120}$/.test(candidateFilter)) {
  throw new Error("Invalid candidate ID.");
}

const repoRoot = process.cwd();
const checkedOutSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim().toLowerCase();
const registry = JSON.parse(await readFile(resolve(repoRoot, "content/review-assessments.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(repoRoot, "content/practice-publication-manifest.json"), "utf8"));
if (!Array.isArray(registry.assessments) || !Array.isArray(manifest.entries)) {
  throw new Error("The checked-out official registry or publication manifest has invalid shape.");
}
if (deploymentSha && deploymentSha !== checkedOutSha) {
  throw new Error("The workflow deployment SHA does not match the checked-out source commit.");
}
const entries = manifest.entries.filter(entry =>
  (!candidateFilter || entry.candidateId === candidateFilter) &&
  entry.publicationStatus === "pending_pr_and_pages_verification"
);
if (!entries.length) {
  console.log(JSON.stringify({
    ok: true, verified: 0, candidatesConsidered: 0, checkedOutSha,
    note: "No approved publication is awaiting Pages verification; no registration RPC was called.",
  }, null, 2));
  process.exit(0);
}
if (!/^[a-f0-9]{40}$/.test(deploymentSha)) {
  throw new Error("A 40-character Pages deployment SHA is required for a pending publication.");
}
const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
if (!/^https:\/\//i.test(supabaseUrl) || !serviceKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to verify a pending publication.");
}

const headers = {
  apikey: serviceKey,
  Authorization: "Bearer " + serviceKey,
  Accept: "application/json",
};
const stable = value => {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
  return JSON.stringify(value);
};
async function request(path, options = {}) {
  const response = await fetch(supabaseUrl + path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  let value;
  try { value = raw ? JSON.parse(raw) : null; } catch { value = raw; }
  if (!response.ok) {
    throw new Error("Supabase publication verification failed (HTTP " + response.status + "): " + String(raw).slice(0, 500));
  }
  return value;
}
async function allRecords(filters) {
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({
      select: "id,user_id,candidate_id,record_type,record_id,candidate_hash,payload,created_at",
      order: "created_at.asc,id.asc",
      limit: String(pageSize),
      offset: String(offset),
      ...filters,
    });
    const page = await request("/rest/v1/practice_candidate_quality_records?" + params);
    if (!Array.isArray(page)) throw new Error("Supabase audit pagination returned a non-array result.");
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

const liveResponse = await fetch(pagesRegistryUrl + "?deployment=" + deploymentSha, {
  headers: { Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache" },
  cache: "no-store",
  signal: AbortSignal.timeout(20_000),
});
if (!liveResponse.ok) {
  throw new Error("GitHub Pages assessment registry is not reachable: HTTP " + liveResponse.status);
}
const liveRegistry = await liveResponse.json();
if (!Array.isArray(liveRegistry.assessments)) {
  throw new Error("The live GitHub Pages assessment registry has an invalid schema.");
}

let verified = 0;
for (const entry of entries) {
  const required = [
    "candidateId", "candidateHash", "assessmentId", "reviewId", "validationRecordId",
    "approvalRecordId", "registrationPendingRecordId", "competencyId", "topicId", "gapId",
  ];
  if (required.some(key => typeof entry[key] !== "string" || !entry[key])) {
    throw new Error("Publication manifest provenance is incomplete for candidate " + entry.candidateId);
  }
  const assessment = registry.assessments.find(item => item.id === entry.assessmentId);
  const liveAssessment = liveRegistry.assessments.find(item => item.id === entry.assessmentId);
  if (!assessment || !liveAssessment || stable(assessment) !== stable(liveAssessment)) {
    throw new Error("The live Pages assessment does not exactly match the source registry for " + entry.candidateId);
  }
  const expectedAssessmentKeys = [
    "id", "competencyId", "topicId", "gapIds", "title", "prompt",
    "code", "options", "answer", "hints", "explanation",
  ].sort();
  const optionIds = Array.isArray(assessment.options) ? assessment.options.map(option => option?.id) : [];
  if (Object.keys(assessment).sort().join("|") !== expectedAssessmentKeys.join("|") ||
    assessment.competencyId !== entry.competencyId || assessment.topicId !== entry.topicId ||
    !Array.isArray(assessment.gapIds) || assessment.gapIds.length !== 1 ||
    assessment.gapIds[0] !== entry.gapId ||
    typeof assessment.title !== "string" || assessment.title.length < 4 || assessment.title.length > 120 ||
    typeof assessment.prompt !== "string" || assessment.prompt.length < 16 || assessment.prompt.length > 900 ||
    typeof assessment.code !== "string" || assessment.code.length > 2400 ||
    !Array.isArray(assessment.options) || assessment.options.length < 2 || assessment.options.length > 4 ||
    new Set(optionIds).size !== optionIds.length ||
    optionIds.some(id => typeof id !== "string" || !/^[a-z0-9_-]{1,32}$/i.test(id)) ||
    optionIds.filter(id => id === assessment.answer).length !== 1 ||
    assessment.options.some(option => !option || typeof option.label !== "string" || !option.label.trim() ||
      (option.gapId && option.gapId !== entry.gapId) ||
      (option.id === assessment.answer && option.gapId)) ||
    !assessment.options.some(option => option.id !== assessment.answer && option.gapId === entry.gapId) ||
    !Array.isArray(assessment.hints) || assessment.hints.length !== 2 ||
    assessment.hints.some(value => typeof value !== "string" || !value.trim() || value.length > 320) ||
    typeof assessment.explanation !== "string" || assessment.explanation.length < 8 || assessment.explanation.length > 1600) {
    throw new Error("The published Assessment fails the current Review Engine schema or its competency/topic/Gap mapping.");
  }

  const pendingParams = new URLSearchParams({
    select: "id,user_id,candidate_id,record_id,candidate_hash,payload,record_type,created_at",
    candidate_id: "eq." + entry.candidateId,
    record_type: "eq.registration_pending",
    record_id: "eq." + entry.registrationPendingRecordId,
    limit: "2",
  });
  const pendingRows = await request("/rest/v1/practice_candidate_quality_records?" + pendingParams);
  if (!Array.isArray(pendingRows) || pendingRows.length !== 1) {
    throw new Error("Expected one matching immutable registration_pending record for " + entry.candidateId);
  }
  const pending = pendingRows[0];
  if (pending.candidate_hash !== entry.candidateHash ||
    pending.payload?.candidateHash !== entry.candidateHash ||
    pending.payload?.assessmentId !== entry.assessmentId ||
    pending.payload?.approvalRecordId !== entry.approvalRecordId ||
    pending.payload?.reviewId !== entry.reviewId ||
    stable(pending.payload?.assessment) !== stable(assessment)) {
    throw new Error("The immutable registration_pending snapshot does not match the exact published assessment for " + entry.candidateId);
  }

  const records = await allRecords({
    user_id: "eq." + pending.user_id,
    candidate_id: "eq." + entry.candidateId,
  });
  if (records.some(row => row.user_id !== pending.user_id || row.candidate_id !== entry.candidateId)) {
    throw new Error("Audit history contains rows outside the pending record owner scope.");
  }
  const status = currentPracticeStatus(records);
  if (!["registration_pending", "registered"].includes(status)) {
    throw new Error("Candidate state is not eligible for publication registration: " + status);
  }
  const approval = records.filter(row => row.record_type === "approval" &&
      row.record_id === entry.approvalRecordId &&
      row.candidate_hash === entry.candidateHash &&
      row.payload?.reviewId === entry.reviewId &&
      row.payload?.explicitConfirmation === true);
  const review = records.filter(row => row.record_type === "review" &&
      row.candidate_hash === entry.candidateHash &&
      row.payload?.reviewId === entry.reviewId &&
      row.payload?.verdict === "pass");
  const validation = records.filter(row => row.record_type === "validation" &&
      row.record_id === entry.validationRecordId &&
      row.candidate_hash === entry.candidateHash &&
      row.payload?.validationStatus === "passed");
  if (approval.length !== 1 || review.length !== 1 || validation.length !== 1 ||
    review[0].payload?.validationRecordId !== validation[0].record_id ||
    review[0].payload?.sourceSnapshotHash !== validation[0].payload?.sourceSnapshotHash) {
    throw new Error("The exact immutable human approval → independent review → deterministic validation chain is incomplete.");
  }

  const prRecords = records.filter(row => row.record_type === "publication_pr" &&
    row.candidate_hash === entry.candidateHash &&
    row.payload?.assessmentId === entry.assessmentId &&
    row.payload?.registrationPendingRecordId === entry.registrationPendingRecordId &&
    row.payload?.approvalRecordId === entry.approvalRecordId &&
    row.payload?.reviewId === entry.reviewId &&
    /^https:\/\/github\.com\/liucaidong\/knowverse\/pull\/\d+$/.test(row.payload?.prUrl || ""));
  if (prRecords.length !== 1) {
    throw new Error("A unique immutable publication PR audit record matching the approval chain is required.");
  }

  const registeredRows = records.filter(row => row.record_type === "registered");
  if (registeredRows.length > 1) throw new Error("Duplicate registered audit records detected.");
  if (registeredRows.length === 1) {
    const prior = registeredRows[0];
    if (prior.candidate_hash !== entry.candidateHash ||
      prior.payload?.assessmentId !== entry.assessmentId ||
      prior.payload?.registrationPendingRecordId !== entry.registrationPendingRecordId ||
      prior.payload?.pagesUrl !== pagesRegistryUrl ||
      !/^[a-f0-9]{40}$/.test(String(prior.payload?.deploymentSha || "").toLowerCase())) {
      throw new Error("The existing registered record conflicts with this immutable published Assessment receipt.");
    }
    console.log("Already registered and Pages artifact re-verified idempotently:", entry.assessmentId);
    verified += 1;
    continue;
  }

  if (status !== "registration_pending") {
    throw new Error("The candidate status and registered audit records are inconsistent.");
  }
  const publicationProof = {
    registrationPendingRecordId: entry.registrationPendingRecordId,
    assessmentId: entry.assessmentId,
    deploymentSha,
    pagesUrl: pagesRegistryUrl,
    pagesWorkflowRunId: String(process.env.PAGES_WORKFLOW_RUN_ID || ""),
    verifiedAt: new Date().toISOString(),
    prUrl: prRecords[0].payload.prUrl,
  };
  if (!/^[a-f0-9]{40}$/.test(publicationProof.deploymentSha) ||
    publicationProof.pagesUrl !== pagesRegistryUrl) {
    throw new Error("The Pages publication proof is malformed.");
  }
  const recordId = "registered-" + entry.assessmentId;
  await request("/rest/v1/rpc/finalize_practice_candidate_registration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_user_id: pending.user_id,
      p_candidate_id: entry.candidateId,
      p_record_id: recordId,
      p_candidate_hash: entry.candidateHash,
      p_payload: publicationProof,
    }),
  });
  console.log("Verified the live Pages JSON and finalized formal admission:", entry.assessmentId);
  verified += 1;
}
console.log(JSON.stringify({
  ok: true, verified, candidatesConsidered: entries.length,
  deploymentSha, checkedOutSha, pagesUrl: pagesRegistryUrl,
  note: "Registration occurs only after exact live Pages JSON and immutable approval provenance verification. This script does not create Learning Events.",
}, null, 2));
