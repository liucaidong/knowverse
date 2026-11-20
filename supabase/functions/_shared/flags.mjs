// KNOWVERSE feature flags — SINGLE SOURCE OF TRUTH (P0 skeleton, D4).
// Both the Edge runtime and the static site consume these definitions.
// The build-time site flag values are derived from this file (see assets/js/flags.mjs).
//
// P0 rule: all flags default OFF so the legacy IA/behavior remains the default.
// No business logic reads these yet — P0 only establishes the definition + reader.
// Enabling a flag is a reviewed change; production behavior changes require authorization.

export const FLAG_DEFINITIONS = Object.freeze({
  // New "today workbench" IA vs the legacy knowledge-directory home.
  // P1: controlled rollout via URL prefix/cookie; P4: default on.
  NEW_IA_ENABLED: Object.freeze({
    default: false,
    description: "Render the problem-driven workbench IA instead of the legacy home.",
    stage: "P1",
  }),
  // Capability v2 (converse/challenge/suggest) alongside v1 dual-track.
  API_V2_ENABLED: Object.freeze({
    default: false,
    description: "Accept version:2 capability-based API contracts on Edge Functions.",
    stage: "P2",
  }),
  // Conversational inquiry (Socratic probe/critique). Off until AI is configured.
  AI_CONVERSE_ENABLED: Object.freeze({
    default: false,
    description: "Enable Socratic probe/critique; when off, deterministic hint fallback is used.",
    stage: "P3",
  }),
  // Note structuring suggestion (candidate only, strict-schema capable providers only).
  AI_SUGGEST_ENABLED: Object.freeze({
    default: false,
    description: "Enable note-structure suggestions (candidates, never written to registries).",
    stage: "P3",
  }),
  // Retired strict 11-field practice generation — permanently off in MVP (D1).
  PRACTICE_GENERATION_ENABLED: Object.freeze({
    default: false,
    description: "Retired in MVP (D1/KV41-011). Must stay false; re-enable requires a strict-schema capable provider and explicit review.",
    stage: "retired",
    lockedOff: true,
  }),
  // Force the deterministic fallback for drills/fault injection.
  AI_FORCE_FALLBACK: Object.freeze({
    default: false,
    description: "Force all AI capabilities to the deterministic fallback path.",
    stage: "P3",
  }),
});

/** Return resolved flag values for the Edge runtime.
 *  Env override names are fixed and documented; secret values are never read. */
export function resolveEdgeFlags(env = globalThis.Deno?.env ?? {}) {
  const result = {};
  for (const [name, def] of Object.entries(FLAG_DEFINITIONS)) {
    const raw = typeof env.get === "function" ? env.get(`KV_FLAG_${name}`) : undefined;
    if (def.lockedOff) { result[name] = false; continue; }
    result[name] = raw === undefined || raw === null
      ? def.default
      : !["0", "false", "off", "no"].includes(String(raw).trim().toLowerCase());
  }
  return Object.freeze(result);
}

/** Names of environment variables a flag may be overridden by (no values). */
export const FLAG_ENV_NAMES = Object.freeze(
  Object.keys(FLAG_DEFINITIONS).map((name) => `KV_FLAG_${name}`),
);
