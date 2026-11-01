const SCHEMA_VERSION = 1;
const STORAGE_KEY = "knowverse:learning-progress:v1";
const MAX_EVENTS = 5000;
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
  if (!source || source.schemaVersion !== SCHEMA_VERSION || !Array.isArray(source.events)) {
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
  ).slice(-MAX_EVENTS);
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
    return raw ? normalizeSnapshot(JSON.parse(raw)) : emptySnapshot();
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
    appendMany(newEvents) {
      if (!available) return false;
      if (!Array.isArray(newEvents) || !newEvents.length) return true;
      const snapshot = readStorage(storage, key);
      const known = new Set(snapshot.events.map(event => event.id));
      for (const event of newEvents) {
        if (asObject(event) && typeof event.id === "string" && !known.has(event.id)) {
          snapshot.events.push(clone(event));
          known.add(event.id);
        }
      }
      snapshot.events = snapshot.events.slice(-MAX_EVENTS);
      snapshot.updatedAt = timestamp();
      return save(snapshot);
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
      if (!envelope || envelope.format !== "knowverse-learning-progress" || envelope.schemaVersion !== SCHEMA_VERSION) {
        throw new Error("文件格式或版本不受支持。请使用 KNOWVERSE 导出的 JSON 文件。");
      }
      const incoming = normalizeSnapshot(envelope.data);
      if (!asObject(envelope.data) || envelope.data.schemaVersion !== SCHEMA_VERSION) {
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
      current.events = current.events.slice(-MAX_EVENTS);
      current.updatedAt = timestamp();
      if (!current.events.length && incoming.events.length) current.events = incoming.events.slice(-MAX_EVENTS);
      if (!save(current)) throw new Error("写入本地存储失败，可能是浏览器空间不足。");
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
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  const challenges = new Map((challengeRegistry?.challenges || []).map(item => [item.id, item]));
  const topicDefinitions = Array.isArray(learningMap?.topics) ? learningMap.topics : [];
  const competencies = topicDefinitions.flatMap(topic =>
    (topic.competencies || []).map(item => ({ ...item, topicId: topic.id, topicTitle: topic.title, topicAccent: topic.accent, topicHref: topic.href }))
  );
  const competencyById = new Map(competencies.map(item => [item.id, item]));
  const evidenceById = new Map(competencies.map(item => [item.id, []]));
  const attemptsById = new Map(competencies.map(item => [item.id, []]));

  for (const event of events) {
    for (const id of event.competencyIds || []) {
      if (event.type === "completed" && evidenceById.has(id)) evidenceById.get(id).push(event);
      if (event.type === "attempt" && attemptsById.has(id)) attemptsById.get(id).push(event);
    }
  }

  const competencyInsights = competencies.map(definition => {
    const evidence = (evidenceById.get(definition.id) || []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const attempts = (attemptsById.get(definition.id) || []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
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

    let status = "unverified";
    if (evidence.length) {
      if (latestScore < 60 || masteryScore < 55) status = "weak";
      else if (
        evidence.length >= 2 &&
        distinctDays >= 2 &&
        masteryScore >= 85 &&
        latestScore >= 80 &&
        evidence.slice(-2).every(item => Number(item.hintsUsed || 0) === 0)
      ) status = "stable";
      else if (masteryScore >= 80) status = "initial";
      else if (masteryScore >= 60) status = "building";
      else status = "weak";
    }

    let intervalDays = 0;
    let nextReviewAt = null;
    if (latest) {
      if (latestScore < 60 || masteryScore < 65) intervalDays = 1;
      else if (masteryScore < 75) intervalDays = 3;
      else if (masteryScore < 90) intervalDays = 7;
      else intervalDays = status === "stable" ? Math.min(30, 14 + Math.max(0, evidence.length - 2) * 4) : 14;
      nextReviewAt = addDays(latest.at, intervalDays);
    }

    const gapEvents = attempts.filter(event => event.correct === false && event.gapId);
    const activeGaps = [];
    for (const gapId of new Set(gapEvents.map(event => event.gapId))) {
      const failures = gapEvents.filter(event => event.gapId === gapId);
      const lastFailure = failures[failures.length - 1];
      const resolvedBy = evidence.find(item => Date.parse(item.at) > Date.parse(lastFailure.at));
      if (!resolvedBy) {
        const mapGap = (learningMap.gaps || []).find(item => item.id === gapId);
        activeGaps.push({
          id: gapId,
          label: mapGap?.label || gapId,
          description: mapGap?.description || "",
          count: failures.length,
          lastSeenAt: lastFailure.at,
          topicId: definition.topicId,
          competencyId: definition.id,
          competencyTitle: definition.title,
          challengeId: mapGap?.challengeId || latest?.challengeId || null,
          lessonHref: definition.lessonHref || definition.topicHref,
          challengeHref: definition.challengeHref || null,
        });
      }
    }

    return {
      ...definition,
      evidenceCount: evidence.length,
      attemptsCount: attempts.length,
      distinctDays,
      masteryScore,
      latestScore,
      status,
      statusLabel: STATUS_LABELS[status],
      nextReviewAt,
      intervalDays,
      isDue: Boolean(nextReviewAt && Date.parse(nextReviewAt) <= nowMs),
      lastEvidenceAt: latest?.at || null,
      activeGaps,
      evidence,
    };
  });

  const gaps = competencyInsights.flatMap(item => item.activeGaps)
    .sort((a, b) => b.count - a.count || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  const weakCompetencies = competencyInsights.filter(item =>
    item.evidenceCount && (item.status === "weak" || item.status === "building")
  );
  const reviewQueue = competencyInsights.filter(item => item.evidenceCount && item.nextReviewAt)
    .sort((a, b) => {
      const weakDelta = Number(b.status === "weak") - Number(a.status === "weak");
      return weakDelta || Date.parse(a.nextReviewAt) - Date.parse(b.nextReviewAt);
    });
  const tested = competencyInsights.filter(item => item.evidenceCount);
  const stable = competencyInsights.filter(item => item.status === "stable");

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

  const recentEvents = events.slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 24);
  const challengeCounts = new Map();
  for (const event of events) {
    const key = event.challengeId;
    if (!challengeCounts.has(key)) challengeCounts.set(key, { challengeId: key, title: event.challengeTitle || key, attempts: 0, completed: 0, hints: 0 });
    const item = challengeCounts.get(key);
    if (event.type === "attempt") item.attempts += 1;
    if (event.type === "completed") item.completed += 1;
    if (event.type === "hint") item.hints += 1;
  }

  return {
    eventsCount: events.length,
    competencyInsights,
    topicInsights,
    gaps,
    weakCompetencies,
    reviewQueue,
    recentEvents,
    challengeStats: [...challengeCounts.values()],
    summary: {
      testedCount: tested.length,
      totalCount: competencyInsights.length,
      stableCount: stable.length,
      weakCount: weakCompetencies.length + gaps.length,
      dueCount: reviewQueue.filter(item => item.isDue).length,
      averageScore: tested.length
        ? Math.round(tested.reduce((sum, item) => sum + (item.masteryScore || 0), 0) / tested.length)
        : null,
      attempts: events.filter(event => event.type === "attempt").length,
      completions: events.filter(event => event.type === "completed").length,
      hints: events.filter(event => event.type === "hint").length,
    },
    statusLabels: STATUS_LABELS,
    challenges,
    generatedAt: now.toISOString(),
  };
}
