// v1/v2 API contract for learning-agent (P2/T2.4, D10 dual-track).
// Defines request validation, canonical error codes (+ legacy aliases), and the
// degraded response shape that keeps the core flow 100% complete when AI is down.
// Pure module: no network, no secrets, no side effects. Existing index.ts behavior
// is unchanged in P2; this is the contract skeleton for flag-gated v2 adoption.

export const CONTRACT_VERSIONS = Object.freeze([1, 2]);

export const CAPABILITIES = Object.freeze([
  "conversational_inquire",   // Socratic probe
  "conversational_challenge", // point out flaws
  "note_structure_suggest",   // candidate only
]);

/** Canonical error codes + legacy aliases for the dual-track period. */
export const ERROR_CODES = Object.freeze({
  ORIGIN_NOT_ALLOWED: { http: 403, category: "policy", aliases: [] },
  ACCOUNT_NOT_AUTHORIZED: { http: 403, category: "policy", aliases: [] },
  INVALID_REQUEST: { http: 400, category: "client", aliases: ["INVALID_JSON", "INVALID_TUTOR_MODE"] },
  SCHEMA_VERSION_UNSUPPORTED: { http: 400, category: "client", aliases: [] },
  RATE_LIMITED: { http: 429, category: "client", aliases: [] },
  AI_PROVIDER_NOT_CONFIGURED: { http: 503, category: "provider", aliases: [] },
  AI_PROVIDER_QUOTA_EXCEEDED: { http: 503, category: "provider", aliases: [] },
  AI_PROVIDER_ERROR: { http: 502, category: "provider", aliases: ["AI_PROVIDER_ERROR"] },
  AI_INVALID_OUTPUT: { http: 502, category: "provider", aliases: [] },
  AI_TIMEOUT: { http: 504, category: "provider", aliases: [] },
  AI_CIRCUIT_OPEN: { http: 503, category: "provider", aliases: [] },
  CAPABILITY_DISABLED: { http: 200, category: "policy", aliases: [] },
  AGENT_INTERNAL_ERROR: { http: 500, category: "internal", aliases: [] },
});

/** Map a legacy code to its canonical code (identity if already canonical). */
export function canonicalCode(code) {
  if (ERROR_CODES[code]) return code;
  for (const [canonical, meta] of Object.entries(ERROR_CODES)) {
    if (meta.aliases.includes(code)) return canonical;
  }
  return null;
}

const MAX_MESSAGE = 4000;
const MAX_BODY_BYTES = 32 * 1024;
const CONTEXT_KEYS = new Set(["goals", "mastery", "weakPoints", "competencyStates", "activePlan", "recentConversation", "requestedToolResults", "learningScene"]);

/** Validate a v1 request (legacy shape preserved). */
export function validateV1(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, code: "INVALID_REQUEST" };
  if (body.version !== undefined && body.version !== 1) return { ok: false, code: "SCHEMA_VERSION_UNSUPPORTED" };
  if (typeof body.mode !== "string" || !["agent", "tutor"].includes(body.mode)) return { ok: false, code: "INVALID_REQUEST" };
  if (typeof body.message !== "string" || body.message.length > MAX_MESSAGE) return { ok: false, code: "INVALID_REQUEST" };
  return { ok: true };
}

/** Validate a v2 capability request (dual-track, flag-gated). */
export function validateV2(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, code: "INVALID_REQUEST" };
  if (body.version !== 2) return { ok: false, code: "SCHEMA_VERSION_UNSUPPORTED" };
  if (!CAPABILITIES.includes(body.capability)) return { ok: false, code: "INVALID_REQUEST" };
  if (typeof body.request_id !== "string" || !/^[0-9a-f-]{8,}$/i.test(body.request_id)) return { ok: false, code: "INVALID_REQUEST" };
  if (typeof body.message !== "string" || !body.message.trim() || body.message.length > MAX_MESSAGE) return { ok: false, code: "INVALID_REQUEST" };
  if (body.context !== undefined) {
    if (!body.context || typeof body.context !== "object" || Array.isArray(body.context)) return { ok: false, code: "INVALID_REQUEST" };
    const unknown = Object.keys(body.context).filter((k) => !CONTEXT_KEYS.has(k));
    if (unknown.length) return { ok: false, code: "INVALID_REQUEST" };
  }
  return { ok: true };
}

export function validateBodySize(raw) {
  return new TextEncoder().encode(String(raw ?? "")).length <= MAX_BODY_BYTES;
}

/** Success envelope (v2). */
export function successEnvelope({ requestId, traceId, data, status = "ok", meta = {} }) {
  return { version: 2, request_id: requestId, trace_id: traceId, status, data, meta, error: null };
}

/**
 * Degraded envelope: AI output is NOT used; deterministic fallback text is returned.
 * This is the mechanism behind "AI unavailable core flow 100% complete".
 * Never applies to mutation suggestions or the Reviewer (those stay fail-closed).
 */
export function degradedEnvelope({ requestId, traceId, fallbackText, reason = "AI_UNAVAILABLE" }) {
  return {
    version: 2,
    request_id: requestId,
    trace_id: traceId,
    status: "degraded",
    data: { reply: String(fallbackText || ""), fallback: true, kind: "deterministic_hint" },
    meta: { reason },
    error: null,
  };
}

/** Error envelope (v2). */
export function errorEnvelope({ requestId, traceId, code, message = "" }) {
  const canonical = canonicalCode(code) || "AGENT_INTERNAL_ERROR";
  const meta = ERROR_CODES[canonical];
  return {
    version: 2,
    request_id: requestId,
    trace_id: traceId,
    error: { code: canonical, message: String(message).slice(0, 200), category: meta.category, retryable: meta.http >= 500 || canonical === "RATE_LIMITED" },
  };
}
