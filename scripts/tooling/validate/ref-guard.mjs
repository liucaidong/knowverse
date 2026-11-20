#!/usr/bin/env node
// P0 guard: detect unsafe Supabase CLI invocations that could target the wrong project.
// The linked-project.json points at Staging; a bare `supabase ...` command silently
// operates on Staging, and a hardcoded production ref without an explicit authorization
// marker can write to production. This guard fails closed on both patterns.
//
// Scope: .sh / .py / .mjs / .js / .yml / .yaml / .md under .github, scripts, docs, and repo root.
// Modes:
//   node scripts/tooling/validate/ref-guard.mjs            # report + exit nonzero on findings
//   node scripts/tooling/validate/ref-guard.mjs --json      # machine-readable findings
//   node scripts/tooling/validate/ref-guard.mjs --observe   # report only, always exit 0 (rollout phase)
//
// This is an additive guard. It changes no product behavior and writes nothing.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;
const PROD_REF = "sxcpareycpokcyroufww";
const AUTH_MARKER = "PROD_AUTHORIZED";
const SCAN_DIRS = [".github", "scripts", "docs"];
const SCAN_ROOT_FILES = []; // no root-level shell scripts currently call the CLI
const TEXT_EXT = new Set([".sh", ".py", ".mjs", ".js", ".cjs", ".yml", ".yaml", ".md"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".workbuddy", "tooling"]);

const argv = process.argv.slice(2);
const observe = argv.includes("--observe");
const asJson = argv.includes("--json");

function collectFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (TEXT_EXT.has(extname(name))) out.push(p);
    }
  };
  for (const d of SCAN_DIRS) walk(join(ROOT, d));
  for (const f of SCAN_ROOT_FILES) out.push(join(ROOT, f));
  return out;
}

// Matches a `supabase <subcommand>` invocation and captures the rest of its line/command.
const CLI_RE = /\bsupabase\s+(db|secrets|functions|link|projects|login|logs|gen|start|stop|status)\b([^\n`]*)/g;

function analyze() {
  const findings = [];
  for (const file of collectFiles()) {
    let text;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    // Strip fenced code blocks only for prose files? No: docs may document real commands.
    // We scan everything; documentation lines are classified by severity 'doc'.
    const isDoc = extname(file) === ".md";
    for (const m of text.matchAll(CLI_RE)) {
      const rest = m[2] || "";
      const line = text.slice(0, m.index).split("\n").length;
      const hasRemote = /--remote(=|\s)/.test(rest);
      const hasProjectRef = /--project-ref(=|\s)/.test(rest);
      const targetsProd = rest.includes(PROD_REF);
      // Executable invocations (shell/scripts/workflows) must pin a ref.
      if (!isDoc && !hasRemote && !hasProjectRef) {
        findings.push({
          file: relative(ROOT, file), line, severity: "error",
          kind: "unpinned-cli-call",
          message: "supabase CLI call without --remote/--project-ref; would use linked (Staging) project implicitly",
        });
      }
      // Any production ref requires an explicit authorization marker on the same line or preceding comment block.
      if (targetsProd) {
        const lineStart = text.lastIndexOf("\n", m.index) + 1;
        const context = text.slice(Math.max(0, lineStart - 200), lineStart);
        const authorized = context.includes(AUTH_MARKER) || rest.includes(AUTH_MARKER);
        if (!authorized) {
          findings.push({
            file: relative(ROOT, file), line,
            severity: isDoc ? "warn" : "error",
            kind: "prod-ref-without-authorization",
            message: `production ref ${PROD_REF} referenced without ${AUTH_MARKER} marker`,
          });
        }
      }
    }
  }
  return findings;
}

const findings = analyze();
if (asJson) {
  console.log(JSON.stringify({ schemaVersion: 1, mode: observe ? "observe" : "enforce", findings }, null, 2));
} else {
  if (findings.length === 0) {
    console.log("ref-guard: OK — no unpinned Supabase CLI calls, no unauthorized production refs.");
  } else {
    for (const f of findings) {
      console.log(`[${f.severity}] ${f.kind}: ${f.file}:${f.line} — ${f.message}`);
    }
    console.log(`ref-guard: ${findings.length} finding(s).`);
  }
}

if (!observe && findings.some((f) => f.severity === "error")) process.exitCode = 1;
