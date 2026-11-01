import { createChallengeLearningEvents, createLearningProgressStore } from "./learning-progress.mjs";

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

export function createChallengeProgress(challenge, saved = null) {
  validateChallenge(challenge);
  const savedIsCompatible = saved &&
    saved.engineVersion === ENGINE_VERSION &&
    saved.challengeId === challenge.id &&
    Array.isArray(saved.steps);
  const savedById = new Map(savedIsCompatible ? saved.steps.map(step => [step.id, step]) : []);
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
    runId: savedIsCompatible && typeof saved.runId === "string" ? saved.runId : createRunId(),
    status: isComplete ? "completed" : steps.some(step => step.status === "completed" || step.attempts || step.hintsUsed) ? "in-progress" : "not-started",
    createdAt: savedIsCompatible && typeof saved.createdAt === "string" ? saved.createdAt : timestamp(),
    updatedAt: savedIsCompatible && typeof saved.updatedAt === "string" ? saved.updatedAt : timestamp(),
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
  const prefix = options.prefix || "knowverse:challenge:v1:";
  let storage = options.storage;
  if (typeof storage === "undefined") {
    try {
      storage = globalThis.localStorage || null;
    } catch {
      storage = null;
    }
  }
  const usable = storage &&
    typeof storage.getItem === "function" &&
    typeof storage.setItem === "function" &&
    typeof storage.removeItem === "function";
  const learningStore = createLearningProgressStore({ storage });
  const definitions = new Map();

  return {
    load(challenge) {
      definitions.set(challenge.id, challenge);
      let saved = null;
      if (usable) {
        try {
          const raw = storage.getItem(prefix + encodeURIComponent(challenge.id));
          saved = raw ? JSON.parse(raw) : null;
        } catch {
          saved = null;
        }
      }
      return createChallengeProgress(challenge, saved);
    },

    save(progress) {
      if (!usable) return false;
      try {
        const key = prefix + encodeURIComponent(progress.challengeId);
        const raw = storage.getItem(key);
        const previous = raw ? JSON.parse(raw) : null;
        const challenge = definitions.get(progress.challengeId);
        if (challenge) {
          const events = createChallengeLearningEvents(challenge, previous, progress);
          if (events.length && !learningStore.appendMany(events)) return false;
        }
        storage.setItem(key, JSON.stringify(progress));
        return true;
      } catch {
        return false;
      }
    },

    clear(challengeId) {
      if (!usable) return false;
      try {
        storage.removeItem(prefix + encodeURIComponent(challengeId));
        return true;
      } catch {
        return false;
      }
    },

    available: Boolean(usable),
  };
}
