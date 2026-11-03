import { currentPracticeStatus, latestPracticeRecord } from "../supabase/functions/_shared/practice-audit.mjs";
const candidateId = String(process.env.PRACTICE_CANDIDATE_ID || "").trim();
const prUrl = String(process.env.PRACTICE_PUBLICATION_PR_URL || "").trim();
const prNumber = Number(process.env.PRACTICE_PUBLICATION_PR_NUMBER || 0);
const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
if (!/^[A-Za-z0-9_-]{8,120}$/.test(candidateId) || !/^https:\/\/github\.com\/liucaidong\/knowverse\/pull\/\d+$/.test(prUrl) ||
  !Number.isInteger(prNumber) || prNumber < 1 || !/^https:\/\//i.test(supabaseUrl) || !serviceKey) {
  throw new Error("Invalid PR details or missing Supabase Actions secrets.");
}
const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey, Accept: "application/json" };
async function request(path, options = {}) {
  const response = await fetch(supabaseUrl + path, {
    ...options, headers: { ...headers, ...(options.headers || {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await response.text();
  let body; try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  if (!response.ok) throw new Error("Supabase publication audit failed (HTTP " + response.status + "): " + String(raw).slice(0, 500));
  return body;
}
const timeline = [];
for (let offset = 0; ; offset += 500) {
  const params = new URLSearchParams({
    select: "id,user_id,candidate_id,record_type,record_id,candidate_hash,payload,created_at",
    candidate_id: "eq." + candidateId,
    order: "created_at.asc,id.asc",
    limit: "500",
    offset: String(offset),
  });
  const page = await request("/rest/v1/practice_candidate_quality_records?" + params);
  if (!Array.isArray(page)) throw new Error("Supabase audit history returned a non-array response.");
  timeline.push(...page);
  if (page.length < 500) break;
}
const pendingRows = timeline.filter(row => row.record_type === "registration_pending");
if (pendingRows.length !== 1) throw new Error("Expected exactly one registration_pending audit record.");
const pending = pendingRows[0];
const ownerRecords = timeline.filter(row => row.user_id === pending.user_id && row.candidate_id === candidateId);
if (currentPracticeStatus(ownerRecords) !== "registration_pending") {
  throw new Error("Candidate is no longer in registration_pending state.");
}
if (pending.payload?.assessmentId !== "review-ai-" + candidateId ||
  pending.payload?.candidateHash !== pending.candidate_hash ||
  !pending.payload?.approvalRecordId || !pending.payload?.reviewId) {
  throw new Error("registration_pending provenance does not match the approved candidate snapshot.");
}
const approval = latestPracticeRecord(ownerRecords, "approval", pending.candidate_hash);
const review = latestPracticeRecord(ownerRecords, "review", pending.candidate_hash);
const validation = latestPracticeRecord(ownerRecords, "validation", pending.candidate_hash);
if (!approval || approval.record_id !== pending.payload.approvalRecordId ||
  approval.payload?.reviewId !== pending.payload.reviewId ||
  approval.payload?.explicitConfirmation !== true ||
  !review || review.payload?.reviewId !== pending.payload.reviewId ||
  review.payload?.verdict !== "pass" ||
  !validation || validation.payload?.validationStatus !== "passed" ||
  review.payload?.validationRecordId !== validation.record_id ||
  review.payload?.sourceSnapshotHash !== validation.payload?.sourceSnapshotHash) {
  throw new Error("Immutable approval, independent pass review and deterministic validation provenance is incomplete.");
}
const recordId = "publication-pr-" + pending.payload.assessmentId;
const existingParams = new URLSearchParams({
  select: "record_id,payload",
  user_id: "eq." + pending.user_id,
  candidate_id: "eq." + candidateId,
  record_type: "eq.publication_pr",
  record_id: "eq." + recordId,
  limit: "1",
});
const existing = await request("/rest/v1/practice_candidate_quality_records?" + existingParams);
if (existing?.length) {
  if (existing[0].payload?.prUrl !== prUrl) {
    throw new Error("A different PR is already recorded for this assessment; refusing to overwrite the audit trail.");
  }
  console.log(JSON.stringify({ ok: true, idempotent: true, prUrl, recordId }));
  process.exit(0);
}
const payload = {
  p_user_id: pending.user_id,
  p_candidate_id: candidateId,
  p_record_type: "publication_pr",
  p_record_id: recordId,
  p_candidate_hash: pending.candidate_hash,
  p_payload: {
    assessmentId: pending.payload.assessmentId,
    registrationPendingRecordId: pending.record_id,
    approvalRecordId: pending.payload.approvalRecordId,
    reviewId: pending.payload.reviewId,
    prNumber, prUrl, branch: "practice-candidate/" + candidateId,
    recordedAt: new Date().toISOString(),
    publicationStatus: "pending_human_pr_review",
  },
  p_expected_status: "registration_pending",
  p_next_status: null,
};
await request("/rest/v1/rpc/append_practice_candidate_quality_record", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
});
console.log(JSON.stringify({ ok: true, idempotent: false, prUrl, recordId }));
