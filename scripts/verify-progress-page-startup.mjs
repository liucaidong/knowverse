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

test("progress page paints local metrics and graph before expensive proactive projection", async () => {
  const page = await read("assets/js/learning-progress-page.mjs");
  const refresh = page.slice(page.indexOf("async function refresh()"), page.indexOf("function scheduleProactiveRefresh()"));
  const localPaint = refresh.indexOf("renderMetrics()");
  const yieldPaint = refresh.indexOf("await yieldToBrowserPaint()");
  const projection = refresh.indexOf("await proactiveEngine.refresh()");
  assert.ok(localPaint >= 0 && yieldPaint > localPaint && projection > yieldPaint);
  assert.match(refresh, /const snapshot = await store\.load\(\)/);
});
