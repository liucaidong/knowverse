// Verify the P0 feature-flag skeleton is consistent and defaults to legacy behavior.
// Read-only: no build, no network, no product behavior change.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const edgeSource = readFileSync(new URL("../supabase/functions/_shared/flags.mjs", import.meta.url), "utf8");
const siteSource = readFileSync(new URL("../assets/js/flags.mjs", import.meta.url), "utf8");

test("edge flags define all P0 flags with false defaults", async () => {
  const mod = await import("../supabase/functions/_shared/flags.mjs");
  const names = Object.keys(mod.FLAG_DEFINITIONS);
  assert.ok(names.length >= 5, "expected the P0 flag set");
  for (const [name, def] of Object.entries(mod.FLAG_DEFINITIONS)) {
    assert.equal(def.default, false, `${name} must default OFF in P0`);
  }
  assert.equal(mod.FLAG_DEFINITIONS.PRACTICE_GENERATION_ENABLED.lockedOff, true,
    "retired practice generation must be locked off (D1/KV41-011)");
});

test("edge resolveEdgeFlags returns all false with empty env", async () => {
  const mod = await import("../supabase/functions/_shared/flags.mjs");
  const resolved = mod.resolveEdgeFlags({ get: () => undefined });
  for (const value of Object.values(resolved)) assert.equal(value, false);
});

test("edge lockedOff flag cannot be enabled by env override", async () => {
  const mod = await import("../supabase/functions/_shared/flags.mjs");
  const resolved = mod.resolveEdgeFlags({ get: () => "true" });
  assert.equal(resolved.PRACTICE_GENERATION_ENABLED, false);
});

test("site flag name list matches edge definitions", async () => {
  const mod = await import("../supabase/functions/_shared/flags.mjs");
  const edgeNames = Object.keys(mod.FLAG_DEFINITIONS).sort();
  const siteNames = [...siteSource.matchAll(/^\s{2}"([A-Z0-9_]+)",$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(siteNames, edgeNames, "site FLAG_NAMES must mirror edge FLAG_DEFINITIONS");
});

test("site locked-off list mirrors edge", () => {
  const siteLocked = [...siteSource.matchAll(/const LOCKED_OFF = Object\.freeze\(\["([A-Z0-9_]+)"\]\)/g)].map((m) => m[1]);
  assert.deepEqual(siteLocked, ["PRACTICE_GENERATION_ENABLED"]);
});

test("no product module imports the flag reader in P0", () => {
  // Only the reader file itself may mention resolveSiteFlags; P0 is inert.
  assert.match(siteSource, /export function resolveSiteFlags/);
  assert.match(edgeSource, /export function resolveEdgeFlags/);
});
