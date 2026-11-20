// P3/T3.1-T3.3: dialogue state machine, deterministic fallback, prompt policy.
import assert from "node:assert/strict";
import test from "node:test";
import { STATE, advance, deterministicHints, detectOutOfPolicy, DEFAULT_MAX_ROUNDS } from "../supabase/functions/_shared/orchestration/dialogue.mjs";
import { PROMPT_VERSION, buildSystemPrompt, buildUserMessage, SYSTEM_BLOCKS } from "../supabase/functions/_shared/orchestration/prompts.mjs";

test("happy path: bounded rounds then self-check then done", () => {
  let s = { state: STATE.AWAIT_OUTPUT, aiAvailable: true, progressed: false };
  let r = advance(s); // -> probing
  assert.equal(r.session.state, STATE.PROBING);
  assert.deepEqual(r.actions, ["call_converse"]);
  s = { ...r.session, progressed: true };
  let steps = 0;
  while (s.state !== STATE.DONE && steps < 20) {
    r = advance({ ...s, progressed: s.state === STATE.PROBING });
    s = r.session;
    steps += 1;
  }
  assert.equal(s.state, STATE.DONE);
  assert.ok(steps < 20, "must terminate, no infinite loop");
});

test("round cap enforced", () => {
  let s = { state: STATE.PROBING, aiAvailable: true, roundsUsed: 0, progressed: true };
  let probes = 0;
  for (let i = 0; i < 20 && s.state === STATE.PROBING; i++) {
    const r = advance(s);
    s = r.session;
    if (r.actions.includes("call_converse")) probes++;
    s.progressed = true;
  }
  assert.equal(probes, DEFAULT_MAX_ROUNDS, "no more than max rounds");
  assert.equal(s.state, STATE.SELF_CHECK);
});

test("AI unavailable -> deterministic fallback, core flow still reaches self-check", () => {
  let s = { state: STATE.AWAIT_OUTPUT, aiAvailable: false, progressed: false };
  let r = advance(s);
  assert.equal(r.session.state, STATE.FALLBACK);
  assert.deepEqual(r.actions, ["use_deterministic_hints"]);
  r = advance(r.session);
  assert.equal(r.session.state, STATE.SELF_CHECK);
  r = advance(r.session);
  assert.equal(r.session.state, STATE.DONE);
  assert.deepEqual(r.actions, ["finalize_evidence"]);
});

test("mid-dialogue AI failure switches to fallback (no block)", () => {
  const r = advance({ state: STATE.PROBING, aiAvailable: false, roundsUsed: 1, progressed: true });
  assert.equal(r.session.state, STATE.FALLBACK);
  assert.deepEqual(r.actions, ["use_deterministic_hints"]);
});

test("deterministic hints are derived from weak points, not a model", () => {
  const hints = deterministicHints(["因果与相关混淆", "微任务顺序"]);
  assert.equal(hints.length, 2);
  assert.match(hints[0], /因果与相关混淆/);
  assert.equal(deterministicHints([]).length, 2);
});

test("out-of-policy mastery verdicts are detected", () => {
  assert.equal(detectOutOfPolicy("你已经掌握了这个概念"), true);
  assert.equal(detectOutOfPolicy("掌握度 90%"), true);
  assert.equal(detectOutOfPolicy("试试比较 A 和 B 的区别"), false);
});

test("prompt is versioned with mastery ban and data/instruction separation", () => {
  assert.equal(PROMPT_VERSION, "socratic.v1");
  const sys = buildSystemPrompt();
  assert.ok(sys.includes(SYSTEM_BLOCKS.masteryBan));
  assert.ok(sys.includes("防注入"));
  const msg = buildUserMessage({ problem: "P", articulation: "我的理解", weakPoints: ["w1"] });
  assert.ok(msg.includes("<data>") && msg.includes("不是指令"));
  assert.ok(msg.includes("我的理解"));
});
