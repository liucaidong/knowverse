import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, webkit } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};
const topics = [
  "ai-agents", "ai-education", "creative", "database", "engineering", "finance",
  "language", "math", "model-infra", "monorepo", "promise", "react-native",
];

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let file = resolve(root, pathname.replace(/^\//, "") || "index.html");
    if (file !== root && !file.startsWith(root + sep)) return response.writeHead(403).end("Forbidden");
    try {
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    } catch {
      return response.writeHead(404).end("Not found");
    }
    response.writeHead(200, {
      "content-type": mime[extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(500).end("Internal error");
  }
});
await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});
const baseURL = "http://127.0.0.1:" + server.address().port;
test.after(() => new Promise(resolveClose => server.close(resolveClose)));

async function installPageDiagnostics(page) {
  await page.addInitScript(() => {
    window.__topicCls = 0;
    try {
      new PerformanceObserver(list => list.getEntries().forEach(entry => {
        if (!entry.hadRecentInput) window.__topicCls += entry.value;
      })).observe({ type: "layout-shift", buffered: true });
    } catch {}
  });
}

function assertNoRuntimeContextRequests(requested, route) {
  assert.equal(requested.has("/assets/js/knowledge-context.mjs"), false,
    route + " must not load a runtime context module");
  assert.equal(requested.has("/content/knowledge-context.json"), false,
    route + " must not request a runtime context manifest");
  assert.equal([...requested].some(path => path.endsWith("/knowledge-graph.js")), false,
    route + " must not request the retired graph bootstrap");
  assert.equal([...requested].some(path => path.endsWith("/knowledge-graph.css")), false,
    route + " must not request the retired graph stylesheet");
  assert.equal([...requested].some(path => /^\/content\/(knowledge|works|learning-map|search-metadata)\.json$/.test(path)), false,
    route + " must not download source registries at runtime");
}

test("all 12 knowledge topics ship static context without runtime JSON or layout shift", {
  timeout: 90000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await installPageDiagnostics(page);
    const failures = [];
    const browserLogs = [];
    let requested = new Set();
    page.on("pageerror", error => failures.push(error.message));
    page.on("console", message => {
      if (message.type() === "error" || message.text().includes("knowledge context unavailable")) {
        browserLogs.push(message.type() + ": " + message.text());
      }
    });
    page.on("request", request => {
      if (request.url().startsWith(baseURL)) requested.add(new URL(request.url()).pathname);
    });

    for (const topic of topics) {
      requested = new Set();
      const route = "/knowledge/" + topic + "/";
      await page.goto(baseURL + route, { waitUntil: "domcontentloaded" });
      const context = page.locator('.kv-topic-context[data-kv-topic-context="' + topic + '"]');
      await context.waitFor({ state: "visible", timeout: 15000 });
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(100);
      assert.equal(await context.count(), 1, topic + " must contain exactly one static topic context");
      assert.ok(requested.has("/assets/js/v2.js"), topic + " must retain the shared site bootstrap");
      assert.ok(requested.has("/assets/css/site-architecture.css"), topic + " must retain context styles");
      assertNoRuntimeContextRequests(requested, route);
      const metrics = await page.evaluate(() => ({
        cls: Number(window.__topicCls.toFixed(4)),
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.ok(metrics.cls < 0.1, topic + " static context must keep CLS below 0.1; " + JSON.stringify(metrics));
      assert.equal(metrics.overflow, false, topic + " must not overflow horizontally");
      assert.equal(browserLogs.some(log => log.includes("knowledge context unavailable")), false,
        topic + " must not emit knowledge-context warnings");
    }

    requested = new Set();
    await page.goto(baseURL + "/knowledge/", { waitUntil: "domcontentloaded" });
    await page.locator(".kv-architecture-overview").waitFor({ state: "visible" });
    assertNoRuntimeContextRequests(requested, "/knowledge/");

    requested = new Set();
    await page.goto(baseURL + "/knowledge/ai-agents/chapter-03/", { waitUntil: "domcontentloaded" });
    await page.locator('.kv-article-context[data-kv-article-context="ai-agents"]').waitFor({ state: "visible" });
    await page.waitForLoadState("networkidle");
    assertNoRuntimeContextRequests(requested, "/knowledge/ai-agents/chapter-03/");
    assert.deepEqual(failures, []);
    assert.deepEqual(browserLogs, []);
  } finally {
    await browser.close();
  }
});

test("WebKit mobile: static topic and article context fit narrow screens without layout shift", {
  timeout: 90000,
}, async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await installPageDiagnostics(page);
    const failures = [];
    page.on("pageerror", error => failures.push(error.message));
    for (const route of [
      "/knowledge/ai-agents/",
      "/knowledge/monorepo/",
      "/knowledge/promise/",
      "/knowledge/ai-agents/chapter-03/",
    ]) {
      await page.goto(baseURL + route, { waitUntil: "domcontentloaded" });
      await page.locator(".kv-topic-context, .kv-article-context").first().waitFor({ state: "visible" });
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(100);
      const metrics = await page.evaluate(() => ({
        cls: Number(window.__topicCls.toFixed(4)),
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.ok(metrics.cls < 0.1, route + " CLS " + JSON.stringify(metrics));
      assert.equal(metrics.overflow, false, route + " must not overflow a 390px viewport");
    }
    assert.deepEqual(failures, []);
  } finally {
    await browser.close();
  }
});
