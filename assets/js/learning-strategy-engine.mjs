import { getLearningRepository } from "./backend/learning-repository.mjs";

export const LEARNING_STRATEGY_VERSION = 1;
export const LEARNING_STRATEGY_DOCUMENT_TYPE = "learner_profile";
export const LEARNING_STRATEGY_DOCUMENT_KEY = "strategy";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 180;
const COOLDOWN_MS = 72 * 60 * 60 * 1000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const validTime = value => Number.isFinite(Date.parse(value));
const round = value => Number(value.toFixed(3));
const clone = value => JSON.parse(JSON.stringify(value));
const stableHash = value => {
  const source = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
};
const modeOf = value => value === "default" ? "default" : "adaptive";
const emptyParameters = () => ({
  taskLoadMultiplier: 1,
  reviewIntervalMultiplier: 1,
  difficultyBias: 0,
  difficultyBiasByCompetency: {},
  interventionPreference: "active-recall",
  reviewIntervalsByCompetency: {},
});

function uniqueEvents(events, now) {
  const byId = new Map();
  const cutoff = now.getTime() - WINDOW_DAYS * DAY_MS;
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event.id !== "string" || !event.id ||
        typeof event.type !== "string" || !validTime(event.at) ||
        Date.parse(event.at) > now.getTime() || Date.parse(event.at) < cutoff) continue;
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) =>
    Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
}

function competencyIds(event) {
  return [...new Set(Array.isArray(event.competencyIds)
    ? event.competencyIds.filter(value => typeof value === "string" && value)
    : [])];
}

function recencyWeight(event, now) {
  const age = Math.max(0, now.getTime() - Date.parse(event.at));
  return Math.pow(0.5, age / (60 * DAY_MS));
}

