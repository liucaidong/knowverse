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
    response.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control":"no-store" });
    response.end(await readFile(file));
  } catch { response.writeHead(500).end("Internal error"); }
});
await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
const baseURL = "http://127.0.0.1:" + server.address().port;
test.after(() => new Promise(resolveClose => server.close(resolveClose)));

for (const [name, engine] of [["Chromium desktop", chromium], ["WebKit mobile", webkit]]) {
  test(`${name}: account panel loads only when the cloud archive section is visited`, { timeout:60000 }, async () => {
    const browser = await engine.launch({ headless:true });
    try {
      const page = await browser.newPage({ viewport: name === "WebKit mobile" ? { width:390, height:844 } : { width:1440, height:960 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => { globalThis.KNOWVERSE_BACKEND_CONFIG = { supabaseUrl:"", publishableKey:"" }; });
      await page.goto(baseURL + "/progress/", { waitUntil:"domcontentloaded" });
      await page.waitForFunction(() => document.documentElement.dataset.learningProgressReady === "true");
      const initial = await page.evaluate(() => ({
        panelModuleLoaded: performance.getEntriesByType("resource").some(item => item.name.includes("/backend/account-panel.mjs")),
        panelText: document.querySelector("#backend-account-panel")?.textContent || "",
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }));
      assert.equal(initial.panelModuleLoaded, false, "cloud account UI must not be part of the initial progress-page payload");
      assert.equal(initial.panelText, "", "the offscreen cloud panel should remain uninitialized");
      assert.ok(initial.width <= initial.viewport, "progress page must not overflow horizontally");
      await page.locator("#cloud-account").scrollIntoViewIfNeeded();
      await page.waitForFunction(() => performance.getEntriesByType("resource").some(item => item.name.includes("/backend/account-panel.mjs")));
      await page.locator("#backend-account-panel .kv-backend-card").waitFor({ state:"visible" });
      assert.match(await page.locator("#backend-account-panel").textContent(), /云端学习档案/);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}

for (const [name, engine] of [["Chromium desktop", chromium], ["WebKit mobile", webkit]]) {
  test(`${name}: direct cloud archive hash navigation initializes the account panel`, { timeout:60000 }, async () => {
    const browser = await engine.launch({ headless:true });
    try {
      const page = await browser.newPage({ viewport: name === "WebKit mobile" ? { width:390, height:844 } : { width:1440, height:960 } });
      page.on("pageerror", error => { throw error; });
      await page.addInitScript(() => { globalThis.KNOWVERSE_BACKEND_CONFIG = { supabaseUrl:"", publishableKey:"" }; });
      await page.goto(baseURL + "/progress/#cloud-account", { waitUntil:"domcontentloaded" });
      await page.waitForFunction(() => document.documentElement.dataset.learningProgressReady === "true");
      await page.waitForFunction(() => document.querySelector("#backend-account-panel")?.textContent.includes("云端学习档案"));
      assert.match(await page.locator("#backend-account-panel").textContent(), /云端学习档案/);
    } finally { await browser.close(); }
  });
}
