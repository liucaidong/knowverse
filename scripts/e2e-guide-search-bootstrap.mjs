import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".svg":"image/svg+xml" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let file = resolve(root, pathname.slice(1) || "index.html");
    if (file !== root && !file.startsWith(root + sep)) return response.writeHead(403).end("Forbidden");
    try { if ((await stat(file)).isDirectory()) file = resolve(file, "index.html"); }
    catch { return response.writeHead(404).end("Not found"); }
    response.writeHead(200, { "content-type":mime[extname(file)] || "application/octet-stream", "cache-control":"no-store" });
    response.end(await readFile(file));
  } catch { response.writeHead(500).end("Internal error"); }
});
await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
const baseURL = "http://127.0.0.1:" + server.address().port;
test.after(() => new Promise(resolveClose => server.close(resolveClose)));

const routes = [
  "/knowledge/monorepo/guides/cross-platform/",
  "/knowledge/monorepo/guides/ghost-deps/",
  "/knowledge/monorepo/guides/nx24-affected/",
  "/knowledge/monorepo/guides/rush-rollout/",
];

test("Monorepo guide search initializes after its overlay markup exists", { timeout:60000 }, async () => {
  const browser = await chromium.launch({ headless:true });
  try {
    for (const route of routes) {
      const page = await browser.newPage({ viewport:{ width:1280, height:900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(baseURL + route, { waitUntil:"networkidle" });
      assert.equal(await page.locator("#search-overlay").count(), 1, route + " overlay markup");
      await page.locator("#search-open").click();
      assert.equal(await page.locator("#search-overlay").evaluate(element => element.classList.contains("open")), true, route + " search overlay should open");
      await page.locator("#search-input").fill("Promise");
      await page.waitForFunction(() => document.querySelectorAll("#search-results a.hit").length > 0, null, { timeout:10000 });
      assert.deepEqual(errors, [], route + " page errors");
      await page.close();
    }
  } finally { await browser.close(); }
});
