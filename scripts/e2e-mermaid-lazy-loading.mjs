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

test("Mermaid CDN is not loaded until a diagram approaches the viewport", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    let mermaidRequests = 0;
    await page.route("https://cdn.jsdelivr.net/npm/mermaid@12/dist/mermaid.esm.min.mjs", async route => {
      mermaidRequests += 1;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/javascript", "access-control-allow-origin": "*" },
        body: "const api={initialize(){window.__mermaidStubInitialized=true},run({nodes}){window.__mermaidStubRendered=(window.__mermaidStubRendered||0)+nodes.length;return Promise.resolve()}};export default api;",
      });
    });
    await page.route("**/knowledge/promise/lesson-00/", async route => {
      const response = await route.fetch();
      const html = await response.text();
      await route.fulfill({
        response,
        body: html.replace("</head>", "<style>.mermaid{margin-top:3000px!important}</style></head>"),
      });
    });

    await page.goto(baseURL + "/knowledge/promise/lesson-00/", { waitUntil: "domcontentloaded" });
    const diagram = page.locator(".mermaid").first();
    await diagram.waitFor({ state: "attached" });
    await page.waitForTimeout(350);
    assert.equal(mermaidRequests, 0, "below-fold diagrams must not download Mermaid during initial page load");

    await diagram.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => window.__mermaidStubRendered > 0, null, { timeout: 8000 });
    assert.equal(mermaidRequests, 1, "approaching the diagram should load Mermaid once");
    assert.equal(await page.evaluate(() => window.__mermaidStubInitialized), true);
  } finally {
    await browser.close();
  }
});
