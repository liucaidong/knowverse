import { normalizeLearningEvent } from "./learning-event-schema.mjs";

export const REVIEW_STATES = Object.freeze([
  "new", "learning", "scheduled", "due", "overdue", "relearning", "stable",
]);
export const SPACED_REPETITION_VERSION = 1;
const DAY_MS = 86_400_000;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const validDate = value => Number.isFinite(Date.parse(value));
const addDays = (value, days) => new Date(Date.parse(value) + days * DAY_MS).toISOString();
const halfDay = value => Math.round(value * 2) / 2;
const eventTime = event => Date.parse(event.at);
const sessionKey = event => event.sessionId
  ? String(event.sessionType || "learning") + "::" + String(event.sessionId)
  : "event::" + event.id;

function uniqueEvents(events) {
  const byId = new Map();
  for (const raw of Array.isArray(events) ? events : []) {
    const event = normalizeLearningEvent(raw);
    if (!event || !validDate(event.at)) continue;
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  return [...byId.values()];
}

function sessionQuality(rows) {
  const ordered = rows.slice().sort((a, b) =>
    eventTime(a) - eventTime(b) || a.id.localeCompare(b.id));
  const passes = ordered.filter(event => ["assessment_passed", "completed"].includes(event.type));
  const attempts = ordered.filter(event => event.type === "attempt");
  const hints = ordered.filter(event => ["hint", "hint_revealed"].includes(event.type));
  const latestPass = passes.at(-1) || null;
  const failed = attempts.some(event => event.correct === false);
  const attemptCount = Math.max(1, Number(latestPass?.attempts) || attempts.length || 1);
  const hintsUsed = Math.max(
    Number(latestPass?.hintsUsed) || 0,
    ...hints.map(item => Number(item.hintsUsed || item.hintNumber) || 1),
    ...attempts.map(item => Number(item.hintsUsed) || 0),
  );
  if (!latestPass) {
    return failed ? {
      quality: 0, passed: false, at: ordered.at(-1).at, variantId: ordered.at(-1).variantId || null,
      attemptCount, hintsUsed, evidenceRefs: ordered.map(item => item.id),
      reason: "本轮只有失败作答，没有成功验证",
    } : null;
  }
  const score = Number(latestPass.scorePct);
  let quality = Number.isFinite(score)
    ? score >= 95 ? 5 : score >= 85 ? 4 : score >= 70 ? 3 : score >= 60 ? 2 : 1
    : 3;
  if (hintsUsed > 0 || latestPass.independent === false) quality = Math.min(quality, 3);
  if (attemptCount > 1) quality = Math.min(quality, 4);
  const passAttempt = attempts.filter(item => item.correct === true).at(-1);
  return {
    quality, passed: true, at: latestPass.at,
    variantId: latestPass.variantId || passAttempt?.variantId || latestPass.challengeId + ":" + latestPass.stepId,
    attemptCount, hintsUsed, scorePct: Number.isFinite(score) ? clamp(score, 0, 100) : null,
    evidenceRefs: [...new Set([...attempts.map(item => item.id), ...hints.map(item => item.id), latestPass.id])],
    reason: !Number.isFinite(score) ? "验证通过但没有分数，按中等质量初始估算"
      : hintsUsed ? "本轮使用提示，降低间隔增长"
      : attemptCount > 1 ? "本轮经过多次尝试，降低间隔增长"
      : "无提示独立验证",
  };
}

/** Pure, deterministic scheduler. Mastery and gap status remain owned by Learning Intelligence. */
export function calculateReviewSchedule({
  competencyId, events = [], intelligence = null, now = new Date(),
} = {}) {
  if (typeof competencyId !== "string" || !competencyId.trim()) {
    throw new TypeError("competencyId is required.");
  }
  const current = now instanceof Date ? new Date(now) : new Date(now);
  if (!Number.isFinite(current.getTime())) throw new TypeError("now must be a valid date.");
  const nowMs = current.getTime();
  const relevant = uniqueEvents(events).filter(event =>
    (event.competencyIds || []).includes(competencyId) &&
    ["attempt", "assessment_passed", "completed", "hint", "hint_revealed"].includes(event.type) &&
    eventTime(event) <= nowMs
  );
  const sessions = new Map();
  for (const event of relevant) {
    const key = sessionKey(event);
    if (!sessions.has(key)) sessions.set(key, []);
    sessions.get(key).push(event);
  }
  const reviews = [...sessions.values()]
    .map(sessionQuality).filter(Boolean)
    .sort((a, b) => eventTime(a) - eventTime(b) || String(a.variantId).localeCompare(String(b.variantId)));

  const gaps = Array.isArray(intelligence?.activeGaps) ? intelligence.activeGaps : [];
  const latest = reviews.at(-1) || null;
  const successes = reviews.filter(item => item.passed);
  let stabilityDays = 0;
  for (const review of reviews) {
    if (review.quality === 0) stabilityDays = 0.5;
    else if (review.quality <= 2) stabilityDays = Math.max(0.5, stabilityDays * 0.55);
    else if (review.quality === 3) stabilityDays = Math.max(1, stabilityDays * 1.35);
    else if (review.quality === 4) stabilityDays = Math.max(2, stabilityDays * 1.8);
    else stabilityDays = Math.max(3, stabilityDays * 2.3);
    stabilityDays = halfDay(clamp(stabilityDays, 0.5, 60));
  }

  const consecutiveFailures = (() => {
    let count = 0;
    for (let i = reviews.length - 1; i >= 0 && reviews[i].quality === 0; i--) count += 1;
    return count;
  })();
  const latestEvidenceAt = latest?.at || intelligence?.lastEvidenceAt || null;
  const lastEffectiveAt = latest?.at || null;
  const intervalDays = latest
    ? latest.quality === 0 ? 1 : Math.max(1, stabilityDays)
    : gaps.length ? 0 : null;
  const activeGapIds = new Set(gaps.map(item => item.id));
  const latestOpenFailure = relevant
    .filter(event => event.type === "attempt" && event.correct === false &&
      activeGapIds.has(event.gapId))
    .sort((a, b) => eventTime(a) - eventTime(b))
    .at(-1);
  const dueAt = gaps.length
    ? latestOpenFailure?.at || current.toISOString()
    : latest
      ? addDays(latest.at, intervalDays)
      : null;
  const elapsedDays = lastEffectiveAt
    ? Math.max(0, (nowMs - eventTime({ at: lastEffectiveAt })) / DAY_MS)
    : null;
  const overdueDays = dueAt ? Math.max(0, (nowMs - Date.parse(dueAt)) / DAY_MS) : 0;
  const overdueBeyondOneInterval = Boolean(dueAt && intervalDays > 0 && overdueDays > intervalDays);
  const due = Boolean(dueAt && Date.parse(dueAt) <= nowMs);
  const independentSuccesses = successes.filter(item => item.hintsUsed === 0 && item.quality >= 4);
  const uniqueDates = new Set(independentSuccesses.map(item => item.at.slice(0, 10)));
  const uniqueVariants = new Set(independentSuccesses.map(item => item.variantId).filter(Boolean));
  const masteryStable = intelligence?.status === "stable";
  const stableEvidence = independentSuccesses.length >= 3 && uniqueDates.size >= 2 &&
    uniqueVariants.size >= 2 && !gaps.length && masteryStable;

  let status = "new";
  if (gaps.length) status = "relearning";
  else if (!latest) status = "new";
  else if (latest.quality === 0 && due) status = "relearning";
  else if (due && overdueBeyondOneInterval) status = "overdue";
  else if (due) status = "due";
  else if (latest.quality === 0) status = "learning";
  else if (stableEvidence) status = "stable";
  else if (successes.length <= 1) status = "learning";
  else status = "scheduled";

  const confidence = successes.length >= 4 && uniqueDates.size >= 2 && uniqueVariants.size >= 2
    ? "high"
    : successes.length >= 2 && (uniqueDates.size >= 2 || uniqueVariants.size >= 2)
      ? "medium" : "low";
  const evidenceRefs = [...new Set(reviews.flatMap(item => item.evidenceRefs))].slice(-20);
  const failureCount = reviews.filter(item => !item.passed).length;
  return {
    competencyId, status, lastEvidenceAt: latestEvidenceAt,
    dueAt, intervalDays, stabilityDays,
    elapsedDays: elapsedDays === null ? null : Number(elapsedDays.toFixed(2)),
    overdueDays: Number(overdueDays.toFixed(2)),
    successfulReviewCount: successes.length,
    independentReviewCount: independentSuccesses.length,
    failureCount, consecutiveFailures,
    confidence, confidenceLabel: confidence === "high" ? "证据充分" : confidence === "medium" ? "证据中等" : "初始估算",
    masteryScore: Number.isFinite(intelligence?.masteryScore) ? intelligence.masteryScore : null,
    masteryStatus: intelligence?.status || "unverified",
    activeGapIds: gaps.map(item => item.id),
    latestQuality: latest?.quality ?? null,
    latestQualityReason: latest?.reason || (gaps.length ? "存在未解决的薄弱点" : "尚无有效评估证据"),
    isDue: due || gaps.length > 0,
    evidenceRefs,
    algorithmVersion: SPACED_REPETITION_VERSION,
  };
}

export function deriveReviewSchedules({ learningMap, events = [], insights, now = new Date() } = {}) {
  const states = new Map((insights?.competencyInsights || []).map(item => [item.id, item]));
  const competencies = (learningMap?.topics || []).flatMap(topic =>
    (topic.competencies || []).map(item => ({ ...item, topicId: topic.id, topicTitle: topic.title })));
  return competencies.map(item => ({
    ...calculateReviewSchedule({
      competencyId: item.id, events, intelligence: states.get(item.id), now,
    }),
    competencyTitle: item.title,
    topicId: item.topicId,
    topicTitle: item.topicTitle,
    href: "./review/?competencyId=" + encodeURIComponent(item.id),
  }));
}