function classifyEvidence(events, now) {
  const assessments = events.filter(event => ["assessment_passed", "completed"].includes(event.type) &&
    (event.type !== "completed" || event.independent === true));
  const attempts = events.filter(event => event.type === "attempt");
  const hintEvents = events.filter(event => ["hint", "hint_revealed"].includes(event.type));
  const assisted = assessments.filter(event =>
    event.independent === false || Number(event.hintsUsed || 0) > 0);

  // A session is one evidence unit. A final assessment_passed supersedes earlier wrong attempts;
  // an unassisted failed challenge attempt remains a failure outcome when no pass exists.
  const assessmentSessions = new Map();
  for (const event of [...assessments, ...attempts]) {
    const key = (event.sessionId || event.id) + (event.stepId ? "::" + event.stepId : "");
    if (!assessmentSessions.has(key)) assessmentSessions.set(key, []);
    assessmentSessions.get(key).push(event);
  }
  const independentOutcomes = [];
  for (const [sessionId, rows] of assessmentSessions) {
    const sessionAssessments = rows.filter(item => ["assessment_passed", "completed"].includes(item.type))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (sessionAssessments.length) {
      const finalPass = sessionAssessments.at(-1);
      if (finalPass.independent === true && Number(finalPass.hintsUsed || 0) === 0) {
        independentOutcomes.push({
          sessionId, eventId: finalPass.id, passed: true, at: finalPass.at,
          competencyIds: competencyIds(finalPass), variantId: finalPass.variantId || null,
          scorePct: Number.isFinite(Number(finalPass.scorePct)) ? Number(finalPass.scorePct) : null,
        });
      }
      continue;
    }
    const lastAttempt = rows.filter(item => item.type === "attempt")
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
    if (lastAttempt?.correct === false && Number(lastAttempt.hintsUsed || 0) === 0 &&
        lastAttempt.sessionType !== "review") {
      independentOutcomes.push({
        sessionId, eventId: lastAttempt.id, passed: false, at: lastAttempt.at,
        competencyIds: competencyIds(lastAttempt), variantId: lastAttempt.variantId || null,
        scorePct: null,
      });
    }
  }
  const independent = independentOutcomes.filter(item => item.passed);
  const independentFailures = independentOutcomes.filter(item => !item.passed);

  const taskTerminalTypes = new Set([
    "learning_task_completed", "learning_task_failed",
    "learning_task_skipped", "learning_task_cancelled",
  ]);
  const terminalByTask = new Map();
  for (const event of events.filter(item => taskTerminalTypes.has(item.type) && item.taskId)) {
    const prior = terminalByTask.get(event.taskId);
    if (!prior || Date.parse(event.at) >= Date.parse(prior.at)) terminalByTask.set(event.taskId, event);
  }
  const terminalTasks = [...terminalByTask.values()];
  const completedTasks = terminalTasks.filter(event => event.type === "learning_task_completed");
  const taskDurations = completedTasks.map(item => Number(item.durationSeconds))
    .filter(value => Number.isFinite(value) && value > 0).map(value => value / 60);
  const sortedDurations = taskDurations.slice().sort((a, b) => a - b);
  const completionDays = [...new Set(completedTasks.map(item => item.at.slice(0, 10)))].sort();
  const completionGaps = completionDays.slice(1).map((day, index) =>
    (Date.parse(day + "T00:00:00Z") - Date.parse(completionDays[index] + "T00:00:00Z")) / DAY_MS);
  const meanCompletionGap = completionGaps.length
    ? completionGaps.reduce((sum, value) => sum + value, 0) / completionGaps.length : null;
  const cadenceCv = meanCompletionGap && completionGaps.length > 1
    ? Math.sqrt(completionGaps.reduce((sum, value) => sum + (value - meanCompletionGap) ** 2, 0) /
      completionGaps.length) / meanCompletionGap : null;
  let longestCompletionStreakDays = 0;
  let currentCompletionStreak = 0;
  let priorDay = null;
  for (const day of completionDays) {
    const timestamp = Date.parse(day + "T00:00:00Z");
    currentCompletionStreak = priorDay !== null && timestamp - priorDay === DAY_MS
      ? currentCompletionStreak + 1 : 1;
    longestCompletionStreakDays = Math.max(longestCompletionStreakDays, currentCompletionStreak);
    priorDay = timestamp;
  }
  const acceptedPlans = events.filter(event => event.type === "learning_plan_accepted");
  const rejectedPlans = events.filter(event => event.type === "learning_plan_rejected");

  // Delay is measured from the most recent earlier assessment on the same competency to review_started.
  // The review session is grouped once, so a failed attempt is not lost and a pass is not double-counted.
  const reviewSessions = new Map();
  for (const event of events.filter(item =>
    item.sessionType === "review" &&
    ["review_started", "attempt", "assessment_passed", "hint", "hint_revealed"].includes(item.type))) {
    const key = (event.sessionId || event.id) + (event.stepId ? "::" + event.stepId : "");
    if (!reviewSessions.has(key)) reviewSessions.set(key, []);
    reviewSessions.get(key).push(event);
  }
  const delayedRecall = [];
  for (const [sessionId, rows] of reviewSessions) {
    const start = rows.find(item => item.type === "review_started") || rows[0];
    const ids = new Set(rows.flatMap(competencyIds));
    if (!ids.size) continue;
    const startAt = Date.parse(start.at);
    const prior = assessments
      .filter(candidate => candidate.sessionId !== sessionId &&
        Date.parse(candidate.at) < startAt &&
        competencyIds(candidate).some(id => ids.has(id)))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    const delayDays = prior ? (startAt - Date.parse(prior.at)) / DAY_MS : null;
    const pass = rows.filter(item => item.type === "assessment_passed")
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
    const failedAttempt = rows.some(item => item.type === "attempt" && item.correct === false);
    const hasOutcome = Boolean(pass) || failedAttempt;
    if (delayDays === null || delayDays < 2 || !hasOutcome) continue;
    const usedHints = rows.some(item =>
      ["hint", "hint_revealed"].includes(item.type) || Number(item.hintsUsed || 0) > 0);
    const independentPass = Boolean(pass && !usedHints && pass.independent === true &&
      Number(pass.hintsUsed || 0) === 0 && Number(pass.scorePct) >= 70);
    const assistedPass = Boolean(pass && !independentPass);
    const assistedFailure = Boolean(!pass && failedAttempt && usedHints);
    if (!independentPass && !assistedPass && !failedAttempt) continue;
    const outcomeEvent = pass || rows.filter(item => item.type === "attempt")
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    delayedRecall.push({
      sessionId,
      eventId: outcomeEvent.id,
      competencyIds: [...ids],
      delayDays: round(delayDays),
      passed: independentPass,
      assisted: assistedPass || assistedFailure,
      outcome: independentPass ? "independent-pass"
        : assistedPass ? "assisted-pass"
          : assistedFailure ? "assisted-failure" : "failed",
      scorePct: pass && Number.isFinite(Number(pass.scorePct)) ? Number(pass.scorePct) : null,
      at: outcomeEvent.at,
    });
  }

  const abilityWeight = independentOutcomes.reduce((sum, item) => sum + recencyWeight(item, now), 0);
  const independentPassWeight = independent.reduce((sum, item) => sum + recencyWeight(item, now), 0);
  const independentDelayed = delayedRecall.filter(item => !item.assisted);
  const delayedWeight = independentDelayed.reduce((sum, item) => sum + recencyWeight(item, now), 0);
  const delayedSuccessWeight = independentDelayed.filter(item => item.passed)
    .reduce((sum, item) => sum + recencyWeight(item, now), 0);
  const delayedByCompetency = {};
  for (const item of independentDelayed) {
    for (const competencyId of item.competencyIds) {
      const summary = delayedByCompetency[competencyId] ||= {
        independentObservations: 0, successful: 0, failed: 0,
        weightedSuccessRate: null, successRate: null, evidenceRefs: [],
      };
      summary.independentObservations += 1;
      if (item.passed) summary.successful += 1;
      else summary.failed += 1;
      summary.evidenceRefs.push(item.eventId);
    }
  }
  for (const summary of Object.values(delayedByCompetency)) {
    const matching = independentDelayed.filter(item =>
      item.competencyIds.some(id => summary.evidenceRefs.includes(item.eventId)));
    const weight = matching.reduce((sum, item) => sum + recencyWeight(item, now), 0);
    const successWeight = matching.filter(item => item.passed)
      .reduce((sum, item) => sum + recencyWeight(item, now), 0);
    summary.successRate = round(summary.successful / summary.independentObservations);
    summary.weightedSuccessRate = weight ? round(successWeight / weight) : null;
    summary.evidenceRefs = [...new Set(summary.evidenceRefs)].slice(-20);
  }
  const abilityByCompetency = {};
  for (const outcome of independentOutcomes) {
    for (const competencyId of outcome.competencyIds) {
      const summary = abilityByCompetency[competencyId] ||= {
        independentOutcomes: 0, passes: 0, failures: 0,
        variants: new Set(), evidenceRefs: [],
        weightedOutcomeSamples: 0, weightedPassSamples: 0,
      };
      summary.independentOutcomes += 1;
      if (outcome.passed) summary.passes += 1;
      else summary.failures += 1;
      if (outcome.variantId) summary.variants.add(outcome.variantId);
      summary.evidenceRefs.push(outcome.eventId);
      const weight = recencyWeight(outcome, now);
      summary.weightedOutcomeSamples += weight;
      if (outcome.passed) summary.weightedPassSamples += weight;
    }
  }
  for (const summary of Object.values(abilityByCompetency)) {
    summary.distinctVariants = summary.variants.size;
    summary.weightedPassRate = summary.weightedOutcomeSamples
      ? round(summary.weightedPassSamples / summary.weightedOutcomeSamples) : null;
    summary.passRate = summary.independentOutcomes
      ? round(summary.passes / summary.independentOutcomes) : null;
    summary.variants = [...summary.variants].sort();
    summary.evidenceRefs = [...new Set(summary.evidenceRefs)].slice(-20);
  }

  const byCompetency = new Map();
  for (const item of independent) {
    for (const id of item.competencyIds) {
      if (!byCompetency.has(id)) byCompetency.set(id, []);
      byCompetency.get(id).push(item);
    }
  }
  const stableCompetencies = [];
  for (const [id, rows] of byCompetency) {
    const dates = new Set(rows.map(item => item.at.slice(0, 10)));
    const variants = new Set(rows.map(item => item.variantId).filter(Boolean));
    const ordered = rows.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const spreadDays = ordered.length > 1
      ? (Date.parse(ordered.at(-1).at) - Date.parse(ordered[0].at)) / DAY_MS
      : 0;
    if (rows.length >= 3 && dates.size >= 2 && variants.size >= 2 && spreadDays >= 7) {
      stableCompetencies.push({ competencyId: id, evidenceRefs: ordered.map(item => item.eventId).slice(-10) });
    }
  }
  const hintAssistedAttempts = attempts.filter(event => Number(event.hintsUsed || 0) > 0);
  const variants = new Set(independentOutcomes.map(item => item.variantId).filter(Boolean));
  const independentPassRate = independentOutcomes.length
    ? independent.length / independentOutcomes.length : null;
  return {
    behavior: {
      acceptedPlans: acceptedPlans.length,
      rejectedPlans: rejectedPlans.length,
      terminalTasks: terminalTasks.length,
      completedTasks: completedTasks.length,
      skippedTasks: terminalTasks.filter(item => item.type === "learning_task_skipped").length,
      taskCompletionRate: terminalTasks.length ? round(completedTasks.length / terminalTasks.length) : null,
      completedTasksWithDuration: taskDurations.length,
      averageTaskDurationMinutes: taskDurations.length
        ? round(taskDurations.reduce((sum, value) => sum + value, 0) / taskDurations.length) : null,
      medianTaskDurationMinutes: taskDurations.length
        ? round(sortedDurations.length % 2
          ? sortedDurations[Math.floor(sortedDurations.length / 2)]
          : (sortedDurations[sortedDurations.length / 2 - 1] + sortedDurations[sortedDurations.length / 2]) / 2)
        : null,
      activeCompletionDays: completionDays.length,
      longestCompletionStreakDays,
      dailyCompletionCadenceCv: cadenceCv === null ? null : round(cadenceCv),
    },
    process: {
      attempts: attempts.length,
      hintEvents: hintEvents.length,
      hintAssistedAttempts: hintAssistedAttempts.length,
      hintDependencyRate: attempts.length ? round(hintAssistedAttempts.length / attempts.length) : null,
      independentPasses: independent.length,
      assistedPasses: assisted.length,
    },
    ability: {
      independentPasses: independent.length,
      independentFailures: independentFailures.length,
      independentOutcomes: independentOutcomes.length,
      assistedPasses: assisted.length,
      independentPassRate: independentPassRate === null ? null : round(independentPassRate),
      distinctVariants: variants.size,
      weightedIndependentPassRate: abilityWeight ? round(independentPassWeight / abilityWeight) : null,
      byCompetency: abilityByCompetency,
      evidenceRefs: independentOutcomes.map(item => item.eventId).slice(-30),
    },
    delayedRecall: {
      observations: delayedRecall.length,
      independentObservations: independentDelayed.length,
      assistedObservations: delayedRecall.filter(item => item.assisted).length,
      successful: independentDelayed.filter(item => item.passed).length,
      failed: independentDelayed.filter(item => item.outcome === "failed").length,
      successRate: independentDelayed.length
        ? round(independentDelayed.filter(item => item.passed).length / independentDelayed.length)
        : null,
      weightedSuccessRate: delayedWeight ? round(delayedSuccessWeight / delayedWeight) : null,
      byCompetency: delayedByCompetency,
      observationsByDelay: delayedRecall.slice(-30),
      evidenceRefs: delayedRecall.map(item => item.eventId).slice(-30),
    },
    transfer: {
      distinctVariants: variants.size,
      competenciesWithCrossVariantEvidence: stableCompetencies.length,
      stableCompetencies,
    },
    longTerm: {
      stableCompetencies: stableCompetencies.length,
      stableEvidenceCount: stableCompetencies.reduce((sum, item) => sum + item.evidenceRefs.length, 0),
      evidenceRefs: stableCompetencies.flatMap(item => item.evidenceRefs).slice(-30),
    },
    decay: {
      method: "exponential",
      halfLifeDays: 60,
      effectiveAssessmentSamples: round(abilityWeight),
      effectiveIndependentSamples: round(independentPassWeight),
      effectiveIndependentOutcomes: round(abilityWeight),
      effectiveDelayedRecallSamples: round(delayedWeight),
    },
    sampleCounts: {
      behavior: acceptedPlans.length + terminalTasks.length,
      process: attempts.length + hintEvents.length,
      ability: independentOutcomes.length + assisted.length,
      independent: independent.length,
      independentOutcomes: independentOutcomes.length,
      delayedRecall: independentDelayed.length,
      delayedRecallSessions: delayedRecall.length,
      delayedRecallAssisted: delayedRecall.filter(item => item.assisted).length,
      transfer: variants.size,
      longTerm: stableCompetencies.length,
    },
  };
}

