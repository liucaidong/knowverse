// T2.3: AIProviderPort + capability contract tests (D7 red lines, no real model calls).
import assert from "node:assert/strict";
import test from "node:test";
import { ok, err, makeAIError, AI_ERROR_KINDS, CAPABILITIES, satisfiesCapability, validateAdapterSurface, PORT_METHODS } from "../supabase/functions/_shared/provider/port.mjs";
import { registerProvider, resolveProvider, eligibleProviders, _resetRegistry } from "../supabase/functions/_shared/provider/registry.mjs";

const adapter = { converse: async () => ok({ text: "?" }), suggest: async () => ok({ candidate: {} }) };

test("Result helpers and error taxonomy", () => {
  assert.equal(ok(1).ok, true);
  assert.equal(err({ kind: "AI_TIMEOUT" }).ok, false);
  assert.ok(AI_ERROR_KINDS.includes("AI_INVALID_OUTPUT"));
  assert.throws(() => makeAIError("NOT_A_KIND"));
});

test("capability strictness (D7): suggest needs strict schema, converse does not", () => {
  assert.equal(CAPABILITIES.converse.requiresStrictSchema, false);
  assert.equal(CAPABILITIES.suggest.requiresStrictSchema, true);
  const weak = { strictJsonSchema: false, streaming: true, capabilities: ["converse", "suggest"] };
  assert.equal(satisfiesCapability(weak, "converse"), true);
  assert.equal(satisfiesCapability(weak, "suggest"), false, "strict schema is an admission red line for suggest");
});

test("no capability may write mastery", () => {
  const dangerous = { strictJsonSchema: true, streaming: true, mayWriteMastery: true, capabilities: ["converse", "suggest"] };
  assert.equal(satisfiesCapability(dangerous, "converse"), false);
  assert.equal(satisfiesCapability(dangerous, "suggest"), false);
});

test("adapter surface validation", () => {
  assert.deepEqual(validateAdapterSurface(adapter), []);
  assert.ok(validateAdapterSurface({ converse() {} }).includes("missing method: suggest"));
  assert.deepEqual(PORT_METHODS, ["converse", "suggest"]);
});

test("registry selects eligible provider by capability and flag", () => {
  _resetRegistry();
  registerProvider("strong", { strictJsonSchema: true, streaming: true, capabilities: ["converse", "suggest"] }, adapter);
  registerProvider("chat-only", { strictJsonSchema: false, streaming: true, capabilities: ["converse"] }, adapter);
  assert.deepEqual(eligibleProviders("suggest"), ["strong"]);
  assert.deepEqual(eligibleProviders("converse"), ["strong", "chat-only"]);
  const picked = resolveProvider("suggest", {});
  assert.equal(picked.ok, true);
  assert.equal(picked.name, "strong");
  const badPreferred = resolveProvider("suggest", { preferred: "chat-only" });
  assert.equal(badPreferred.name, "strong", "ineligible preferred must not be used");
  _resetRegistry();
});

test("no eligible provider returns structured error (no silent fallback)", () => {
  _resetRegistry();
  const result = resolveProvider("suggest", {});
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, "AI_PROVIDER_ERROR");
  _resetRegistry();
});
