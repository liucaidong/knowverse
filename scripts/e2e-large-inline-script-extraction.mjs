import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, webkit } from "playwright";

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

const pages = [
  { path:"/puzzles/worlds/promise-realm/", script:"promise-realm.js", verify:async page => {
    await page.waitForFunction(() => typeof window.__realmTest?.state === "function");
    const before = await page.evaluate(() => window.__realmTest.state());
    assert.equal(before.stage, 0);
    const after = await page.evaluate(() => window.__realmTest.start());
    assert.equal(after.stage, 0);
    assert.ok(after.items && typeof after.items === "object");
  } },
  { path:"/lab/experiments/promise-identity/", script:"promise-identity-lab.js", verify:async page => {
    await page.locator("#verify-btn").click();
    await page.waitForFunction(() => document.querySelector("#verify-msg")?.textContent.includes("验证一致"));
  } },
  { path:"/lab/experiments/microtask-resolution/", script:"microtask-resolution-lab.js", verify:async page => {
    await page.locator("#verify").click();
    await page.waitForFunction(() => document.querySelector("#validation")?.textContent.includes("完全一致"));
  } },
];

for (const [engineName, engine] of [["Chromium", chromium], ["WebKit", webkit]]) {
  test(`${engineName}: extracted interactive scripts load externally and preserve behavior`, { timeout:90000 }, async () => {
    const browser = await engine.launch({ headless:true });
    try {
      for (const entry of pages) {
        const context = await browser.newContext({ viewport:{ width:1280, height:900 }, serviceWorkers:"block" });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(baseURL + entry.path, { waitUntil:"domcontentloaded" });
        await page.waitForFunction(script => performance.getEntriesByType("resource").some(item => item.name.endsWith("/" + script)), entry.script);
        const markup = await page.evaluate(() => ({
          inlineScriptBytes:[...document.scripts].filter(script => !script.src).reduce((sum, script) => sum + new TextEncoder().encode(script.textContent).length, 0),
          overflow: document.documentElement.scrollWidth > innerWidth,
        }));
        assert.equal(markup.inlineScriptBytes, 0, entry.path + " should not carry the extracted inline application script");
        assert.equal(markup.overflow, false, entry.path + " must not overflow horizontally");
        await entry.verify(page);
        assert.deepEqual(errors, [], entry.path + " page errors");
        await context.close();
      }
    } finally { await browser.close(); }
  });
}