function confidenceFor(evidence) {
  const independent = evidence.sampleCounts.independentOutcomes;
  const delayed = evidence.decay.effectiveDelayedRecallSamples;
  const tasks = evidence.behavior.terminalTasks;
  const weightedSamples = independent + delayed * 1.5 + tasks * 0.5;
  const consistency = (() => {
    const rate = evidence.delayedRecall.weightedSuccessRate ?? evidence.delayedRecall.successRate;
    if (rate === null) return 0.75;
    return 0.5 + Math.abs(rate - 0.5);
  })();
  const score = (1 - Math.exp(-weightedSamples / 8)) * consistency;
  const level = independent >= 8 && delayed >= 4 && score >= 0.65
    ? "high"
    : independent >= 3 || delayed >= 2 || tasks >= 6
      ? "medium" : "low";
  return { level, score: round(score), weightedSamples: round(weightedSamples) };
}

function moveToward(current, target, step, min, max) {
  const safeCurrent = clamp(Number(current) || 1, min, max);
  if (target === safeCurrent) return safeCurrent;
  const next = safeCurrent + Math.sign(target - safeCurrent) * step;
  return round(clamp(next, min, max));
}

function candidateParameters(evidence, previousParameters) {
  const next = { ...previousParameters };
  const reasons = [];
  const refs = [];
  const terminalTasks = evidence.behavior.terminalTasks;
  if (terminalTasks >= 6) {
    const rate = evidence.behavior.taskCompletionRate;
    const target = rate <= 0.5 ? 0.9 : 1;
    if (target !== next.taskLoadMultiplier) {
      next.taskLoadMultiplier = target;
      reasons.push(rate <= 0.5
        ? "近期任务中断或未完成比例偏高，适度降低下一周期任务密度"
        : "任务完成情况处于可持续区间，保持用户设定的时间预算");
    }
  }
  if (terminalTasks < 6 && next.taskLoadMultiplier < 1) {
    next.taskLoadMultiplier = moveToward(next.taskLoadMultiplier, 1, 0.05, 0.85, 1);
    reasons.push("近期任务密度证据已不足，逐步恢复用户设定的完整时间预算");
  }
  const intervalTargets = {};
  const qualifiedIntervalIds = new Set(Object.entries(evidence.delayedRecall.byCompetency || {})
    .filter(([, summary]) => summary.independentObservations >= 3)
    .map(([competencyId]) => competencyId));
  const previousIntervals = { ...(next.reviewIntervalsByCompetency || {}) };
  const currentIntervals = Object.fromEntries(Object.entries(previousIntervals)
    .filter(([competencyId]) => qualifiedIntervalIds.has(competencyId)));
  if (Object.keys(currentIntervals).length !== Object.keys(previousIntervals).length) {
    next.reviewIntervalsByCompetency = currentIntervals;
    reasons.push("部分知识点的独立延迟复习证据已退出观察窗口或低于门槛，自动恢复通用复习间隔");
  }
  for (const [competencyId, summary] of Object.entries(evidence.delayedRecall.byCompetency || {})) {
    if (summary.independentObservations < 3) continue;
    const rate = summary.weightedSuccessRate ?? summary.successRate;
    const target = rate >= 0.8 ? 1.1 : rate <= 0.5 ? 0.9 : 1;
    const current = Number(currentIntervals[competencyId]) || 1;
    if (target !== current) {
      intervalTargets[competencyId] = target;
      refs.push(...summary.evidenceRefs);
    }
  }
  if (Object.keys(intervalTargets).length) {
    reasons.push("仅对达到 3 次独立延迟回忆门槛的知识点单独校准复习间隔；其他知识点继续使用通用调度");
  }
  const difficultyTargets = {};
  const qualifiedDifficultyIds = new Set(Object.entries(evidence.ability.byCompetency || {})
    .filter(([, summary]) => summary.independentOutcomes >= 4 && summary.distinctVariants >= 3)
    .map(([competencyId]) => competencyId));
  const previousDifficulty = { ...(next.difficultyBiasByCompetency || {}) };
  const currentDifficulty = Object.fromEntries(Object.entries(previousDifficulty)
    .filter(([competencyId]) => qualifiedDifficultyIds.has(competencyId)));
  if (Object.keys(currentDifficulty).length !== Object.keys(previousDifficulty).length) {
    next.difficultyBiasByCompetency = currentDifficulty;
    reasons.push("部分知识点的独立评估证据已退出观察窗口或低于门槛，自动恢复默认难度");
  }
  for (const [competencyId, summary] of Object.entries(evidence.ability.byCompetency || {})) {
    if (summary.independentOutcomes < 4 || summary.distinctVariants < 3) continue;
    const passRate = summary.weightedPassRate ?? summary.passRate ?? 0;
    const target = passRate >= 0.85 ? 1
      : passRate <= 0.45 && summary.failures >= 3 ? -1 : 0;
    const current = Number(currentDifficulty[competencyId]) || 0;
    if (target !== current) {
      difficultyTargets[competencyId] = target;
      refs.push(...summary.evidenceRefs);
      reasons.push(target > 0
        ? "知识点「" + competencyId + "」已有多次跨变体无提示独立通过，可尝试迁移挑战"
        : target < 0
          ? "知识点「" + competencyId + "」在多个变体中出现独立失败，先补齐基础"
          : "知识点「" + competencyId + "」的独立表现回到中性区间，保持当前挑战跨度");
    }
  }
  if (Object.keys(difficultyTargets).length) next.difficultyBiasByCompetency = {
    ...currentDifficulty, ...difficultyTargets,
  };

  // Difficulty is now exclusively calibrated per competency. Clear the old global
  // field so a strong/weak signal from one node cannot spill over into another node.
  if (next.difficultyBias !== 0) {
    next.difficultyBias = 0;
    reasons.push("整体难度参数已迁移为按知识点独立校准，未达门槛的节点保持默认难度");
  }
  const hintRate = evidence.process.hintDependencyRate;
  const nextIntervention = evidence.process.attempts >= 4 && hintRate >= 0.35
    ? "guided-retrieval"
    : evidence.delayedRecall.failed >= 2
      ? "spaced-retrieval"
      : evidence.ability.independentPasses >= 4 &&
          evidence.ability.independentPassRate >= 0.8 && evidence.ability.distinctVariants >= 3
        ? "transfer-challenge" : "active-recall";
  if (nextIntervention !== next.interventionPreference) {
    next.interventionPreference = nextIntervention;
    reasons.push(nextIntervention === "guided-retrieval"
      ? "提示依赖信号较明显，先采用逐步撤除提示的回忆练习"
      : nextIntervention === "spaced-retrieval"
        ? "延迟回忆出现多次失败，优先采用短间隔主动回忆"
        : nextIntervention === "transfer-challenge"
          ? "跨题型独立表现较好，加入知识迁移挑战"
          : "证据尚不足以偏向某种干预，优先采用主动回忆");
  }
  return { parameters: next, reasons, evidenceRefs: [...new Set(refs)].slice(-20), intervalTargets };
}

