import { createLearningProgressStore } from "./learning-progress.mjs";

const SESSION_PREFIX = "knowverse:review-session:v1:";
const clone = value => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();
const makeId = () => "review-" + Date.now().toString(36) + "-" +
  (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));

function getStorage(candidate) {
  if (candidate) return candidate;
  try { return globalThis.localStorage || null; } catch { return null; }
}
function readJSON(storage, key, fallback) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : clone(fallback);
  } catch { return clone(fallback); }
}
function writeJSON(storage, key, value) {
  if (!storage || typeof storage.setItem !== "function") return false;
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
function validateRegistry(registry) {
  if (!registry || !Array.isArray(registry.assessments) || !registry.assessments.length) {
    throw new TypeError("Review assessment registry is empty.");
  }
  const ids = new Set();
  for (const item of registry.assessments) {
    if (!item.id || ids.has(item.id) || !item.competencyId || !Array.isArray(item.options) ||
        !item.options.some(option => option.id === item.answer)) {
      throw new TypeError("Invalid or duplicate review assessment: " + (item.id || "unknown"));
    }
    ids.add(item.id);
  }
  return registry.assessments;
}

export function createReviewSessionEngine(options = {}) {
  const storage = getStorage(options.storage);
  const progressStore = options.progressStore || createLearningProgressStore({ storage });
  const assessments = validateRegistry(options.registry || { assessments: options.assessments || [] });
  const definitions = new Map(assessments.map(item => [item.id, item]));

  function history() {
    const events = progressStore.load().events.filter(event =>
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
  function persistSession(session) {
    const key = SESSION_PREFIX + session.sessionId;
    if (session.status !== "active") {
      try { storage?.removeItem?.(key); } catch { /* The append-only event log remains authoritative. */ }
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("knowverse:learning-archive-delete", { detail: { type: "review_session", key: session.sessionId } }));
      return;
    }
    if (!writeJSON(storage, key, session)) {
      throw new Error("复习会话无法写入本地存储。请先导出学习档案并检查浏览器空间。");
    }
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("knowverse:learning-archive-capture", { detail: { type: "review_session", key: session.sessionId } }));
  }
  function appendEvent(session, type, suffix, fields = {}) {
    const definition = definitions.get(session.variantId);
    const event = {
      id: session.sessionId + ":" + suffix,
      eventSchemaVersion: 2,
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
      gapId: session.targetGapId || fields.gapId || null,
      ...fields,
    };
    if (!progressStore.appendMany([event])) {
      throw new Error("学习事件写入失败。请先导出学习档案并检查浏览器空间。");
    }
    return event;
  }

  function start(input = {}) {
    const competencyId = String(input.competencyId || "");
    const targetGapId = input.gapId ? String(input.gapId) : null;
    const candidates = assessments.filter(item =>
      item.competencyId === competencyId && (!targetGapId || (item.gapIds || []).includes(targetGapId))
    );
    if (!candidates.length) throw new Error("没有找到与该知识点 / 薄弱点匹配的复习题。");
    const used = history().filter(item =>
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
      variantId: candidate.id,
      topicId: candidate.topicId,
      title: candidate.title,
      prompt: candidate.prompt,
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
    };
    persistSession(session);
    appendEvent(session, "review_started", "started", { reviewMode: targetGapId ? "targeted-gap" : "competency" });
    return clone(session);
  }

  function get(sessionId) {
    if (!storage) return null;
    const session = readJSON(storage, SESSION_PREFIX + String(sessionId), null);
    if (!session || session.schemaVersion !== 1 || !definitions.has(session.variantId)) return null;
    return session;
  }

  function revealHint(sessionId) {
    const session = get(sessionId);
    if (!session || session.status !== "active") throw new Error("当前复习会话已结束。");
    const definition = definitions.get(session.variantId);
    if (session.hintsUsed >= (definition.hints || []).length) return { session, hint: null, exhausted: true };
    session.hintsUsed += 1;
    const hint = definition.hints[session.hintsUsed - 1];
    persistSession(session);
    appendEvent(session, "hint_revealed", "hint:" + session.hintsUsed, {
      hintNumber: session.hintsUsed,
      hintsUsed: session.hintsUsed,
    });
    return { session: clone(session), hint, exhausted: false };
  }

  function submit(sessionId, optionId) {
    const session = get(sessionId);
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
      correct,
      selectedOptionId: optionId,
      gapId,
      attempts: session.attempts,
      hintsUsed: session.hintsUsed,
    };
    appendEvent(session, "attempt", "attempt:" + session.attempts, fields);
    session.status = correct ? "passed" : "failed";
    session.finishedAt = nowIso();
    if (correct) {
      appendEvent(session, "assessment_passed", "passed", {
        gapId,
        scorePct,
        earnedPoints: scorePct,
        maximumPoints: 100,
        attempts: session.attempts,
        hintsUsed: session.hintsUsed,
        independent: session.hintsUsed === 0,
      });
    }
    persistSession(session);
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
    available: Boolean(storage && typeof storage.getItem === "function" && typeof storage.setItem === "function"),
    start,
    get,
    revealHint,
    submit,
    getHistory: history,
    getAssessment(sessionId) {
      const session = get(sessionId);
      return session ? clone(definitions.get(session.variantId)) : null;
    },
  };
}
