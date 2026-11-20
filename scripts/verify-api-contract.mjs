// T2.4: v1/v2 API contract tests (dual-track, degraded response, error codes).
import assert from "node:assert/strict";
import test from "node:test";
import * as C from "../supabase/functions/_shared/protocol/contract.mjs";

const v1 = { version: 1, mode: "tutor", message: "explain" };
const v2 = { version: 2, capability: "conversational_inquire", request_id: "abc12345-1111", message: "帮我追问", context: { goals: [] } };

test("v1 legacy request preserved", () => {
  assert.equal(C.validateV1(v1).ok, true);
  assert.equal(C.validateV1({ ...v1, version: 2 }).code, "SCHEMA_VERSION_UNSUPPORTED");
  assert.equal(C.validateV1({ ...v1, mode: "bad" }).code, "INVALID_REQUEST");
});

test("v2 capability request validation", () => {
  assert.equal(C.validateV2(v2).ok, true);
  assert.equal(C.validateV2({ ...v2, capability: "unknown" }).code, "INVALID_REQUEST");
  assert.equal(C.validateV2({ ...v2, request_id: "" }).code, "INVALID_REQUEST");
  assert.equal(C.validateV2({ ...v2, context: { arbitrary: 1 } }).code, "INVALID_REQUEST", "context must stay in the whitelist");
  assert.equal(C.validateV2({ ...v2, version: 1 }).code, "SCHEMA_VERSION_UNSUPPORTED");
});

test("canonical error codes and legacy aliases", () => {
  assert.equal(C.canonicalCode("AI_INVALID_OUTPUT"), "AI_INVALID_OUTPUT");
  assert.equal(C.canonicalCode("INVALID_JSON"), "INVALID_REQUEST");
  assert.equal(C.canonicalCode("INVALID_TUTOR_MODE"), "INVALID_REQUEST");
  assert.equal(C.canonicalCode("NO_SUCH_CODE"), null);
});

test("degraded envelope keeps core flow (HTTP 200 semantics, fallback flag)", () => {
  const env = C.degradedEnvelope({ requestId: "r1", traceId: "t1", fallbackText: "试试回答 X 与 Y 的区别？" });
  assert.equal(env.status, "degraded");
  assert.equal(env.data.fallback, true);
  assert.match(env.data.reply, /试试回答/);
  assert.equal(env.error, null);
});

test("error envelope is structured with retryable derived from category", () => {
  const e1 = C.errorEnvelope({ requestId: "r", traceId: "t", code: "INVALID_JSON" });
  assert.equal(e1.error.code, "INVALID_REQUEST");
  assert.equal(e1.error.category, "client");
  assert.equal(e1.error.retryable, false);
  const e2 = C.errorEnvelope({ requestId: "r", traceId: "t", code: "AI_TIMEOUT" });
  assert.equal(e2.error.retryable, true);
});

test("body size uses UTF-8 bytes (Deno-safe, no Buffer)", () => {
  assert.equal(C.validateBodySize("ok"), true);
  assert.equal(C.validateBodySize("字".repeat(40_000)), false);
});
