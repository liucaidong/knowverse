import {
  getLearningRepository,
  isLearningRepositoryAvailable,
} from "./backend/learning-repository.mjs";
import {
  createLearningProgressStore,
  getGapReviewPredecessorEventIds,
  getOpenGapObservationEventIds,
} from "./learning-progress.mjs";

const clone = value => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();
const makeId = () => "review-" + Date.now().toString(36) + "-" +
  (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));

function validateRegistry(registry) {
  if (!registry || !Array.isArray(registry.assessments) || !registry.assessments.length) {
    throw new TypeError("Review assessment registry is empty.");
  }
  const ids = new Set();
  for (const item of registry.assessments) {
    if (!item.id || ids.has(item.id) || !item.competencyId || !Array.isArray(item.options) ||
        !item.options.some(option => option.id === item.answer) ||
        ((item.difficulty !== undefined || item.sourceHref !== undefined) &&
          (!new Set(["foundation", "intermediate", "stretch"]).has(item.difficulty) ||
            typeof item.sourceHref !== "string" || !item.sourceHref.startsWith("./knowledge/") ||
            typeof item.sourceLabel !== "string" || !item.sourceLabel.trim()))) {
      throw new TypeError("Invalid or duplicate review assessment: " + (item.id || "unknown"));
    }
    ids.add(item.id);
  }
  return registry.assessments;
}

