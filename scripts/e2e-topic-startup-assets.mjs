import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

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

test("all 12 knowledge topics use the current context system without retired graph assets", {
  timeout: 90000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const failures = [];
    const browserLogs = [];
    page.on("pageerror", error => failures.push(error.message));
    page.on("console", message => { browserLogs.push(message.type() + ": " + message.text()); });

    let requested = new Set();
    page.on("request", request => {
      if (request.url().startsWith(baseURL)) requested.add(new URL(request.url()).pathname);
    });
    for (const topic of topics) {
      requested = new Set();
      await page.goto(baseURL + "/knowledge/" + topic + "/", { waitUntil: "networkidle" });
      try {
        await page.locator(".kv-topic-context").waitFor({ state: "visible", timeout: 15000 });
      } catch {
        throw new Error(topic + " topic context did not render; requests=" + JSON.stringify([...requested]) +
          "; pageErrors=" + JSON.stringify(failures) + "; consoleErrors=" + JSON.stringify(browserLogs));
      }
      assert.ok(requested.has("/assets/js/v2.js"), topic + " must load the shared bootstrap");
      assert.ok(requested.has("/assets/js/knowledge-context.mjs"), topic + " must render the current topic relationship context");
      assert.ok(requested.has("/content/knowledge-context.json"), topic + " must load the compact context registry");
      assert.ok(requested.has("/assets/css/site-architecture.css"), topic + " must load current relationship styles");
      assert.equal([...requested].some(path => /^\/content\/(knowledge|works|learning-map|search-metadata)\.json$/.test(path)), false,
        topic + " must not download the four source registries separately");
      assert.equal([...requested].some(path => path.endsWith("/knowledge-graph.js")), false,
        topic + " must not request the retired graph bootstrap");
      assert.equal([...requested].some(path => path.endsWith("/knowledge-graph.css")), false,
        topic + " must not request the retired graph stylesheet");
      assert.equal(await page.locator(".kv-topic-context").count(), 1, topic + " must render one relationship context");
      assert.equal(browserLogs.some(log => log.includes("knowledge context unavailable")), false,
        topic + " must not emit a knowledge-context initialization warning: " + JSON.stringify(browserLogs));
    }

    requested = new Set();
    await page.goto(baseURL + "/knowledge/", { waitUntil: "networkidle" });
    await page.locator(".kv-architecture-overview").waitFor({ state: "visible", timeout: 15000 });
    assert.equal(requested.has("/content/knowledge-context.json"), false,
      "the statically generated knowledge directory must not fetch a context registry");
    assert.equal([...requested].filter(path => path.startsWith("/content/") && path.endsWith(".json")).length, 0,
      "the knowledge directory must not fetch content registries for its static overview");

    requested = new Set();
    await page.goto(baseURL + "/knowledge/ai-agents/chapter-03/", { waitUntil: "networkidle" });
    await page.locator(".kv-article-context").waitFor({ state: "visible", timeout: 15000 });
    assert.ok(requested.has("/content/knowledge-context.json"), "article pages must reuse the compact context registry");
    assert.equal([...requested].filter(path => path.startsWith("/content/") && path.endsWith(".json")).length, 1,
      "article pages must fetch one compact context JSON instead of source registries");
    assert.equal(browserLogs.some(log => log.includes("knowledge context unavailable")), false,
      "article context must not emit a knowledge-context initialization warning");
    assert.deepEqual(failures, []);
  } finally {
    await browser.close();
  }
});