/** Build an evidence-based, bounded learner strategy model; behavior never substitutes for mastery. */
export function calibrateLearningStrategy({ events = [], previous = null, mode = "adaptive", now = new Date() } = {}) {
  const current = now instanceof Date ? new Date(now) : new Date(now);
  if (!Number.isFinite(current.getTime())) throw new TypeError("now must be a valid date.");
  const normalizedMode = modeOf(mode);
  const relevant = uniqueEvents(events, current);
  const evidence = classifyEvidence(relevant, current);
  const previousParameters = {
    ...emptyParameters(), ...(previous?.parameters || {}),
    reviewIntervalsByCompetency: { ...(previous?.parameters?.reviewIntervalsByCompetency || {}) },
    difficultyBiasByCompetency: { ...(previous?.parameters?.difficultyBiasByCompetency || {}) },
  };
  // The strategy engine's own audit/feedback events describe decisions, not new learning
  // observations. Excluding them from the calibration fingerprint prevents a self-triggering loop.
  const strategyInputTypes = new Set([
    "learning_plan_generated", "learning_plan_accepted", "learning_plan_rejected",
    "learning_task_in_progress", "learning_task_completed", "learning_task_failed",
    "learning_task_skipped", "learning_task_cancelled",
    "assessment_passed", "completed", "attempt", "review_started", "hint", "hint_revealed",
  ]);
  const calibrationEvents = relevant.filter(item => strategyInputTypes.has(item.type));
  const inputFingerprint = stableHash(calibrationEvents.map(item => [
    item.id, item.type, item.at, item.taskId, item.planId, item.competencyIds,
    item.sessionType, item.scorePct, item.independent, item.hintsUsed, item.variantId,
    item.strategyDecisionId, item.learningIntervention,
  ]));
  const coolingDown = validTime(previous?.lastParameterChangeAt) &&
    current.getTime() - Date.parse(previous.lastParameterChangeAt) < COOLDOWN_MS;
  const candidate = candidateParameters(evidence, previousParameters);
  let parameters = { ...previousParameters };
  let decision = null;
  if (normalizedMode === "adaptive" && !coolingDown) {
    parameters = {
      taskLoadMultiplier: moveToward(previousParameters.taskLoadMultiplier,
        candidate.parameters.taskLoadMultiplier, 0.05, 0.85, 1),
      reviewIntervalMultiplier: moveToward(previousParameters.reviewIntervalMultiplier,
        candidate.parameters.reviewIntervalMultiplier, 0.05, 0.85, 1.15),
      difficultyBias: candidate.parameters.difficultyBias,
      difficultyBiasByCompetency: { ...(candidate.parameters.difficultyBiasByCompetency || {}) },
      interventionPreference: candidate.parameters.interventionPreference,
      reviewIntervalsByCompetency: { ...(candidate.parameters.reviewIntervalsByCompetency || {}) },
    };
    for (const [competencyId, target] of Object.entries(candidate.intervalTargets || {})) {
      parameters.reviewIntervalsByCompetency[competencyId] = moveToward(
        previousParameters.reviewIntervalsByCompetency[competencyId] || 1,
        target, 0.05, 0.85, 1.15,
      );
    }
    const changed = stableHash(parameters) !== stableHash(previousParameters);
    if (changed) {
      const before = clone(previousParameters);
      const evidenceRefs = [...new Set([
        ...candidate.evidenceRefs,
        ...evidence.ability.evidenceRefs.slice(-10),
        ...evidence.delayedRecall.evidenceRefs.slice(-10),
      ])].slice(-20);
      const confidence = confidenceFor(evidence);
      const decisionId = "strategy-decision:" + stableHash({
        inputFingerprint, before, after: parameters, version: LEARNING_STRATEGY_VERSION,
      });
      decision = {
        decisionId,
        at: current.toISOString(),
        before,
        after: clone(parameters),
        reasons: candidate.reasons.slice(0, 6),
        evidenceRefs,
        sampleCounts: clone(evidence.sampleCounts),
        confidence,
        algorithmVersion: LEARNING_STRATEGY_VERSION,
        validationTarget: "通过后续无提示独立挑战、至少 2 天后的延迟复习和跨题型迁移，检查本次策略变化是否与更好的学习结果同时出现。",
      };
    }
  }
  const confidence = confidenceFor(evidence);
  const profileRevision = Number(previous?.profileRevision || 0) + (decision ? 1 : 0);
  const updatedAt = current.toISOString();
  const lastDecision = decision || previous?.lastDecision || null;
  const difficultyByCompetency = Object.fromEntries(
    Object.entries(parameters.difficultyBiasByCompetency || {}).map(([id, value]) => [
      id, value > 0 ? "stretch" : value < 0 ? "scaffold" : "maintain",
    ])
  );
  const difficultyLevels = [...new Set(Object.values(difficultyByCompetency))];
  const recommendation = {
    difficulty: difficultyLevels.length === 1 ? difficultyLevels[0]
      : difficultyLevels.length > 1 ? "maintain"
        : parameters.difficultyBias > 0 ? "stretch"
          : parameters.difficultyBias < 0 ? "scaffold" : "maintain",
    difficultyByCompetency,
    intervention: parameters.interventionPreference,
    taskLoad: parameters.taskLoadMultiplier < 1 ? "reduce" : "respect-user-budget",
    reviewIntervalMultiplier: parameters.reviewIntervalMultiplier,
    calibratedReviewCompetencies: Object.keys(parameters.reviewIntervalsByCompetency || {}).length,
  };
  const history = [
    ...(Array.isArray(previous?.history) ? previous.history : []),
    ...(decision ? [decision] : []),
  ].slice(-12);
  const profile = {
    schemaVersion: 1,
    algorithmVersion: LEARNING_STRATEGY_VERSION,
    profileRevision,
    mode: normalizedMode,
    active: normalizedMode === "adaptive" && confidence.level !== "low",
    personalizationLevel: normalizedMode === "default" ? "default"
      : confidence.level === "low" ? "cold-start"
        : confidence.level === "medium" ? "emerging" : "calibrated",
    confidence,
    parameters: normalizedMode === "default" ? emptyParameters() : parameters,
    recommendation: normalizedMode === "default"
      ? { difficulty: "maintain", difficultyByCompetency: {}, intervention: "active-recall", taskLoad: "respect-user-budget", reviewIntervalMultiplier: 1, calibratedReviewCompetencies: 0 }
      : recommendation,
    evidence,
    observedWindow: {
      days: WINDOW_DAYS,
      from: new Date(current.getTime() - WINDOW_DAYS * DAY_MS).toISOString(),
      to: current.toISOString(),
    },
    sourceFingerprint: inputFingerprint,
    latestEvidenceAt: calibrationEvents.at(-1)?.at || null,
    updatedAt,
    lastParameterChangeAt: decision?.at || previous?.lastParameterChangeAt || null,
    lastDecision,
    history,
    limitations: [
      "行为与任务完成记录只反映执行情况，不直接计入掌握证据。",
      "当前效果判断是时间顺序和结果的关联观察，不构成因果证明。",
      "样本不足、历史冲突或冷却期内不会进行激进参数调整。",
    ],
  };
  return { profile, decision, evidence, confidence, coolingDown };
}

