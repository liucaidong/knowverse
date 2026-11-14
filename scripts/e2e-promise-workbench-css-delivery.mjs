import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, webkit } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8", ".b64":"text/plain; charset=utf-8", ".json":"application/json; charset=utf-8", ".svg":"image/svg+xml" };
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

for (const [name, engine, viewport] of [
  ["Chromium desktop", chromium, { width:1440, height:960 }],
  ["WebKit mobile", webkit, { width:390, height:844 }],
]) {
  test(`${name}: Promise debugger skips the obsolete blocking stylesheet and renders the bundled workbench`, { timeout:90000 }, async () => {
    const browser = await engine.launch({ headless:true });
    try {
      const page = await browser.newPage({ viewport, serviceWorkers:"block" });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(baseURL + "/lab/experiments/promise-debugger/", { waitUntil:"domcontentloaded" });
      await page.waitForFunction(() => document.querySelectorAll("#scenario-list button").length >= 10);
      const metrics = await page.evaluate(() => {
        const resources = performance.getEntriesByType("resource");
        const styleSheets = [...document.styleSheets].map(sheet => ({ href:sheet.href, rules:(()=>{try{return sheet.cssRules.length}catch{return -1}})() }));
        const layout = document.querySelector("#workbench-layout").getBoundingClientRect();
        return {
          legacyCssRequested:resources.some(item => item.name.includes("debugger.css")),
          workspaceCssRequested:resources.some(item => item.name.includes("workspace-layout.css")),
          injectedBundleStyles:[...document.querySelectorAll("style")].some(style => style.textContent.includes("--bg:#080d16")),
          scenarioCount:document.querySelectorAll("#scenario-list button").length,
          layoutWidth:layout.width,
          viewportWidth:innerWidth,
          styleSheets,
        };
      });
      assert.equal(metrics.legacyCssRequested, false, "obsolete 10 KB stylesheet must not block the initial render");
      assert.equal(metrics.workspaceCssRequested, true);
      assert.equal(metrics.injectedBundleStyles, true, "runtime bundle CSS must provide the base workbench theme");
      assert.ok(metrics.scenarioCount >= 10);
      assert.ok(metrics.layoutWidth > 0 && metrics.layoutWidth <= metrics.viewportWidth + 1, JSON.stringify(metrics));
      assert.equal(await page.locator("#run-code").isEnabled(), true);
      if (name === "Chromium desktop") {
        await page.locator("#run-code").click();
        await page.waitForFunction(() => document.querySelector("#frame-counter")?.textContent !== "等待运行");
      }
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
