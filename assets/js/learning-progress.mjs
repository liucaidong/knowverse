const SCHEMA_VERSION = 2;
const STORAGE_KEY = "knowverse:learning-progress:v2";
const LEGACY_STORAGE_KEY = "knowverse:learning-progress:v1";
const DAY_MS = 86_400_000;

const timestamp = () => new Date().toISOString();
const clone = value => JSON.parse(JSON.stringify(value));
const asObject = value => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const asCount = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
const validDate = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function makeRunFallback() {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return "run-" + Date.now().toString(36) + "-" + random;
}

function emptySnapshot() {
  const now = timestamp();
  return { schemaVersion: SCHEMA_VERSION, createdAt: now, updatedAt: now, events: [] };
}

function normalizeSnapshot(value) {
  const source = asObject(value);
  if (!source || ![1, SCHEMA_VERSION].includes(source.schemaVersion) || !Array.isArray(source.events)) {
    return emptySnapshot();
  }
  const events = source.events.filter(event =>
    asObject(event) &&
    typeof event.id === "string" &&
    typeof event.type === "string" &&
    validDate(event.at) &&
    typeof event.challengeId === "string" &&
    typeof event.stepId === "string" &&
    Array.isArray(event.competencyIds)
  ).map(event => ({
    ...event,
    eventSchemaVersion: 2,
    sessionType: event.sessionType || (event.type === "activity" ? "exploration" : "campaign"),
    sessionId: event.sessionId || event.runId || null,
    variantId: event.variantId || null,
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: validDate(source.createdAt) ? source.createdAt : timestamp(),
    updatedAt: validDate(source.updatedAt) ? source.updatedAt : timestamp(),
    events: clone(events),
  };
}

function readStorage(storage, key) {
  try {
    const raw = storage?.getItem(key);
    if (raw) return normalizeSnapshot(JSON.parse(raw));
    if (key === STORAGE_KEY) {
      const legacy = storage?.getItem(LEGACY_STORAGE_KEY);
      if (legacy) return normalizeSnapshot(JSON.parse(legacy));
    }
    return emptySnapshot();
  } catch {
    return emptySnapshot();
  }
}

function pointsForStep(challenge, definition, progressStep) {
  const scoring = challenge.scoring || {};
  const points = Number.isFinite(definition.points) ? Math.max(0, definition.points) : 100;
  const attemptPenalty = Number.isFinite(scoring.attemptPenalty) ? Math.max(0, scoring.attemptPenalty) : 0;
  const hintPenalty = Number.isFinite(scoring.hintPenalty) ? Math.max(0, scoring.hintPenalty) : 0;
  const attempts = asCount(progressStep.attempts);
  const hintsUsed = asCount(progressStep.hintsUsed);
  const earned = Math.max(0, points - Math.max(0, attempts - 1) * attemptPenalty - hintsUsed * hintPenalty);
  return { earned, maximum: points, scorePct: points ? Math.round(earned / points * 100) : 0, attempts, hintsUsed };
}

export function createChallengeLearningEvents(challenge, previous, next, options = {}) {
  if (!challenge || !Array.isArray(challenge.steps) || !next || !Array.isArray(next.steps)) return [];
  const now = validDate(options.now) ? options.now : timestamp();
  const sameRun = previous && Array.isArray(previous.steps) && (!previous.runId || previous.runId === next.runId);
  const oldSteps = new Map((sameRun && Array.isArray(previous.steps) ? previous.steps : []).map(step => [step.id, step]));
  const runId = typeof next.runId === "string" && next.runId ? next.runId : makeRunFallback();
  const events = [];

  for (const definition of challenge.steps) {
    const current = next.steps.find(step => step.id === definition.id);
    if (!current) continue;
    const old = oldSteps.get(definition.id) || { attempts: 0, hintsUsed: 0, status: "active", data: {} };
    const oldAttempts = asCount(old.attempts);
    const newAttempts = asCount(current.attempts);
    const attemptDelta = Math.max(0, newAttempts - oldAttempts);
    const becameComplete = current.status === "completed" && old.status !== "completed";
    const competencyIds = Array.isArray(definition.competencyIds) ? definition.competencyIds.filter(id => typeof id === "string") : [];
    const data = asObject(current.data) || {};
    const correctOptionId = typeof data.correctOptionId === "string" ? data.correctOptionId : null;
    const lastOptionId = typeof data.lastOptionId === "string" ? data.lastOptionId : null;
    const optionsById = new Map((definition.options || []).map(option => [option.id, option]));

    for (let number = oldAttempts + 1; number <= newAttempts; number += 1) {
      const isLatest = number === newAttempts;
      const correct = isLatest && becameComplete;
      const selectedOptionId = correct ? correctOptionId : lastOptionId;
      const selectedOption = selectedOptionId ? optionsById.get(selectedOptionId) : null;
      const gapId = correct ? null :
        (selectedOption?.gapId || (isLatest && typeof data.lastGapId === "string" ? data.lastGapId : null));
      events.push({
        id: runId + ":attempt:" + definition.id + ":" + number,
        type: "attempt",
        at: now,
        topicId: challenge.topic || "unclassified",
        challengeId: challenge.id,
        challengeTitle: challenge.title || challenge.id,
        stepId: definition.id,
        stepTitle: definition.title || definition.id,
        competencyIds,
        attemptNumber: number,
        correct: correct ? true : isLatest ? false : null,
        selectedOptionId: selectedOptionId || null,
        gapId: gapId || null,
        hintsUsed: asCount(current.hintsUsed),
      });
    }

    const oldHints = asCount(old.hintsUsed);
    const newHints = asCount(current.hintsUsed);
    for (let number = oldHints + 1; number <= newHints; number += 1) {
      events.push({
        id: runId + ":hint:" + definition.id + ":" + number,
        type: "hint",
        at: now,
        topicId: challenge.topic || "unclassified",
        challengeId: challenge.id,
        challengeTitle: challenge.title || challenge.id,
        stepId: definition.id,
        stepTitle: definition.title || definition.id,
        competencyIds,
        hintNumber: number,
      });
    }

    if (becameComplete) {
      const score = pointsForStep(challenge, definition, current);
      events.push({
        id: runId + ":completed:" + definition.id,
        type: "completed",
        at: validDate(current.completedAt) ? current.completedAt : now,
        topicId: challenge.topic || "unclassified",
        challengeId: challenge.id,
        challengeTitle: challenge.title || challenge.id,
        stepId: definition.id,
        stepTitle: definition.title || definition.id,
        competencyIds,
        scorePct: score.scorePct,
        earnedPoints: score.earned,
        maximumPoints: score.maximum,
        attempts: score.attempts,
        hintsUsed: score.hintsUsed,
      });
    }
  }
  for (const event of events) {
    event.eventSchemaVersion = 2;
    event.sessionId = event.sessionId || runId;
    event.sessionType = "campaign";
    event.variantId = event.variantId || challenge.id + ":" + event.stepId;
    if (typeof challenge.workId === "string") event.workId = challenge.workId;
    if (Array.isArray(challenge.knowledgeIds)) event.knowledgeIds = challenge.knowledgeIds.slice();
  }
  return events;
}

export function createLearningProgressStore(options = {}) {
  let storage = options.storage;
  if (typeof storage === "undefined") {
    try { storage = globalThis.localStorage || null; } catch { storage = null; }
  }
  const key = options.key || STORAGE_KEY;
  const available = Boolean(storage &&
    typeof storage.getItem === "function" &&
    typeof storage.setItem === "function");

  function save(snapshot) {
    if (!available) return false;
    try {
      storage.setItem(key, JSON.stringify(snapshot));
      return true;
    } catch {
      return false;
    }
  }

  return {
    available,
    load() { return available ? readStorage(storage, key) : emptySnapshot(); },
    appendMany(newEvents, appendOptions = {}) {
      if (!available) return false;
      if (!Array.isArray(newEvents) || !newEvents.length) return true;
      const snapshot = readStorage(storage, key);
      const known = new Set(snapshot.events.map(event => event.id));
      const added = [];
      for (const event of newEvents) {
        if (asObject(event) && typeof event.id === "string" && !known.has(event.id)) {
          snapshot.events.push(clone(event));
          added.push(clone(event));
          known.add(event.id);
        }
      }
      snapshot.updatedAt = timestamp();
      const saved = save(snapshot);
      if (saved && added.length && appendOptions.remote !== true && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("knowverse:learning-events-appended", {
          detail: { events: added, remote: false }
        }));
      }
      return saved;
    },
    exportJSON() {
      return JSON.stringify({
        format: "knowverse-learning-progress",
        schemaVersion: SCHEMA_VERSION,
        exportedAt: timestamp(),
        data: this.load(),
      }, null, 2);
    },
    importJSON(raw, importOptions = {}) {
      if (!available) throw new Error("当前浏览器不支持本地存储。");
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      const envelope = asObject(parsed);
      if (!envelope || envelope.format !== "knowverse-learning-progress" || ![1, SCHEMA_VERSION].includes(envelope.schemaVersion)) {
        throw new Error("文件格式或版本不受支持。请使用 KNOWVERSE 导出的 JSON 文件。");
      }
      const incoming = normalizeSnapshot(envelope.data);
      if (!asObject(envelope.data) || ![1, SCHEMA_VERSION].includes(envelope.data.schemaVersion)) {
        throw new Error("学习记录数据不完整或版本不匹配。");
      }
      const replace = importOptions.replace === true;
      const current = replace ? emptySnapshot() : this.load();
      const known = new Set(current.events.map(event => event.id));
      for (const event of incoming.events) {
        if (!known.has(event.id)) {
          current.events.push(clone(event));
          known.add(event.id);
        }
      }
      current.updatedAt = timestamp();
      if (!current.events.length && incoming.events.length) current.events = incoming.events;
      if (!save(current)) throw new Error("写入本地存储失败，可能是浏览器空间不足。");
      if (incoming.events.length && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("knowverse:learning-events-appended", {
          detail: { events: incoming.events, remote: false, imported: true }
        }));
      }
      return { imported: incoming.events.length, total: current.events.length, mode: replace ? "replace" : "merge" };
    },
  };
}

