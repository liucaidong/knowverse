// AIProviderPort — domain port for all model calls (P2 / T2.3, D7).
// The domain layer depends only on this contract, never on a vendor SDK.
// Two capabilities with different strictness (D7):
//   converse — natural-language probe/critique; NO strict JSON schema required.
//   suggest  — structured note candidates; strict JSON schema is an admission red line.
//
// Result<T,E> is explicit; domain code never relies on exceptions crossing the port.
// Never reads or emits secret values — adapters handle credentials via Deno.env by NAME only.

/** @typedef {{ok:true, value:any}} Ok */
/** @typedef {{ok:false, error:object}} Err */

export const ok = (value) => Object.freeze({ ok: true, value });
export const err = (error) => Object.freeze({ ok: false, error });

/** Normalized error taxonomy (drives circuit-breaking, fallback, observability). */
export const AI_ERROR_KINDS = Object.freeze([
  "AI_INVALID_OUTPUT",   // suggest schema fail / converse out-of-policy detection
  "AI_TIMEOUT",
  "AI_RATE_LIMIT",
  "AI_PROVIDER_ERROR",
  "AI_CONTENT_FILTER",
  "AI_CIRCUIT_OPEN",
]);

export const makeAIError = (kind, detail = "") => {
  if (!AI_ERROR_KINDS.includes(kind)) throw new Error(`unknown AI error kind: ${kind}`);
  return Object.freeze({ kind, detail: String(detail).slice(0, 200) });
};

/**
 * Capability contract. strictSchema=true is an admission red line for `suggest`
 * providers; `converse` forbids requiring strict JSON output (it is natural text).
 */
export const CAPABILITIES = Object.freeze({
  converse: Object.freeze({
    name: "converse",
    requiresStrictSchema: false,
    requiresStreaming: true,
    output: "natural_language",
    mayWriteMastery: false,
  }),
  suggest: Object.freeze({
    name: "suggest",
    requiresStrictSchema: true,
    requiresStreaming: false,
    output: "strict_json",
    mayWriteMastery: false,
  }),
});

/** Capability admission test: a provider descriptor must satisfy all capability requirements. */
export function satisfiesCapability(descriptor, capabilityName) {
  const cap = CAPABILITIES[capabilityName];
  if (!cap) return false;
  if (!descriptor || typeof descriptor !== "object") return false;
  if (cap.requiresStrictSchema && descriptor.strictJsonSchema !== true) return false;
  if (cap.requiresStreaming && descriptor.streaming !== true) return false;
  if (descriptor.mayWriteMastery === true) return false; // no capability may write mastery
  return descriptor.capabilities?.includes?.(capabilityName) === true;
}

/**
 * Port interface (documented contract; adapters implement these methods).
 *  - converse(input): Promise<Result<{text, finishReason, usage}, AIError>>
 *  - suggest(input, schemaVersion): Promise<Result<{candidate, schemaVersion}, AIError>>
 * Implementations live in infrastructure; the domain imports only this module.
 */
export const PORT_METHODS = Object.freeze(["converse", "suggest"]);

/** Validate an adapter surface without calling it (used by contract tests). */
export function validateAdapterSurface(adapter) {
  const problems = [];
  if (!adapter || typeof adapter !== "object") return ["adapter is not an object"];
  for (const method of PORT_METHODS) {
    if (typeof adapter[method] !== "function") problems.push(`missing method: ${method}`);
  }
  return problems;
}