/** Separate recommendation acceptance, task execution, ability and delayed outcomes. */
export function evaluateLearningStrategyEffectiveness(events = [], decisionId = null) {
  const rows = (Array.isArray(events) ? events : []).filter(event =>
    event && (!decisionId || event.strategyDecisionId === decisionId));
  const generated = rows.filter(event => event.type === "learning_plan_generated");
  const accepted = rows.filter(event => event.type === "learning_plan_accepted");
  const rejected = rows.filter(event => event.type === "learning_plan_rejected");
  const started = rows.filter(event => event.type === "learning_task_in_progress");
  const completed = rows.filter(event => event.type === "learning_task_completed");
  const taskFailures = rows.filter(event => event.type === "learning_task_failed");
  const taskSkipped = rows.filter(event => event.type === "learning_task_skipped");

  const outcomeSessions = new Map();
  for (const event of [...rows.filter(item => item.type === "assessment_passed" ||
      item.type === "completed" && item.independent === true),
    ...rows.filter(item => item.type === "attempt" && item.correct === false)]) {
    if (event.sessionType === "review") continue;
    const key = (event.sessionId || event.id) + (event.stepId ? "::" + event.stepId : "");
    if (!outcomeSessions.has(key)) outcomeSessions.set(key, []);
    outcomeSessions.get(key).push(event);
  }
  const independentOutcomes = [];
  for (const [sessionId, items] of outcomeSessions) {
    const passes = items.filter(item => ["assessment_passed", "completed"].includes(item.type))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (passes.length) {
      const pass = passes.at(-1);
      if (pass.independent === true && Number(pass.hintsUsed || 0) === 0) {
        independentOutcomes.push({ sessionId, passed: true, event: pass });
      }
      continue;
    }
    const failure = items.filter(item => item.type === "attempt" && item.correct === false)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
    if (failure && Number(failure.hintsUsed || 0) === 0) {
      independentOutcomes.push({ sessionId, passed: false, event: failure });
    }
  }
  const independentPasses = independentOutcomes.filter(item => item.passed);
  const independentFailures = independentOutcomes.filter(item => !item.passed);

  const delayedSessions = new Map();
  for (const event of rows.filter(item => item.sessionType === "review" &&
      ["review_started", "attempt", "assessment_passed"].includes(item.type))) {
    const key = event.sessionId || event.id;
    if (!delayedSessions.has(key)) delayedSessions.set(key, []);
    delayedSessions.get(key).push(event);
  }
  const delayedOutcomes = [...delayedSessions.values()].filter(items =>
    items.some(item => item.type === "assessment_passed" || (item.type === "attempt" && item.correct === false)));
  const delayedPasses = delayedOutcomes.filter(items => items.some(item =>
    item.type === "assessment_passed" && item.independent === true && Number(item.hintsUsed || 0) === 0));
  const delayedAssisted = delayedOutcomes.filter(items =>
    items.some(item => ["hint", "hint_revealed"].includes(item.type) || Number(item.hintsUsed || 0) > 0) ||
    items.some(item => item.type === "assessment_passed") &&
      !items.some(item => item.type === "assessment_passed" && item.independent === true && Number(item.hintsUsed || 0) === 0));
  const delayedFailures = delayedOutcomes.filter(items =>
    !delayedAssisted.includes(items) &&
    !items.some(item => item.type === "assessment_passed") &&
    items.some(item => item.type === "attempt" && item.correct === false));

  const feedback = rows.filter(event => event.type === "learning_strategy_feedback");
  const positiveFeedback = feedback.filter(event => event.rating === "helpful").length;
  const negativeFeedback = feedback.filter(event => event.rating === "not_helpful").length;

  const interventionMap = new Map();
  for (const event of rows.filter(item => item.learningIntervention)) {
    const key = event.learningIntervention;
    if (!interventionMap.has(key)) interventionMap.set(key, {
      intervention: key, tasksStarted: 0, tasksCompleted: 0,
      taskFailures: 0, independentPasses: 0, independentFailures: 0,
      delayedPasses: 0, delayedFailures: 0,
    });
    const item = interventionMap.get(key);
    if (event.type === "learning_task_in_progress") item.tasksStarted += 1;
    if (event.type === "learning_task_completed") item.tasksCompleted += 1;
    if (event.type === "learning_task_failed") item.taskFailures += 1;
    if (["assessment_passed", "completed"].includes(event.type) &&
        event.independent === true && Number(event.hintsUsed || 0) === 0) {
      if (event.sessionType === "review") item.delayedPasses += 1;
      else item.independentPasses += 1;
    }
    if (event.type === "attempt" && event.correct === false && Number(event.hintsUsed || 0) === 0) {
      if (event.sessionType === "review") item.delayedFailures += 1;
      else item.independentFailures += 1;
    }
  }
  const abilitySample = independentOutcomes.length;
  const delayedSample = delayedOutcomes.length;
  const delayedIndependentSample = delayedPasses.length + delayedFailures.length;
  const delayedSuccessRate = delayedIndependentSample
    ? delayedPasses.length / delayedIndependentSample : null;
  const status = abilitySample < 3 ? "observing"
    : delayedIndependentSample >= 3 && delayedSuccessRate >= 0.7 ? "promising-association"
      : delayedIndependentSample >= 3 && delayedSuccessRate <= 0.5 ? "needs-adjustment"
        : "insufficient-long-term-evidence";
  return {
    recommendation: { generated: generated.length, accepted: accepted.length, rejected: rejected.length },
    execution: {
      started: started.length, completed: completed.length,
      failed: taskFailures.length, skipped: taskSkipped.length,
    },
    learning: {
      independentChecks: abilitySample,
      independentPasses: independentPasses.length,
      independentFailures: independentFailures.length,
    },
    longTerm: {
      delayedIndependentPasses: delayedPasses.length,
      delayedIndependentFailures: delayedFailures.length,
      delayedAssistedPasses: delayedAssisted.length,
      independentObservations: delayedIndependentSample,
      observations: delayedSample,
    },
    interventions: [...interventionMap.values()],
    feedback: { helpful: positiveFeedback, notHelpful: negativeFeedback },
    status,
    interpretation: status === "promising-association"
      ? "当前观察到独立延迟复习表现较好；这只是关联信号，尚不能证明策略产生了因果效果。"
      : status === "needs-adjustment"
        ? "延迟复习样本提示独立回忆仍有失败，需要结合题型、提示和知识范围继续诊断。"
        : "当前独立或延迟验证样本不足，暂不对策略效果下结论。",
  };
}

