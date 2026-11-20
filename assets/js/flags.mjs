// KNOWVERSE feature flag reader for the static site (P0 skeleton, D4).
// Definitions live in supabase/functions/_shared/flags.mjs (single source of truth).
// Build-time injection is a P1 task; until then no flag is ever injected and every
// flag resolves to false (legacy behavior). Runtime overrides are supported here so
// P1 controlled rollout can use URL prefix / cookie / localStorage without code changes.
//
// This module is inert in P0: nothing imports it yet. Exporting the reader now
// establishes the mechanism without changing any page behavior or build output.

const FLAG_NAMES = Object.freeze([
  "NEW_IA_ENABLED",
  "API_V2_ENABLED",
  "AI_CONVERSE_ENABLED",
  "AI_SUGGEST_ENABLED",
  "PRACTICE_GENERATION_ENABLED",
  "AI_FORCE_FALLBACK",
]);

const LOCKED_OFF = Object.freeze(["PRACTICE_GENERATION_ENABLED"]);

function readRuntimeOverride(name) {
  try {
    const url = new URL(globalThis.location?.href || "http://localhost/");
    const fromUrl = url.searchParams.get(`kvflag_${name.toLowerCase()}`);
    if (fromUrl !== null) return fromUrl;
    const fromCookie = document.cookie
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`kvflag_${name.toLowerCase()}=`));
    if (fromCookie) return decodeURIComponent(fromCookie.split("=")[1]);
    const fromStorage = globalThis.localStorage?.getItem(`kvflag_${name}`);
    if (fromStorage !== null) return fromStorage;
  } catch { /* non-browser environment: no runtime override */ }
  return undefined;
}

function toBool(value) {
  if (value === undefined || value === null) return false;
  return !["0", "false", "off", "no"].includes(String(value).trim().toLowerCase());
}

/**
 * Resolve flags for the browser.
 * Priority: locked-off > runtime override (URL > cookie > localStorage)
 *           > build-time injected value (window.__KV_FLAGS__) > false.
 * @returns {Readonly<Record<string, boolean>>}
 */
export function resolveSiteFlags() {
  const injected = globalThis.__KV_FLAGS__ || {};
  const result = {};
  for (const name of FLAG_NAMES) {
    if (LOCKED_OFF.includes(name)) { result[name] = false; continue; }
    const override = readRuntimeOverride(name);
    result[name] = toBool(override !== undefined ? override : injected[name]);
  }
  return Object.freeze(result);
}

export { FLAG_NAMES, LOCKED_OFF };