const STATUS_LABELS = {
  unverified: "待验证",
  weak: "需要补强",
  building: "正在建立",
  initial: "初步掌握",
  stable: "稳定掌握",
};

function dayDistance(dateString, nowMs) {
  const parsed = Date.parse(dateString);
  return Number.isFinite(parsed) ? Math.max(0, (nowMs - parsed) / DAY_MS) : 0;
}

function addDays(dateString, days) {
  const date = new Date(dateString);
  date.setTime(date.getTime() + days * DAY_MS);
  return date.toISOString();
}

export function deriveLearningInsights(learningMap, challengeRegistry, snapshot, nowValue = new Date()) {
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const nowMs = now.getTime();
  const events = Array.isArray(snapshot?.events) ? snapshot.events.filter(event => validDate(event.at)) : [];
  const orderedEvents = events.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const challenges = new Map((challengeRegistry?.challenges || []).map(item => [item.id, item]));
  const topicDefinitions = Array.isArray(learningMap?.topics) ? learningMap.topics : [];
  const competencies = topicDefinitions.flatMap(topic =>
    (topic.competencies || []).map(item => ({
      ...item,
      topicId: topic.id,
      topicTitle: topic.title,
      topicAccent: topic.accent,
      topicHref: topic.href,
      topicChallengeId: topic.challengeId,
    }))
  );
  const gapDefinitions = new Map((learningMap?.gaps || []).map(item => [item.id, item]));
  const competencyById = new Map(competencies.map(item => [item.id, item]));
  const evidenceById = new Map(competencies.map(item => [item.id, []]));
  const attemptsById = new Map(competencies.map(item => [item.id, []]));
  const reviewsById = new Map(competencies.map(item => [item.id, []]));

  for (const event of events) {
    for (const id of event.competencyIds || []) {
      if (!competencyById.has(id)) continue;
      if (["completed", "assessment_passed"].includes(event.type)) evidenceById.get(id).push(event);
      if (event.type === "attempt") attemptsById.get(id).push(event);
      if (event.sessionType === "review") reviewsById.get(id).push(event);
    }
  }

  const dependentGraph = new Map(competencies.map(item => [item.id, new Set()]));
  for (const item of competencies) {
    for (const prerequisite of item.prerequisites || []) {
      if (dependentGraph.has(prerequisite)) dependentGraph.get(prerequisite).add(item.id);
    }
  }
  const downstreamCountById = new Map();
  for (const id of dependentGraph.keys()) {
    const seen = new Set();
    const pending = [...dependentGraph.get(id)];
    while (pending.length) {
      const child = pending.pop();
      if (seen.has(child)) continue;
      seen.add(child);
      for (const descendant of dependentGraph.get(child) || []) pending.push(descendant);
    }
    downstreamCountById.set(id, seen.size);
  }

  const competencyInsights = competencies.map(definition => {
    const evidence = (evidenceById.get(definition.id) || []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const attempts = (attemptsById.get(definition.id) || []).slice();
    const reviews = (reviewsById.get(definition.id) || []).slice();
    const recent = evidence.slice(-6);
    const weighted = recent.map((item, index) => {
      const age = dayDistance(item.at, nowMs);
      const recencyWeight = Math.pow(0.72, recent.length - index - 1);
      const freshnessWeight = Math.exp(-age / 120);
      return { score: clamp(Number(item.scorePct) || 0, 0, 100), weight: recencyWeight * freshnessWeight };
    });
    const weightTotal = weighted.reduce((sum, item) => sum + item.weight, 0);
    const masteryScore = weightTotal
      ? Math.round(weighted.reduce((sum, item) => sum + item.score * item.weight, 0) / weightTotal)
      : null;
    const latest = evidence[evidence.length - 1] || null;
    const distinctDays = new Set(evidence.map(item => String(item.at).slice(0, 10))).size;
    const latestScore = latest ? clamp(Number(latest.scorePct) || 0, 0, 100) : null;
    const variantIds = new Set(evidence.map(item =>
      item.variantId || (item.challengeId && item.stepId ? item.challengeId + ":" + item.stepId : item.id)
    ));
    const hintFreeCount = evidence.filter(item =>
      Number.isFinite(Number(item.hintsUsed)) && Number(item.hintsUsed) === 0
    ).length;
    const hintFreeRatio = evidence.length ? Math.round(hintFreeCount / evidence.length * 100) : 0;
    const confidenceScore = evidence.length
      ? clamp(Math.min(40, evidence.length * 20) + Math.min(25, distinctDays * 12) +
        Math.min(20, variantIds.size * 10) + Math.round(hintFreeRatio * 0.15), 0, 100)
      : 0;
    const confidenceLabel = confidenceScore >= 75 ? "高" : confidenceScore >= 40 ? "中" : evidence.length ? "低" : "尚无证据";

    const failedAttempts = attempts.filter(event => event.correct === false && event.gapId);
    const activeGaps = [];
    const resolvedGaps = [];
    for (const gapId of new Set(failedAttempts.map(event => event.gapId))) {
      const failures = failedAttempts.filter(event => event.gapId === gapId);
      const lastFailure = failures[failures.length - 1];
      const lastFailureIndex = events.indexOf(lastFailure);
      const afterFailure = events.filter((event, eventIndex) =>
        eventIndex > lastFailureIndex &&
        event.sessionType === "review" &&
        (event.competencyIds || []).includes(definition.id) &&
        event.gapId === gapId
      );
      let latestValidatedVariant = lastFailure.variantId || lastFailure.challengeId + ":" + lastFailure.stepId;
      let independentPass = null;
      for (const reviewEvent of afterFailure) {
        if (
          reviewEvent.type === "attempt" &&
          reviewEvent.correct === false &&
          typeof reviewEvent.variantId === "string" &&
          reviewEvent.variantId
        ) {
          latestValidatedVariant = reviewEvent.variantId;
          continue;
        }
        if (reviewEvent.type !== "assessment_passed") continue;
        if (
          Number.isFinite(Number(reviewEvent.hintsUsed)) &&
          Number(reviewEvent.hintsUsed) === 0 &&
          typeof reviewEvent.variantId === "string" &&
          reviewEvent.variantId.length > 0 &&
          reviewEvent.variantId !== latestValidatedVariant
        ) {
          independentPass = reviewEvent;
          break;
        }
        if (typeof reviewEvent.variantId === "string" && reviewEvent.variantId) {
          latestValidatedVariant = reviewEvent.variantId;
        }
      }
      const assistedOrSameVariantPass = afterFailure.some(event => event.type === "assessment_passed");
      const latestReviewActivity = afterFailure[afterFailure.length - 1] || null;
      const mapGap = gapDefinitions.get(gapId);
      const baseGap = {
        id: gapId,
        label: mapGap?.label || gapId,
        description: mapGap?.description || "",
        count: failures.length,
        lastSeenAt: lastFailure.at,
        topicId: definition.topicId,
        topicTitle: definition.topicTitle,
        competencyId: definition.id,
        competencyTitle: definition.title,
        challengeId: mapGap?.challengeId || definition.topicChallengeId || latest?.challengeId || null,
        lessonHref: definition.lessonHref || definition.topicHref,
        challengeHref: definition.challengeHref || null,
        targetGapId: gapId,
        lastFailureVariantId: lastFailure.variantId || lastFailure.challengeId + ":" + lastFailure.stepId,
        verificationVariantId: independentPass?.variantId || null,
      };
      if (independentPass) {
        resolvedGaps.push({ ...baseGap, lifecycle: "resolved", lifecycleLabel: "已独立纠正", resolvedAt: independentPass.at });
      } else {
        let lifecycle = "detected";
        let lifecycleLabel = "待复习";
        if (assistedOrSameVariantPass) {
          lifecycle = "pending-verification";
          lifecycleLabel = "已纠正 · 待独立确认";
        } else if (latestReviewActivity?.type === "review_started") {
          lifecycle = "reviewing";
          lifecycleLabel = "复习进行中";
        }
        activeGaps.push({ ...baseGap, lifecycle, lifecycleLabel });
      }
    }

    let status = "unverified";
    if (activeGaps.length) status = "weak";
    else if (evidence.length) {
      if (latestScore < 60 || masteryScore < 55) status = "weak";
      else if (
        evidence.length >= 2 &&
        distinctDays >= 2 &&
        variantIds.size >= 2 &&
        masteryScore >= 85 &&
        latestScore >= 80 &&
        evidence.slice(-2).every(item =>
          Number.isFinite(Number(item.hintsUsed)) && Number(item.hintsUsed) === 0
        )
      ) status = "stable";
      else if (masteryScore >= 80) status = "initial";
      else if (masteryScore >= 60) status = "building";
      else status = "weak";
    }

    let intervalDays = 0;
    let nextReviewAt = null;
    if (latest) {
      if (latestScore < 60 || masteryScore < 65 || activeGaps.length) intervalDays = 1;
      else if (masteryScore < 75) intervalDays = 3;
      else if (masteryScore < 90) intervalDays = 7;
      else intervalDays = status === "stable" ? Math.min(30, 14 + Math.max(0, evidence.length - 2) * 4) : 14;
      nextReviewAt = addDays(latest.at, intervalDays);
    } else if (activeGaps.length) {
      nextReviewAt = now.toISOString();
      intervalDays = 0;
    }

    return {
      ...definition,
      evidenceCount: evidence.length,
      attemptsCount: attempts.length,
      reviewCount: reviews.filter(event => event.type === "assessment_passed").length,
      distinctDays,
      variantCount: variantIds.size,
      hintFreeRatio,
      masteryScore,
      confidenceScore,
      confidenceLabel,
      latestScore,
      status,
      statusLabel: STATUS_LABELS[status],
      nextReviewAt,
      intervalDays,
      isDue: Boolean(activeGaps.length || (nextReviewAt && Date.parse(nextReviewAt) <= nowMs)),
      lastEvidenceAt: latest?.at || null,
      activeGaps,
      resolvedGaps,
      evidence,
    };
  });

  const gaps = competencyInsights.flatMap(item => item.activeGaps)
    .sort((a, b) => b.count - a.count || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  const resolvedGaps = competencyInsights.flatMap(item => item.resolvedGaps);
  const weakCompetencies = competencyInsights.filter(item =>
    item.status === "weak" || item.status === "building"
  );
  const gapCompetencyIds = new Set(gaps.map(item => item.competencyId));
  const reviewQueue = gaps.map(gap => {
    const state = competencyById.get(gap.competencyId);
    const gapAge = dayDistance(gap.lastSeenAt, nowMs);
    const downstreamCount = downstreamCountById.get(gap.competencyId) || 0;
    const priority = 70 + Math.min(20, gap.count * 4) + Math.min(10, gapAge) +
      Math.min(10, downstreamCount) +
      (gap.lifecycle === "pending-verification" ? 8 : gap.lifecycle === "reviewing" ? 4 : 0);
    const priorityReasons = [
      gap.count > 1 ? "重复错误 " + gap.count + " 次" : "新发现的概念误区",
      gapAge >= 1 ? "已持续 " + Math.floor(gapAge) + " 天" : "今天发现",
      downstreamCount ? "影响 " + downstreamCount + " 个下游知识点" : null,
      gap.lifecycle === "pending-verification" ? "等待无提示独立确认" : null,
    ].filter(Boolean);
    const assessmentHref = "./review/?competencyId=" + encodeURIComponent(gap.competencyId) +
      "&gapId=" + encodeURIComponent(gap.id);
    return {
      kind: "gap",
      id: gap.id,
      title: gap.label,
      topicId: gap.topicId,
      topicTitle: gap.topicTitle,
      competencyId: gap.competencyId,
      competencyTitle: gap.competencyTitle,
      masteryScore: state?.masteryScore,
      confidenceScore: state?.confidenceScore,
      lifecycle: gap.lifecycle,
      lifecycleLabel: gap.lifecycleLabel,
      isDue: true,
      nextReviewAt: now.toISOString(),
      intervalDays: 0,
      priority,
      priorityReasons,
      challengeHref: assessmentHref,
      reviewHref: assessmentHref,
    };
  });
  for (const item of competencyInsights) {
    if (!item.evidenceCount || !item.nextReviewAt || gapCompetencyIds.has(item.id)) continue;
    const downstreamCount = downstreamCountById.get(item.id) || 0;
    const priority = (item.isDue ? 45 : 10) + (item.status === "weak" ? 25 : 0) +
      (100 - (item.masteryScore || 0)) * 0.25 +
      Math.min(10, downstreamCount);
    const priorityReasons = [
      item.isDue ? "复习时间已到" : "周期复习安排",
      item.status === "weak" ? "近期表现需要补强" : null,
      downstreamCount ? "影响 " + downstreamCount + " 个下游知识点" : null,
      "掌握度 " + item.masteryScore + "%",
    ].filter(Boolean);
    reviewQueue.push({
      kind: "competency",
      id: item.id,
      title: item.title,
      topicId: item.topicId,
      topicTitle: item.topicTitle,
      competencyId: item.id,
      competencyTitle: item.title,
      masteryScore: item.masteryScore,
      confidenceScore: item.confidenceScore,
      lifecycle: "scheduled",
      lifecycleLabel: item.isDue ? "复习已到期" : "计划复习",
      isDue: item.isDue,
      nextReviewAt: item.nextReviewAt,
      intervalDays: item.intervalDays,
      priority,
      priorityReasons,
      challengeHref: "./review/?competencyId=" + encodeURIComponent(item.id),
      reviewHref: "./review/?competencyId=" + encodeURIComponent(item.id),
    });
  }
  reviewQueue.sort((a, b) => b.priority - a.priority || Date.parse(a.nextReviewAt) - Date.parse(b.nextReviewAt));

  const topicInsights = topicDefinitions.map(topic => {
    const nodes = competencyInsights.filter(item => item.topicId === topic.id);
    const testedNodes = nodes.filter(item => item.evidenceCount);
    const scores = testedNodes.map(item => item.masteryScore).filter(Number.isFinite);
    return {
      ...topic,
      competencies: nodes,
      testedCount: testedNodes.length,
      totalCount: nodes.length,
      stableCount: nodes.filter(item => item.status === "stable").length,
      averageScore: scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null,
    };
  });

  const recentEvents = events.slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 40);
  const challengeCounts = new Map();
  for (const event of events) {
    if (!["attempt", "completed", "assessment_passed", "hint", "hint_revealed"].includes(event.type)) continue;
    const key = event.challengeId;
    if (!challengeCounts.has(key)) challengeCounts.set(key, { challengeId: key, title: event.challengeTitle || key, attempts: 0, completed: 0, hints: 0 });
    const item = challengeCounts.get(key);
    if (event.type === "attempt") item.attempts += 1;
    if (["completed", "assessment_passed"].includes(event.type)) item.completed += 1;
    if (["hint", "hint_revealed"].includes(event.type)) item.hints += 1;
  }

  const tested = competencyInsights.filter(item => item.evidenceCount);
  const stable = competencyInsights.filter(item => item.status === "stable");
  const dueCount = reviewQueue.filter(item => item.isDue).length;
  return {
    eventsCount: events.length,
    competencyInsights,
    topicInsights,
    gaps,
    resolvedGaps,
    weakCompetencies,
    reviewQueue,
    recentEvents,
    challengeStats: [...challengeCounts.values()],
    summary: {
      testedCount: tested.length,
      totalCount: competencyInsights.length,
      stableCount: stable.length,
      weakCount: weakCompetencies.length,
      activeGapCount: gaps.length,
      resolvedGapCount: resolvedGaps.length,
      pendingVerificationCount: gaps.filter(item => item.lifecycle === "pending-verification").length,
      dueCount,
      averageScore: tested.length
        ? Math.round(tested.reduce((sum, item) => sum + (item.masteryScore || 0), 0) / tested.length)
        : null,
      averageConfidence: tested.length
        ? Math.round(tested.reduce((sum, item) => sum + (item.confidenceScore || 0), 0) / tested.length)
        : null,
      attempts: events.filter(event => event.type === "attempt").length,
      completions: events.filter(event => ["completed", "assessment_passed"].includes(event.type)).length,
      hints: events.filter(event => ["hint", "hint_revealed"].includes(event.type)).length,
    },
    statusLabels: STATUS_LABELS,
    challenges,
    generatedAt: now.toISOString(),
  };
}
