// Socratic dialogue state machine (P3/T3.1, D1/D7).
// Single agent, bounded rounds, monotonic progress, deterministic fallback.
// Pure module: no model calls, no I/O, no mastery writes. Adapters/edge call this.

export const STATE = Object.freeze({
  AWAIT_OUTPUT: "await_output",     // learner writes their understanding
  PROBING: "probing",               // AI asks a bounded number of probes
  FALLBACK: "fallback",             // AI unavailable -> deterministic hints
  SELF_CHECK: "self_check",         // deterministic assessment (not here)
  DONE: "done",
});

export const DEFAULT_MAX_ROUNDS = 3;

/**
 * Advance the dialogue state.
 * @param {object} session { state, roundsUsed, aiAvailable, forceFallback, progressed }
 * @param {object} opts { maxRounds }
 * @returns {object} next session + actions for the caller
 */
export function advance(session, opts = {}) {
  const maxRounds = Number.isInteger(opts.maxRounds) && opts.maxRounds > 0 ? opts.maxRounds : DEFAULT_MAX_ROUNDS;
  const s = {
    state: session?.state || STATE.AWAIT_OUTPUT,
    roundsUsed: Number(session?.roundsUsed) || 0,
    aiAvailable: session?.aiAvailable !== false,
    forceFallback: session?.forceFallback === true,
    progressed: session?.progressed === true,
  };
  const actions = [];

  if (s.state === STATE.AWAIT_OUTPUT) {
    s.state = (s.aiAvailable && !s.forceFallback) ? STATE.PROBING : STATE.FALLBACK;
    actions.push(s.state === STATE.PROBING ? "call_converse" : "use_deterministic_hints");
    return { session: s, actions };
  }

  if (s.state === STATE.PROBING || s.state === STATE.FALLBACK) {
    // AI can fail mid-dialogue -> switch to fallback without blocking.
    if (s.state === STATE.PROBING && (!s.aiAvailable || s.forceFallback)) {
      s.state = STATE.FALLBACK;
      actions.push("use_deterministic_hints");
      // Return here: a failed AI call must land in fallback THIS turn, giving the
      // caller a chance to deliver deterministic hints before proceeding to self-check.
      return { session: s, actions };
    }
    const canProbe = s.state === STATE.PROBING && s.roundsUsed < maxRounds && s.progressed;
    if (canProbe) {
      s.roundsUsed += 1;
      s.progressed = false;
      actions.push("call_converse");
      return { session: s, actions };
    }
    // Exit condition: round cap, no progress, or fallback mode -> deterministic self-check.
    s.state = STATE.SELF_CHECK;
    actions.push("enter_self_check");
    return { session: s, actions };
  }

  if (s.state === STATE.SELF_CHECK) {
    s.state = STATE.DONE;
    actions.push("finalize_evidence"); // caller runs the deterministic evidence reducer
    return { session: s, actions };
  }

  // DONE or unknown: terminal, no actions.
  return { session: s, actions };
}

/** Deterministic hint source: derived from weak-point signals, not from a model. */
export function deterministicHints(weakPoints = []) {
  const points = Array.isArray(weakPoints) ? weakPoints.filter((x) => typeof x === "string" && x.trim()) : [];
  if (!points.length) {
    return ["试着用你自己的话解释这个机制的因果链。", "你的解释里哪一步依赖了未验证的假设？"];
  }
  return points.slice(0, 3).map((p) => `试着回答：${p} 的依据是什么？能否举一个反例？`);
}

/** Policy guard: the model must never emit mastery verdicts or write facts. */
const VERDICT_RE = /已(经)?掌握|未掌握|掌握度|得分|等级|是否通过|已记录|已写入|mastery.*%/i;
export function detectOutOfPolicy(text) {
  return VERDICT_RE.test(String(text || ""));
}
