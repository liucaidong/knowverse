import { createChallengeLearningEvents } from "./learning-progress.mjs";
import {
  getLearningRepository,
  isLearningRepositoryAvailable,
} from "./backend/learning-repository.mjs";

const ENGINE_VERSION = 1;

const timestamp = () => new Date().toISOString();
const createRunId = () => "run-" + Date.now().toString(36) + "-" + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
const clone = value => JSON.parse(JSON.stringify(value));
const asCount = value => Number.isSafeInteger(value) && value > 0 ? value : 0;

function validateChallenge(challenge) {
  if (!challenge || typeof challenge.id !== "string" || !challenge.id.trim()) {
    throw new TypeError("A challenge needs a non-empty id.");
  }
  if (!Array.isArray(challenge.steps) || challenge.steps.length === 0) {
    throw new TypeError("A challenge needs at least one step.");
  }
  const ids = new Set();
  for (const step of challenge.steps) {
    if (!step || typeof step.id !== "string" || !step.id.trim() || ids.has(step.id)) {
      throw new TypeError("Challenge step ids must be unique, non-empty strings.");
    }
    ids.add(step.id);
    if (step.hints !== undefined && (!Array.isArray(step.hints) || step.hints.some(hint => typeof hint !== "string"))) {
      throw new TypeError("Step hints must be an array of strings.");
    }
  }
}

function findStep(challenge, stepId) {
  const step = challenge.steps.find(item => item.id === stepId);
  if (!step) throw new RangeError("Unknown challenge step: " + stepId);
  return step;
}

function findProgressStep(progress, stepId) {
  const step = progress.steps.find(item => item.id === stepId);
  if (!step) throw new RangeError("Unknown progress step: " + stepId);
  return step;
}

function requireActive(progress, stepId) {
  const step = findProgressStep(progress, stepId);
  if (step.status !== "active") {
    throw new Error("Step is not active: " + stepId);
  }
  return step;
}

function migrateLegacyChallengeProgress(challenge, saved) {
  if (!saved || saved.schemaVersion !== 1 || saved.challengeId !== challenge.id ||
      !Array.isArray(saved.done) || saved.done.length !== challenge.steps.length ||
      !saved.done.every(value => typeof value === "boolean") ||
      !Number.isSafeInteger(saved.stage) || saved.stage < 0 || saved.stage >= challenge.steps.length ||
      !Array.isArray(saved.solutions) || saved.solutions.length !== challenge.steps.length ||
      !saved.solutions.every(list => Array.isArray(list) &&
        list.every(value => typeof value === "string" && value.length <= 120))) return null;

  let previousCompleted = true;
  const steps = challenge.steps.map((definition, index) => {
    const canBeActive = previousCompleted;
    const completed = canBeActive && saved.done[index] === true;
    previousCompleted = completed;
    const legacySolutions = saved.solutions[index].slice();
    return {
      id: definition.id,
      status: completed ? "completed" : canBeActive ? "active" : "locked",
      attempts: 0,
      hintsUsed: 0,
      data: legacySolutions.length ? { legacySolutions } : {},
      completedAt: null,
    };
  });
  const completed = steps.every(step => step.status === "completed");
  return {
    engineVersion: ENGINE_VERSION,
    challengeId: challenge.id,
    runId: createRunId(),
    status: completed ? "completed" :
      steps.some(step => step.status === "completed" || Object.keys(step.data).length) ? "in-progress" : "not-started",
    createdAt: timestamp(),
    updatedAt: timestamp(),
    steps,
  };
}

export function createChallengeProgress(challenge, saved = null) {
  validateChallenge(challenge);
  const savedIsCompatible = saved &&
    saved.engineVersion === ENGINE_VERSION &&
    saved.challengeId === challenge.id &&
    Array.isArray(saved.steps);
  const migratedLegacy = savedIsCompatible ? null : migrateLegacyChallengeProgress(challenge, saved);
  const compatibleSaved = savedIsCompatible ? saved : migratedLegacy;
  const savedById = new Map(compatibleSaved ? compatibleSaved.steps.map(step => [step.id, step]) : []);
  let previousCompleted = true;

  const steps = challenge.steps.map((definition, index) => {
    const old = savedById.get(definition.id) || {};
    const completed = previousCompleted && old.status === "completed";
    const status = completed ? "completed" : previousCompleted ? "active" : "locked";
    previousCompleted = completed;
    return {
      id: definition.id,
      status,
      attempts: asCount(old.attempts),
      hintsUsed: Math.min(asCount(old.hintsUsed), definition.hints?.length || 0),
      data: old.data && typeof old.data === "object" && !Array.isArray(old.data) ? clone(old.data) : {},
      completedAt: completed && typeof old.completedAt === "string" ? old.completedAt : null,
    };
  });

  const isComplete = steps.every(step => step.status === "completed");
  return {
    engineVersion: ENGINE_VERSION,
    challengeId: challenge.id,
    runId: compatibleSaved && typeof compatibleSaved.runId === "string" ? compatibleSaved.runId : createRunId(),
    status: isComplete ? "completed" : steps.some(step =>
      step.status === "completed" || step.attempts || step.hintsUsed || Object.keys(step.data).length
    ) ? "in-progress" : "not-started",
    createdAt: compatibleSaved && typeof compatibleSaved.createdAt === "string" ? compatibleSaved.createdAt : timestamp(),
    updatedAt: compatibleSaved && typeof compatibleSaved.updatedAt === "string" ? compatibleSaved.updatedAt : timestamp(),
    steps,
  };
}

