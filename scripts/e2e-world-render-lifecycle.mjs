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

async function startServer() {
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
  return { server, baseURL: "http://127.0.0.1:" + server.address().port };
}

const { server, baseURL } = await startServer();
test.after(() => new Promise(resolveClose => server.close(resolveClose)));

async function assertRenderLifecycle(browser, route, targetSelector, { pauseOffscreen = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    window.__rafScheduled = 0;
    window.__rafExecuted = 0;
    window.requestAnimationFrame = callback => {
      window.__rafScheduled += 1;
      return original(timestamp => {
        window.__rafExecuted += 1;
        callback(timestamp);
      });
    };
  });

  try {
    await page.goto(baseURL + route, { waitUntil: "domcontentloaded" });
    await page.locator(targetSelector).waitFor({ state: "visible" });
    await page.waitForFunction(() => window.__rafExecuted >= 3, null, { timeout: 15000 });

    if (pauseOffscreen) {
      await page.locator(targetSelector).evaluate(element => {
        element.style.transform = "translateY(12000px)";
      });
      await page.waitForTimeout(250);
      const offscreenCount = await page.evaluate(() => window.__rafExecuted);
      await page.waitForTimeout(350);
      const stoppedCount = await page.evaluate(() => window.__rafExecuted);
      assert.ok(stoppedCount <= offscreenCount + 1,
        route + " should stop scheduling animation frames while outside the viewport");

      await page.locator(targetSelector).evaluate(element => {
        element.style.transform = "";
      });
      await page.waitForFunction(previous => window.__rafExecuted > previous + 2, offscreenCount, { timeout: 5000 });
    }

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(150);
    const hiddenCount = await page.evaluate(() => window.__rafExecuted);
    await page.waitForTimeout(350);
    const hiddenStoppedCount = await page.evaluate(() => window.__rafExecuted);
    assert.ok(hiddenStoppedCount <= hiddenCount + 1,
      route + " should stop scheduling animation frames when the document is hidden");

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForFunction(previous => window.__rafExecuted > previous + 2, hiddenStoppedCount, { timeout: 5000 });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

test("Monorepo WebGL scene pauses offscreen and while the document is hidden", { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await assertRenderLifecycle(browser, "/gallery/exhibits/monorepo-architecture/", "[data-world-container]");
  } finally {
    await browser.close();
  }
});

test("Promise challenge scene pauses offscreen and while the document is hidden", { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await assertRenderLifecycle(browser, "/puzzles/worlds/promise-mechanism-quest/", "#promise-world");
  } finally {
    await browser.close();
  }
});

test("Promise Realm immersive scene pauses while the document is hidden", { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await assertRenderLifecycle(browser, "/puzzles/worlds/promise-realm/", "#view", { pauseOffscreen: false });
  } finally {
    await browser.close();
  }
});

test("Promise Cosmos immersive scene pauses while the document is hidden", { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await assertRenderLifecycle(browser, "/gallery/exhibits/promise-cosmos/", "#gl", { pauseOffscreen: false });
  } finally {
    await browser.close();
  }
});
