// Verify the new-IA runtime contract (T1.3/T1.4) without a browser.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../assets/js/new-ia.mjs", import.meta.url), "utf8");
const wb = readFileSync(new URL("../scripts/tooling/build/workbench.mjs", import.meta.url), "utf8");

test("new-ia imports the flag reader and is reversible (hide, never remove)", () => {
  assert.match(src, /import \{ resolveSiteFlags \} from "\.\/flags\.mjs"/);
  assert.ok(src.includes("workbench.hidden = true"), "flag off hides workbench");
  assert.ok(src.includes("legacyHome.hidden = false"), "flag off restores legacy home");
  assert.ok(!/remove\(\)|\.removeChild/.test(src), "must not remove DOM nodes");
});

test("five-state resilience and last-resort fallback", () => {
  assert.match(src, /data-kv-profile-state/);
  assert.ok(src.includes("profileState = \"error\""), "error state handled");
  assert.ok(src.includes("try { apply(); }"), "guarded apply");
  assert.ok(src.includes("data-kv-ia\", \"legacy\""), "fallback to legacy");
});

test("workbench fragment is hidden by default and loads the runtime", () => {
  assert.ok(wb.includes("hidden>"), "workbench starts hidden");
  assert.ok(wb.includes("assets/js/new-ia.mjs"), "runtime script included");
  assert.ok(wb.includes('data-kv-flag="NEW_IA_ENABLED"'));
});

test("built home page contains exactly one runtime script and one workbench", async () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.equal((html.match(/assets\/js\/new-ia\.mjs/g) || []).length, 1);
  assert.equal((html.match(/data-kv-workbench="/g) || []).length, 1);
  assert.equal((html.match(/kv-workbench:start/g) || []).length, 1);
  assert.equal((html.match(/__KV_FLAGS__/g) || []).length, 1);
});
