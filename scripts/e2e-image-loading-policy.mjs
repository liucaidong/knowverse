import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, webkit } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".svg":"image/svg+xml", ".png":"image/png" };
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
  "/knowledge/database/", "/knowledge/model-infra/", "/knowledge/ai-education/",
  "/knowledge/engineering/", "/knowledge/creative/", "/knowledge/language/",
  "/knowledge/math/", "/knowledge/ai-agents/", "/knowledge/finance/",
  "/knowledge/monorepo/", "/knowledge/monorepo/fullstack/",
  ...Array.from({ length:10 }, (_, index) => `/knowledge/monorepo/unit-${String(index + 1).padStart(2, "0")}/`),
  "/knowledge/monorepo/fullstack/guides/simulator-smoke/",
  "/knowledge/monorepo/fullstack/guides/fault-injection/",
  "/knowledge/promise/", "/knowledge/react-native/",
];

for (const [name, engine, viewport] of [
  ["Chromium desktop", chromium, { width:1440, height:960 }],
  ["WebKit mobile", webkit, { width:390, height:844 }],
]) {
  test(`${name}: knowledge panoramas and engineering evidence images load lazily with useful alt text`, { timeout:90000 }, async () => {
    const browser = await engine.launch({ headless:true });
    try {
      for (const route of routes) {
        const context = await browser.newContext({ viewport, serviceWorkers:"block" });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(baseURL + route, { waitUntil:"domcontentloaded" });
        const images = page.locator("img");
        const count = await images.count();
        assert.ok(count > 0, route + " should expose its expected visual content");
        for (let index = 0; index < count; index++) {
          const image = images.nth(index);
          const attributes = await image.evaluate(element => ({
            loading:element.getAttribute("loading"),
            decoding:element.getAttribute("decoding"),
            alt:element.getAttribute("alt"),
            width:element.getAttribute("width"),
            height:element.getAttribute("height"),
          }));
          assert.equal(attributes.loading, "lazy", route + " image " + index + " should be lazy-loaded");
          assert.equal(attributes.decoding, "async", route + " image " + index + " should decode asynchronously");
          assert.ok(Number(attributes.width) > 0 && Number(attributes.height) > 0, route + " image " + index + " must reserve its intrinsic aspect ratio before download");
          assert.ok(attributes.alt?.trim(), route + " image " + index + " needs descriptive alternative text");
          assert.doesNotMatch(attributes.alt, /join\(|esc\(|\+['"]\s*,/, route + " image alt must not expose template source");
          await image.scrollIntoViewIfNeeded();
          await page.waitForFunction(element => element.complete && element.naturalWidth > 0, await image.elementHandle());
        }
        const dimensions = await page.evaluate(() => ({ width:document.documentElement.scrollWidth, viewport:innerWidth }));
        assert.ok(dimensions.width <= dimensions.viewport + 1, route + " horizontal overflow: " + JSON.stringify(dimensions));
        assert.deepEqual(errors, [], route + " page errors");
        await context.close();
      }
    } finally { await browser.close(); }
  });
}
