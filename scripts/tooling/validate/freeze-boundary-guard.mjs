#!/usr/bin/env node
// P0 guard: verify the frozen foundation has not drifted from the P0 baseline.
// Compares live repo state against scripts/tooling/lib/baseline-snapshot.json.
// Read-only: it never modifies files, never touches Supabase, never reads secret values.
//
// Freeze scope (AGENTS.md §2 + D2):
//   - config.toml: function set + verify_jwt
//   - migration count (append-only history; new migrations require explicit authorization)
//   - Edge Function env var NAMES (values are never read)
//   - canonical registry counts (one ID / one source of truth, Concept/Competency/Evidence split)
//
// Modes:
//   node scripts/tooling/validate/freeze-boundary-guard.mjs            # enforce (exit 1 on drift)
//   node scripts/tooling/validate/freeze-boundary-guard.mjs --observe  # report only
//   node scripts/tooling/validate/freeze-boundary-guard.mjs --json     # machine-readable

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;
const BASELINE_PATH = join(ROOT, "scripts/tooling/lib/baseline-snapshot.json");
const argv = process.argv.slice(2);
const observe = argv.includes("--observe");
const asJson = argv.includes("--json");

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const fb = baseline.freezeBaseline;
const drift = [];

function check(kind, actual, expected, note = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) drift.push({ kind, expected, actual, note });
}

// 1. config.toml functions + verify_jwt
const configText = readFileSync(join(ROOT, "supabase/config.toml"), "utf8");
const fnMatches = [...configText.matchAll(/^\[functions\.([^\]]+)\]\s*$/gm)].map((m) => m[1]);
check("config.functions", fnMatches.sort(), [...fb.configToml.functions].sort(),
  "new/removed Edge Function requires config.toml change (frozen)");
const verifyJwtAll = fnMatches.length > 0 && fnMatches.every((fn) => {
  const section = configText.match(new RegExp(`\\[functions\\.${fn}\\][\\s\\S]*?(?=\\n\\[|$)`));
  return section && /verify_jwt\s*=\s*true/.test(section[0]);
});
check("config.verifyJwt", verifyJwtAll, fb.configToml.verifyJwt,
  "all functions must keep verify_jwt = true");

// 2. migration count (append-only history)
const migrations = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
check("migrations.count", migrations.length, fb.migrationCount,
  "new migration requires explicit user authorization; do not edit history");

// 3. Edge Function env var NAMES only (never values)
const envNames = new Set();
const fnDir = join(ROOT, "supabase/functions");
for (const name of readdirSync(fnDir)) {
  let files;
  try { files = readdirSync(join(fnDir, name)); } catch { continue; }
  for (const f of files) {
    if (!/\.(ts|js|mjs)$/.test(f)) continue;
    let text;
    try { text = readFileSync(join(fnDir, name, f), "utf8"); } catch { continue; }
    for (const m of text.matchAll(/Deno\.env\.get\(\s*["']([A-Z0-9_]+)["']\s*\)/g)) envNames.add(m[1]);
  }
}
check("envVarNames", [...envNames].sort(), [...fb.edgeFunctionEnvVarNames].sort(),
  "new secret/name requires explicit authorization; values are never read");

// 4. canonical registry counts
const regCounts = {};
for (const [key, file, field] of [
  ["topics", "knowledge.json", "topics"],
  ["concepts", "concepts.json", "concepts"],
  ["works", "works.json", "works"],
  ["sources", "sources.json", "sources"],
]) {
  const d = JSON.parse(readFileSync(join(ROOT, "content", file), "utf8"));
  regCounts[key] = Array.isArray(d[field]) ? d[field].length : (d[field] ? Object.keys(d[field]).length : 0);
}
for (const k of Object.keys(regCounts)) check(`registry.${k}`, regCounts[k], baseline.registries[k],
  "registry growth during redesign must be explicit + reviewed, not silent drift");

if (asJson) {
  console.log(JSON.stringify({ schemaVersion: 1, mode: observe ? "observe" : "enforce", drift }, null, 2));
} else if (drift.length === 0) {
  console.log("freeze-guard: OK — frozen foundation matches P0 baseline.");
} else {
  for (const d of drift) {
    console.log(`[DRIFT] ${d.kind}: baseline=${JSON.stringify(d.expected)} current=${JSON.stringify(d.actual)} — ${d.note}`);
  }
  console.log(`freeze-guard: ${drift.length} drift(s).`);
}

if (!observe && drift.length > 0) process.exitCode = 1;