export function createReviewSessionEngine(options = {}) {
  const repositoryPromise = options.repository
    ? Promise.resolve(options.repository)
    : getLearningRepository();
  const progressStore = options.progressStore || createLearningProgressStore({ repository: options.repository });
  const assessments = validateRegistry(options.registry || { assessments: options.assessments || [] });
  const definitions = new Map(assessments.map(item => [item.id, item]));

  async function history() {
    const snapshot = await progressStore.load();
    const events = snapshot.events.filter(event =>
      event.sessionType === "review" && typeof event.sessionId === "string"
    );
    const sessions = new Map();
    for (const event of events) {
      let row = sessions.get(event.sessionId);
      if (!row) {
        row = {
          sessionId: event.sessionId,
          competencyId: event.competencyIds?.[0] || null,
          targetGapId: event.type === "review_started" ? event.gapId || null : null,
          variantId: event.variantId || null,
          status: "active",
          startedAt: event.at,
          finishedAt: null,
          attempts: 0,
          hintsUsed: 0,
        };
        sessions.set(event.sessionId, row);
      }
      if (event.type === "review_started") {
        row.startedAt = event.at;
        row.targetGapId = event.gapId || null;
      }
      if (event.type === "attempt") {
        row.attempts += 1;
        if (event.correct === false) {
          row.status = "failed";
          row.finishedAt = event.at;
        }
      }
      if (event.type === "hint_revealed" || event.type === "hint") {
        row.hintsUsed = Math.max(row.hintsUsed, Number(event.hintsUsed || event.hintNumber || 0));
      }
      if (event.type === "assessment_passed") {
        row.status = "passed";
        row.finishedAt = event.at;
      }
    }
    return [...sessions.values()];
  }

  function makeEvent(session, type, suffix, fields = {}) {
    const definition = definitions.get(session.variantId);
    if (!definition) throw new Error("复习题注册表已变化，无法创建本次学习证据。");
    return {
      id: session.sessionId + ":" + suffix,
      eventSchemaVersion: 3,
      type,
      at: nowIso(),
      topicId: definition.topicId,
      challengeId: "review-assessment",
      challengeTitle: "针对性复习 · " + definition.title,
      stepId: definition.id,
      stepTitle: definition.title,
      competencyIds: [session.competencyId],
      sessionId: session.sessionId,
      sessionType: "review",
      variantId: definition.id,
      taskId: session.taskId || null,
      planId: session.planId || null,
      strategyDecisionId: session.strategyDecisionId || null,
      strategyProfileRevision: session.strategyProfileRevision || null,
      learningIntervention: session.learningIntervention || null,
      strategyInstruction: session.strategyInstruction || null,
      difficultyLevel: session.difficultyLevel || "maintain",
      gapId: session.targetGapId || fields.gapId || null,
      gapObservationId: null,
      causationEventIds: [],
      targetGapEventIds: session.targetGapEventIds || [],
      ...fields,
    };
  }

  async function getRecord(sessionId) {
    const repository = await repositoryPromise;
    const stored = await repository.documents.get("review_session", String(sessionId));
    const session = stored?.payload;
    if (!session || session._deleted === true || session.schemaVersion !== 1 ||
        !definitions.has(session.variantId)) return null;
    return { session: clone(session), localRevision: Number(stored.localRevision) || 0 };
  }

  async function get(sessionId) {
    return (await getRecord(sessionId))?.session || null;
  }

  async function start(input = {}) {
    const competencyId = String(input.competencyId || "");
    const targetGapId = input.gapId ? String(input.gapId) : null;
    const candidates = assessments.filter(item =>
      item.competencyId === competencyId && (!targetGapId || (item.gapIds || []).includes(targetGapId))
    );
    if (!candidates.length) throw new Error("没有找到与该知识点 / 薄弱点匹配的复习题。");

    const snapshot = await progressStore.load();
    const targetGapEventIds = targetGapId
      ? getOpenGapObservationEventIds(snapshot, competencyId, targetGapId)
      : [];
    const predecessorEventIds = targetGapId
      ? getGapReviewPredecessorEventIds(snapshot, competencyId, targetGapId, targetGapEventIds)
      : [];
    if (targetGapId && !targetGapEventIds.length) {
      throw new Error("没有找到仍待验证的错误事件。请重新执行关联挑战，或刷新学习进度后再开始针对性复习。");
    }

    const used = (await history()).filter(item =>
      item.competencyId === competencyId && item.targetGapId === targetGapId
    );
    const usedIds = new Set(used.map(item => item.variantId));
    const explicit = input.variantId ? candidates.find(item => item.id === input.variantId) : null;
    const candidate = explicit || candidates.filter(item => !usedIds.has(item.id))[0] ||
      candidates.slice().sort((a, b) =>
        (used.find(item => item.variantId === a.id)?.startedAt || "") <
        (used.find(item => item.variantId === b.id)?.startedAt || "") ? -1 : 1
      )[0];

    const session = {
      schemaVersion: 1,
      sessionId: makeId(),
      sessionType: "review",
      competencyId,
      targetGapId,
      targetGapEventIds,
      hintEventIds: [],
      variantId: candidate.id,
      topicId: candidate.topicId,
      title: candidate.title,
      prompt: candidate.prompt,
      difficulty: candidate.difficulty || null,
      lessonId: candidate.lessonId || null,
      sourceHref: candidate.sourceHref || null,
      sourceLabel: candidate.sourceLabel || null,
      code: candidate.code || "",
      options: clone(candidate.options),
      hints: clone(candidate.hints || []),
      explanation: candidate.explanation || "",
      answer: candidate.answer,
      status: "active",
      attempts: 0,
      hintsUsed: 0,
      selectedOptionId: null,
      startedAt: nowIso(),
      finishedAt: null,
      taskId: input.taskId || null,
      planId: input.planId || null,
      strategyDecisionId: input.strategyDecisionId || null,
      strategyProfileRevision: input.strategyProfileRevision || null,
      learningIntervention: input.learningIntervention || null,
      strategyInstruction: input.strategyInstruction || null,
      difficultyLevel: input.difficultyLevel || "maintain",
    };
    const started = makeEvent(session, "review_started", "started", {
      reviewMode: targetGapId ? "targeted-gap" : "competency",
      causationEventIds: predecessorEventIds,
      targetGapEventIds,
    });
    const repository = await repositoryPromise;
    await repository.commit({
      events: [started],
      documents: [{
        type: "review_session",
        key: session.sessionId,
        payload: session,
        expectedLocalRevision: 0,
      }],
    });
    return clone(session);
  }

  async function revealHint(sessionId) {
    const stored = await getRecord(sessionId);
    const session = stored?.session;
    if (!session || session.status !== "active") throw new Error("当前复习会话已结束。");
    const definition = definitions.get(session.variantId);
    if (session.hintsUsed >= (definition.hints || []).length) {
      return { session, hint: null, exhausted: true };
    }
    const priorHintEventIds = (session.hintEventIds || []).slice();
    session.hintsUsed += 1;
    const hint = definition.hints[session.hintsUsed - 1];
    session.hintEventIds = [...priorHintEventIds, sessionId + ":hint:" + session.hintsUsed];
    const event = makeEvent(session, "hint_revealed", "hint:" + session.hintsUsed, {
      hintNumber: session.hintsUsed,
      hintsUsed: session.hintsUsed,
      causationEventIds: [sessionId + ":started", ...priorHintEventIds].slice(-20),
    });
    const repository = await repositoryPromise;
    await repository.commit({
      events: [event],
      documents: [{
        type: "review_session",
        key: session.sessionId,
        payload: session,
        expectedLocalRevision: stored.localRevision,
      }],
    });
    return { session: clone(session), hint, exhausted: false };
  }

  async function submit(sessionId, optionId) {
    const stored = await getRecord(sessionId);
    const session = stored?.session;
    if (!session || session.status !== "active") throw new Error("当前复习会话已结束或不存在。");
    const definition = definitions.get(session.variantId);
    const selected = definition.options.find(option => option.id === optionId);
    if (!selected) throw new Error("所选答案不属于当前题目。");
    session.attempts += 1;
    session.selectedOptionId = optionId;
    const correct = optionId === definition.answer;
    const scorePct = correct ? Math.max(55, 100 - Math.max(0, session.attempts - 1) * 15 - session.hintsUsed * 20) : 0;
    const gapId = session.targetGapId || (!correct ? (selected.gapId || definition.gapIds?.[0] || null) : null);
    const fields = {
      correct, selectedOptionId: optionId, gapId,
      attempts: session.attempts, hintsUsed: session.hintsUsed,
    };
    const attemptEventId = sessionId + ":attempt:" + session.attempts;
    const events = [makeEvent(session, "attempt", "attempt:" + session.attempts, {
      ...fields,
      gapObservationId: !correct && gapId ? attemptEventId : null,
      causationEventIds: [sessionId + ":started", ...(session.hintEventIds || [])].slice(-20),
    })];
    session.status = correct ? "passed" : "failed";
    session.finishedAt = nowIso();
    if (correct) {
      events.push(makeEvent(session, "assessment_passed", "passed", {
        gapId,
        scorePct,
        earnedPoints: scorePct,
        maximumPoints: 100,
        attempts: session.attempts,
        hintsUsed: session.hintsUsed,
        independent: session.hintsUsed === 0,
        causationEventIds: [sessionId + ":started", attemptEventId, ...(session.hintEventIds || [])].slice(-20),
      }));
    }
    const repository = await repositoryPromise;
    await repository.commit({
      events,
      documents: [{
        type: "review_session",
        key: session.sessionId,
        payload: { _deleted: true, deletedAt: nowIso() },
        expectedLocalRevision: stored.localRevision,
      }],
    });
    return {
      session: clone(session),
      correct,
      scorePct,
      explanation: definition.explanation,
      selectedOption: clone(selected),
      answer: definition.answer,
      lifecycle: correct && session.hintsUsed ? "pending-verification" : correct ? "passed" : "needs-review",
    };
  }

  return {
    available: isLearningRepositoryAvailable(),
    start,
    get,
    revealHint,
    submit,
    getHistory: history,
    async getActiveSessions() {
      const repository = await repositoryPromise;
      const rows = await repository.documents.list();
      const active = rows
        .filter(row => row.type === "review_session" && row.payload?.status === "active" && row.payload?._deleted !== true)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return active.map(row => clone(row.payload)).filter(row => definitions.has(row.variantId));
    },
    async getAssessment(sessionId) {
      const session = await get(sessionId);
      return session ? clone(definitions.get(session.variantId)) : null;
    },
  };
}
