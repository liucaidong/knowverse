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
    response.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" });
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

test("page-specific stylesheets load only on pages that own those components", { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const requests = new Set();
    const failures = [];
    page.on("request", request => {
      if (request.url().startsWith(baseURL)) requests.add(new URL(request.url()).pathname);
    });
    page.on("requestfailed", request => failures.push(request.url()));

    const cases = [
      ["/", "/assets/css/site-home.css", ["/assets/css/site-progress.css", "/assets/css/site-provenance.css", "/assets/css/site-immersive.css"]],
      ["/progress/", "/assets/css/site-progress.css", ["/assets/css/site-home.css", "/assets/css/site-provenance.css", "/assets/css/site-immersive.css"]],
      ["/provenance/", "/assets/css/site-provenance.css", ["/assets/css/site-home.css", "/assets/css/site-progress.css", "/assets/css/site-immersive.css"]],
      ["/gallery/exhibits/promise-cosmos/", "/assets/css/site-immersive.css", ["/assets/css/site-home.css", "/assets/css/site-progress.css", "/assets/css/site-provenance.css"]],
      ["/puzzles/worlds/promise-realm/", "/assets/css/site-immersive.css", ["/assets/css/site-home.css", "/assets/css/site-progress.css", "/assets/css/site-provenance.css"]],
      ["/puzzles/worlds/first-realm/", "/assets/css/site-immersive.css", ["/assets/css/site-home.css", "/assets/css/site-progress.css", "/assets/css/site-provenance.css"]],
      ["/knowledge/ai-agents/", null, ["/assets/css/site-home.css", "/assets/css/site-progress.css", "/assets/css/site-provenance.css", "/assets/css/site-immersive.css"]],
    ];

    for (const [route, expected, forbidden] of cases) {
      requests.clear();
      await page.goto(baseURL + route, { waitUntil: "networkidle" });
      if (expected) assert.ok(requests.has(expected), route + " must load " + expected);
      for (const asset of forbidden) assert.equal(requests.has(asset), false, route + " must not load " + asset);
    }
    assert.deepEqual(failures, []);
  } finally {
    await browser.close();
  }
});