export function createLearningStrategyEngine(options = {}) {
  const repositoryPromise = options.repository ? Promise.resolve(options.repository) : getLearningRepository();
  const profileStore = options.profileStore || null;

  async function refresh({ events: suppliedEvents, mode, now = new Date(), casRetry = 0 } = {}) {
    const current = now instanceof Date ? new Date(now) : new Date(now);
    const repository = await repositoryPromise;
    const [events, row, preferences] = await Promise.all([
      suppliedEvents ? Promise.resolve(suppliedEvents) : repository.events.list(),
      repository.documents.get(LEARNING_STRATEGY_DOCUMENT_TYPE, LEARNING_STRATEGY_DOCUMENT_KEY),
      mode ? Promise.resolve(null) : profileStore?.loadPreferences?.() || Promise.resolve(null),
    ]);
    const selectedMode = modeOf(mode || preferences?.personalizationMode || "adaptive");
    const previous = row?.payload && row.payload.schemaVersion === 1 ? row.payload : null;
    const result = calibrateLearningStrategy({ events, previous, mode: selectedMode, now: current });
    const { profile, decision } = result;
    const effectiveness = evaluateLearningStrategyEffectiveness(events, decision?.decisionId || profile.lastDecision?.decisionId || null);
    profile.effectiveness = effectiveness;
    if (previous?.sourceFingerprint === profile.sourceFingerprint &&
        previous?.mode === profile.mode &&
        previous?.profileRevision === profile.profileRevision) {
      return { ...profile, localRevision: row.localRevision, effectiveness, cacheHit: true };
    }
    const change = {
      documents: [{
        type: LEARNING_STRATEGY_DOCUMENT_TYPE,
        key: LEARNING_STRATEGY_DOCUMENT_KEY,
        payload: profile,
        expectedLocalRevision: Number(row?.localRevision) || 0,
      }],
      events: decision ? [{
        id: "learning-strategy-calibrated:" + decision.decisionId,
        type: "learning_strategy_calibrated",
        at: decision.at,
        topicId: "unclassified",
        challengeId: "learning-strategy-engine",
        challengeTitle: "学习策略自校准",
        stepId: decision.decisionId,
        stepTitle: "个体学习策略发生调整",
        competencyIds: [],
        sessionId: decision.decisionId,
        sessionType: "strategy",
        strategyDecisionId: decision.decisionId,
        strategyBefore: decision.before,
        strategyAfter: decision.after,
        strategyReasons: decision.reasons,
        evidenceRefs: decision.evidenceRefs,
        sampleCounts: decision.sampleCounts,
        confidence: decision.confidence,
        algorithmVersion: decision.algorithmVersion,
        validationTarget: decision.validationTarget,
      }] : [],
    };
    try {
      await repository.commit(change);
    } catch (error) {
      const latest = await repository.documents.get(LEARNING_STRATEGY_DOCUMENT_TYPE, LEARNING_STRATEGY_DOCUMENT_KEY);
      if (latest?.payload?.sourceFingerprint === profile.sourceFingerprint &&
          latest?.payload?.profileRevision === profile.profileRevision) {
        return { ...latest.payload, localRevision: latest.localRevision, cacheHit: true };
      }
      const isRevisionConflict = /文档版本冲突|revision conflict|compare-and-swap|CAS/i.test(error?.message || "");
      if (isRevisionConflict && casRetry < 2) {
        const latestEvents = await repository.events.list();
        const mergedEvents = suppliedEvents
          ? [...new Map([...suppliedEvents, ...latestEvents].map(item => [item.id, item])).values()]
          : undefined;
        return refresh({ events: mergedEvents, mode, now: current, casRetry: casRetry + 1 });
      }
      throw error;
    }
    const stored = await repository.documents.get(LEARNING_STRATEGY_DOCUMENT_TYPE, LEARNING_STRATEGY_DOCUMENT_KEY);
    return { ...profile, localRevision: stored?.localRevision || 1, cacheHit: false };
  }

  async function feedback({ decisionId, rating, reason = "", now = new Date() } = {}) {
    if (!decisionId || !["helpful", "not_helpful"].includes(rating)) {
      throw new TypeError("decisionId and a valid feedback rating are required.");
    }
    const repository = await repositoryPromise;
    const at = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    const event = {
      id: "learning-strategy-feedback:" + stableHash([decisionId, rating, at]),
      type: "learning_strategy_feedback",
      at,
      topicId: "unclassified",
      challengeId: "learning-strategy-engine",
      challengeTitle: "学习策略反馈",
      stepId: decisionId,
      stepTitle: rating === "helpful" ? "策略建议有帮助" : "策略建议不合适",
      competencyIds: [],
      sessionId: decisionId,
      sessionType: "strategy",
      strategyDecisionId: decisionId,
      rating,
      reason: String(reason).slice(0, 500),
    };
    await repository.commit({ events: [event] });
    return event;
  }

  return Object.freeze({ refresh, feedback });
}
