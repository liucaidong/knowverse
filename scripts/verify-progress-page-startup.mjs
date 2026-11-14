import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");

test("progress page never blocks its first render on cloud initial sync", async () => {
  const page = await read("assets/js/learning-progress-page.mjs");
  const boot = page.slice(page.indexOf("async function boot()"));
  assert.doesNotMatch(boot, /await archiveRuntime\.initialSyncPromise/);
  assert.match(boot, /archiveRuntime\.initialSyncPromise\?\.then/);
  assert.ok(boot.indexOf("await refresh()") < boot.indexOf("archiveRuntime.initialSyncPromise?.then"));
});

test("progress page paints the local action plan before deferred lower-page sections", async () => {
  const page = await read("assets/js/learning-progress-page.mjs");
  const refresh = page.slice(page.indexOf("async function refresh()"), page.indexOf("function scheduleProactiveRefresh()"));
  const localPaint = refresh.indexOf("renderMetrics()");
  const plan = refresh.indexOf("renderAdaptivePlan(snapshot)");
  const yieldPaint = refresh.indexOf("await yieldToBrowserPaint()");
  const graph = refresh.indexOf("renderGraph()");
  assert.ok(localPaint >= 0 && plan > localPaint && yieldPaint > plan);
  assert.ok(graph > yieldPaint, "knowledge graph rendering must be deferred until its section approaches the viewport");
  assert.match(refresh, /const snapshot = await store\.load\(\)/);
});

test("heavy proactive modules are dynamically imported only when analysis is requested", async () => {
  const page = await read("assets/js/learning-progress-page.mjs");
  const staticImports = page.slice(0, page.indexOf("const siteRoot"));
  const initializer = page.slice(page.indexOf("async function ensureProactiveAnalysis()"), page.indexOf("function setupLazySections()"));
  assert.doesNotMatch(staticImports, /proactive-learning-engine|learning-agent\/(?:learner-profile|goal-manager|task-orchestrator)/);
  assert.match(initializer, /import\("\.\/proactive-learning-engine\.mjs"\)/);
  assert.match(initializer, /import\("\.\/learning-agent\/task-orchestrator\.mjs"\)/);
  assert.match(page, /advanced\?\.addEventListener\("toggle"/);
});