export function getStepProgress(progress, stepId) {
  return clone(findProgressStep(progress, stepId));
}

export function recordAttempt(progress, stepId) {
  requireActive(progress, stepId);
  const next = clone(progress);
  const step = findProgressStep(next, stepId);
  step.attempts += 1;
  next.status = "in-progress";
  next.updatedAt = timestamp();
  return next;
}

export function revealNextHint(progress, challenge, stepId) {
  const definition = findStep(challenge, stepId);
  const current = requireActive(progress, stepId);
  const hints = definition.hints || [];
  const index = current.hintsUsed;
  if (index >= hints.length) {
    return { progress, hint: null, index: -1, exhausted: true };
  }

  const next = clone(progress);
  findProgressStep(next, stepId).hintsUsed += 1;
  next.status = "in-progress";
  next.updatedAt = timestamp();
  return { progress: next, hint: hints[index], index, exhausted: false };
}

export function setStepData(progress, stepId, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError("Step data patch must be an object.");
  }
  requireActive(progress, stepId);
  const next = clone(progress);
  const step = findProgressStep(next, stepId);
  step.data = { ...step.data, ...clone(patch) };
  next.updatedAt = timestamp();
  return next;
}

export function completeStep(progress, challenge, stepId) {
  validateChallenge(challenge);
  requireActive(progress, stepId);
  const next = clone(progress);
  const index = challenge.steps.findIndex(step => step.id === stepId);
  const current = findProgressStep(next, stepId);
  current.status = "completed";
  current.completedAt = timestamp();

  const following = next.steps[index + 1];
  if (following) following.status = "active";
  next.status = next.steps.every(step => step.status === "completed") ? "completed" : "in-progress";
  next.updatedAt = timestamp();
  return next;
}

export function resetChallengeProgress(challenge) {
  return createChallengeProgress(challenge);
}

export function summarizeChallenge(challenge, progress) {
  validateChallenge(challenge);
  if (progress.challengeId !== challenge.id) {
    throw new Error("Progress belongs to a different challenge.");
  }
  const scoring = challenge.scoring || {};
  const attemptPenalty = Number.isFinite(scoring.attemptPenalty) ? Math.max(0, scoring.attemptPenalty) : 0;
  const hintPenalty = Number.isFinite(scoring.hintPenalty) ? Math.max(0, scoring.hintPenalty) : 0;
  let maxPoints = 0;
  let earnedPoints = 0;

  for (const definition of challenge.steps) {
    const step = findProgressStep(progress, definition.id);
    const points = Number.isFinite(definition.points) ? Math.max(0, definition.points) : 100;
    maxPoints += points;
    if (step.status === "completed") {
      earnedPoints += Math.max(
        0,
        points - Math.max(0, step.attempts - 1) * attemptPenalty - step.hintsUsed * hintPenalty
      );
    }
  }

  const attempts = progress.steps.reduce((total, step) => total + step.attempts, 0);
  const hintsUsed = progress.steps.reduce((total, step) => total + step.hintsUsed, 0);
  const completedSteps = progress.steps.filter(step => step.status === "completed").length;
  return {
    status: progress.status,
    completedSteps,
    totalSteps: challenge.steps.length,
    attempts,
    hintsUsed,
    earnedPoints,
    maxPoints,
    completionRate: completedSteps / challenge.steps.length,
  };
}

export function createChallengeProgressStore(options = {}) {
  const repositoryPromise = options.repository
    ? Promise.resolve(options.repository)
    : getLearningRepository();
  const definitions = new Map();

  return {
    available: isLearningRepositoryAvailable(),
    async load(challenge) {
      if (!challenge?.id) throw new TypeError("Challenge definition is required.");
      definitions.set(challenge.id, challenge);
      const repository = await repositoryPromise;
      const stored = await repository.documents.get("challenge_progress", challenge.id);
      const saved = stored?.payload?._deleted === true ? null : stored?.payload || null;
      const migratedLegacy = migrateLegacyChallengeProgress(challenge, saved);
      if (migratedLegacy) {
        // Persist the structural migration without synthesizing historical
        // learning events. Legacy completion flags are progress, not verified
        // assessment evidence.
        await repository.commit({
          documents: [{
            type: "challenge_progress",
            key: challenge.id,
            payload: migratedLegacy,
            expectedLocalRevision: Number(stored?.localRevision) || 0,
          }],
        });
        return migratedLegacy;
      }
      return createChallengeProgress(challenge, saved);
    },

    async save(progress) {
      if (!progress?.challengeId) throw new TypeError("Challenge progress is invalid.");
      const challenge = definitions.get(progress.challengeId);
      if (!challenge) throw new Error("挑战定义未注册，无法将进度保存到学习仓储。");
      const repository = await repositoryPromise;
      const previous = await repository.documents.get("challenge_progress", progress.challengeId);
      const previousPayload = previous?.payload?._deleted === true ? null : previous?.payload || null;
      const events = createChallengeLearningEvents(challenge, previousPayload, progress, {
        strategyContext: options.strategyContext || null,
      });
      await repository.commit({
        events,
        documents: [{
          type: "challenge_progress",
          key: progress.challengeId,
          payload: progress,
          expectedLocalRevision: Number(previous?.localRevision) || 0,
        }],
      });
      return true;
    },

    async clear(challengeId) {
      if (typeof challengeId !== "string" || !challengeId) throw new TypeError("Challenge ID is required.");
      const repository = await repositoryPromise;
      await repository.documents.remove("challenge_progress", challengeId);
      return true;
    },
  };
}
