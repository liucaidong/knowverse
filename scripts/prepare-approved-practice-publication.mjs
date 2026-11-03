import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { currentPracticeStatus, latestPracticeRecord } from "../supabase/functions/_shared/practice-audit.mjs";

const root = process.cwd();
const candidateId = String(process.env.PRACTICE_CANDIDATE_ID || "").trim();
const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
if (!/^[A-Za-z0-9_-]{8,120}$/.test(candidateId)) throw new Error("PRACTICE_CANDIDATE_ID is missing or invalid.");
if (!/^https:\/\//i.test(supabaseUrl) || !serviceKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY GitHub Actions secrets are required. No frontend credential fallback is allowed.");
}
const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey, Accept: "application/json" };
const stable = value => {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
  return JSON.stringify(value);
};
async function api(path, options = {}) {
  const response = await fetch(supabaseUrl + path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await response.text();
  let value;
  try { value = raw ? JSON.parse(raw) : null; } catch { value = raw; }
  if (!response.ok) throw new Error("Supabase publication verification failed (HTTP " + response.status + "): " + String(raw).slice(0, 500));
  return value;
}
async function records(filters) {
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({
      select: "id,user_id,candidate_id,record_type,record_id,candidate_hash,payload,created_at",
      candidate_id: "eq." + candidateId,
      order: "created_at.asc,id.asc",
      limit: String(pageSize),
      offset: String(offset),
      ...filters,
    });
    const page = await api("/rest/v1/practice_candidate_quality_records?" + params.toString());
    if (!Array.isArray(page)) throw new Error("Supabase audit query did not return an array.");
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
const allRecords = await records({});
const pendingRows = allRecords.filter(row => row.record_type === "registration_pending");
if (pendingRows.length !== 1) {
  throw new Error("Expected exactly one immutable registration_pending record for this candidate; found " + pendingRows.length + ".");
}
const pending = pendingRows[0];
const userId = pending.user_id;
const candidateHash = pending.candidate_hash;
const body = pending.payload || {};
if (!userId || body.candidateId !== candidateId || body.candidateHash !== candidateHash ||
  !body.assessmentId || !body.assessment || !body.approvalRecordId || !body.reviewId) {
  throw new Error("Registration pending record is incomplete or its candidate hash does not match.");
}
const ownedUserRecords = allRecords.filter(row => row.user_id === userId && row.candidate_id === candidateId);
const owned = ownedUserRecords.filter(row => row.candidate_hash === candidateHash);
const currentStatus = currentPracticeStatus(ownedUserRecords);
if (currentStatus !== "registration_pending") {
  throw new Error("Candidate state is not registration_pending: " + currentStatus);
}
const approval = latestPracticeRecord(owned, "approval", candidateHash);
const review = latestPracticeRecord(owned, "review", candidateHash);
const validation = latestPracticeRecord(owned, "validation", candidateHash);
if (!approval || approval.record_id !== body.approvalRecordId ||
  approval.payload?.reviewId !== body.reviewId || approval.payload?.explicitConfirmation !== true ||
  !review || review.payload?.reviewId !== body.reviewId || review.payload?.verdict !== "pass" ||
  !validation || validation.payload?.validationStatus !== "passed") {
  throw new Error("Missing a matching immutable deterministic-validation, independent pass review, or explicit human approval record.");
}
if (review.payload?.sourceSnapshotHash !== validation.payload?.sourceSnapshotHash ||
  review.payload?.validationRecordId !== validation.record_id ||
  body.candidateHash !== candidateHash ||
  stable(body.assessment) !== stable(review.payload?.registrationAssessment && {
    id: body.assessmentId,
    competencyId: body.assessment.competencyId,
    topicId: body.assessment.topicId,
    gapIds: body.assessment.gapIds,
    title: review.payload.registrationAssessment.title,
    prompt: review.payload.registrationAssessment.prompt,
    code: review.payload.registrationAssessment.code,
    options: review.payload.registrationAssessment.options.map(option => ({
      id: option.id, label: option.label,
      ...(option.id === review.payload.registrationAssessment.answer ? {} : { gapId: validation.payload.sourceValidation.gapId }),
    })),
    answer: review.payload.registrationAssessment.answer,
    hints: review.payload.registrationAssessment.hints,
    explanation: review.payload.registrationAssessment.explanation,
  })) {
  throw new Error("Review provenance, registrationAssessment, or candidate hash no longer matches the immutable approved snapshot.");
}
const assessment = body.assessment;
const expectedKeys = [
  "id", "competencyId", "topicId", "gapIds", "title", "prompt",
  "code", "options", "answer", "hints", "explanation",
];
if (stable(Object.keys(assessment).sort()) !== stable(expectedKeys.slice().sort())) {
  throw new Error("The proposed assessment does not match the existing official assessment schema.");
}
if (assessment.id !== body.assessmentId || assessment.id !== "review-ai-" + candidateId ||
  !assessment.competencyId || !assessment.topicId || !Array.isArray(assessment.gapIds) ||
  assessment.gapIds.length !== 1 || !assessment.title || assessment.title.length > 120 ||
  assessment.title.length < 4 || !assessment.prompt || assessment.prompt.length > 900 ||
  assessment.prompt.length < 16 || typeof assessment.code !== "string" || assessment.code.length > 2400 ||
  !Array.isArray(assessment.options) || assessment.options.length < 2 || assessment.options.length > 4 ||
  !Array.isArray(assessment.hints) || assessment.hints.length !== 2 ||
  assessment.hints.some(value => typeof value !== "string" || !value.trim() || value.length > 320) ||
  !assessment.explanation || assessment.explanation.length > 1600 || assessment.explanation.length < 8 ||
  Object.keys(assessment).sort().join("|") !== expectedKeys.slice().sort().join("|")) {
  throw new Error("Proposed formal assessment failed current Review Engine schema / size checks.");
}
const optionIds = assessment.options.map(item => item?.id);
if (optionIds.some(id => typeof id !== "string" || !/^[a-z0-9_-]{1,32}$/i.test(id)) ||
  new Set(optionIds).size !== optionIds.length ||
  assessment.options.some(option => typeof option.label !== "string" || !option.label.trim()) ||
  optionIds.filter(id => id === assessment.answer).length !== 1 ||
  !assessment.options.some(option => option.id !== assessment.answer && option.gapId === assessment.gapIds[0])) {
  throw new Error("Formal assessment options / answer / targeted-Gap mapping are invalid.");
}
const map = JSON.parse(await readFile(resolve(root, "content/learning-map.json"), "utf8"));
const topic = map.topics.find(item => item.id === assessment.topicId);
const competency = topic?.competencies?.find(item => item.id === assessment.competencyId);
const gap = map.gaps.find(item => item.id === assessment.gapIds[0]);
if (!competency || !gap?.competencyIds?.includes(assessment.competencyId) ||
  validation.payload.sourceValidation?.competencyId !== assessment.competencyId ||
  validation.payload.sourceValidation?.topicId !== assessment.topicId ||
  validation.payload.sourceValidation?.gapId !== assessment.gapIds[0] ||
  !Array.isArray(assessment.gapIds) || new Set(assessment.gapIds).size !== assessment.gapIds.length ||
  assessment.options.some(option => option.gapId && option.gapId !== assessment.gapIds[0])) {
  throw new Error("Assessment competency, topic, or Gap mapping is no longer valid in the canonical learning map.");
}

const registryPath = resolve(root, "content/review-assessments.json");
const manifestPath = resolve(root, "content/practice-publication-manifest.json");
const registry = JSON.parse(await readFile(registryPath, "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!Array.isArray(registry.assessments) || !Array.isArray(manifest.entries)) {
  throw new Error("Official assessment registry or practice publication manifest has invalid shape.");
}
const existingAssessment = registry.assessments.find(item => item.id === assessment.id);
if (existingAssessment && stable(existingAssessment) !== stable(assessment)) {
  throw new Error("Assessment ID collision: refusing to overwrite an existing official assessment.");
}
const sourceVariantIds = validation.payload.sourceValidation?.sourceVariantIds;
if (!Array.isArray(sourceVariantIds) || sourceVariantIds.length !== 2 ||
  new Set(sourceVariantIds).size !== 2 || sourceVariantIds.some(id => typeof id !== "string" || !id)) {
  throw new Error("The approved validation snapshot does not contain exactly two immutable official source anchors.");
}
if (!review.payload.reviewerVersion || !review.payload.reviewerModel) {
  throw new Error("Independent Reviewer identity is missing from the immutable pass record.");
}
const entry = {
  candidateId,
  candidateHash,
  assessmentId: assessment.id,
  variantId: assessment.id,
  reviewId: body.reviewId,
  validationRecordId: validation.record_id,
  approvalRecordId: approval.record_id,
  registrationPendingRecordId: pending.record_id,
  sourceSnapshotHash: validation.payload.sourceSnapshotHash,
  reviewerVersion: review.payload.reviewerVersion,
  reviewerModel: review.payload.reviewerModel,
  sourceVariantIds,
  competencyId: assessment.competencyId,
  topicId: assessment.topicId,
  gapId: assessment.gapIds[0],
  originalTaskType: validation.payload.candidateSnapshot?.exercise?.taskType || null,
  originalDifficulty: validation.payload.candidateSnapshot?.exercise?.difficulty || null,
  publicationStatus: "pending_pr_and_pages_verification",
  preparedAt: body.preparedAt || pending.created_at,
};
const priorEntry = manifest.entries.find(item => item.candidateId === candidateId);
if (priorEntry && stable(priorEntry) !== stable(entry)) {
  throw new Error("Publication manifest provenance is immutable and differs from the currently approved snapshot.");
}
if (!existingAssessment) {
  registry.assessments.push(assessment);
  registry.updated = new Date().toISOString().slice(0, 10);
}
if (!priorEntry) manifest.entries.push(entry);
registry.assessments.sort((a, b) => a.id.localeCompare(b.id));
manifest.entries.sort((a, b) => a.assessmentId.localeCompare(b.assessmentId));
await writeFile(registryPath, JSON.stringify(registry, null, 2) + "\n");
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({
  ok: true,
  idempotent: Boolean(existingAssessment && priorEntry),
  candidateId,
  assessmentId: assessment.id,
  variantId: assessment.id,
  approvalRecordId: approval.record_id,
  reviewId: review.payload.reviewId,
  message: "Prepared a schema-compatible official assessment and traceability manifest. A GitHub PR review and successful Pages deployment are still required.",
}, null, 2));
