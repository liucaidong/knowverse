import { createLearningProgressStore } from "./learning-progress.mjs";

const makeId = () => "checkpoint-" + Date.now().toString(36) + "-" +
  (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));

function validateRegistry(registry) {
  const checkpoints = Array.isArray(registry) ? registry : registry?.checkpoints;
  if (!Array.isArray(checkpoints)) throw new TypeError("Learning checkpoint registry must contain a checkpoints array.");
  const ids = new Set();
  for (const item of checkpoints) {
    if (!item || typeof item.id !== "string" || ids.has(item.id) ||
        !item.workId || !item.topicId || !item.competencyId ||
        !Array.isArray(item.options) || item.options.length < 2 ||
        !item.options.some(option => option.id === item.answer)) {
      throw new TypeError("Invalid or duplicate learning checkpoint: " + (item?.id || "unknown"));
    }
    const optionIds = item.options.map(option => option.id);
    if (new Set(optionIds).size !== optionIds.length) throw new TypeError("Duplicate option id in checkpoint: " + item.id);
    ids.add(item.id);
  }
  return checkpoints;
}

/** One-attempt, no-hint assessment. A checkpoint can create a gap but cannot resolve one. */
export function createLearningCheckpointEngine(options = {}) {
  const store = options.store || createLearningProgressStore({ storage: options.storage });
  const checkpoints = validateRegistry(options.registry || []);
  const definitions = new Map(checkpoints.map(item => [item.id, item]));
  const sessions = new Map();

  function append(events) {
    if (!store.available || !store.appendMany(events)) {
      throw new Error("学习检查点无法保存。请检查浏览器本地存储空间，并先导出学习档案备份。");
    }
  }

  function start(checkpointId) {
    const definition = definitions.get(String(checkpointId));
    if (!definition) throw new RangeError("Unknown learning checkpoint: " + checkpointId);
    const sessionId = makeId();
    const startedAt = new Date().toISOString();
    const session = {
      sessionId, checkpointId: definition.id, workId: definition.workId,
      competencyId: definition.competencyId, variantId: definition.id,
      status: "active", startedAt
    };
    append([{
      id: sessionId + ":started", eventSchemaVersion: 2, type: "checkpoint_started",
      at: startedAt, topicId: definition.topicId,
      challengeId: "checkpoint:" + definition.workId,
      challengeTitle: definition.title || definition.workId,
      stepId: definition.id, stepTitle: definition.title || definition.id,
      competencyIds: [definition.competencyId], sessionId,
      sessionType: "checkpoint", variantId: definition.id,
      hintsUsed: 0, workId: definition.workId
    }]);
    sessions.set(sessionId, session);
    return { ...session, definition: JSON.parse(JSON.stringify(definition)) };
  }

  function submit(sessionId, optionId) {
    const session = sessions.get(String(sessionId));
    if (!session || session.status !== "active") throw new Error("检查点会话已结束或不存在。");
    const definition = definitions.get(session.checkpointId);
    const selected = definition.options.find(option => option.id === optionId);
    if (!selected) throw new RangeError("所选答案不属于当前检查点。");
    const correct = optionId === definition.answer;
    const at = new Date().toISOString();
    const base = {
      eventSchemaVersion: 2, at, topicId: definition.topicId,
      challengeId: "checkpoint:" + definition.workId,
      challengeTitle: definition.title || definition.workId,
      stepId: definition.id, stepTitle: definition.title || definition.id,
      competencyIds: [definition.competencyId], sessionId,
      sessionType: "checkpoint", variantId: definition.id, workId: definition.workId,
      attempts: 1, attemptNumber: 1, hintsUsed: 0,
      selectedOptionId: optionId, correct
    };
    const events = [{
      ...base, id: sessionId + ":attempt", type: "attempt",
      gapId: correct ? null : (selected.gapId || null)
    }];
    if (correct) events.push({
      ...base, id: sessionId + ":passed", type: "assessment_passed",
      gapId: null, scorePct: 100, earnedPoints: 100, maximumPoints: 100, independent: true
    });
    append(events);
    session.status = correct ? "passed" : "needs-review";
    session.finishedAt = at;
    return {
      session: { ...session }, correct, gapId: correct ? null : (selected.gapId || null),
      selectedOption: JSON.parse(JSON.stringify(selected)),
      explanation: definition.explanation || "", scorePct: correct ? 100 : 0
    };
  }

  return {
    available: Boolean(store.available), start, submit,
    get(sessionId) {
      const session = sessions.get(String(sessionId));
      return session ? { ...session } : null;
    }
  };
}
