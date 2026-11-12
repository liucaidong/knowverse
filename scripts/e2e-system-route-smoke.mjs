import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const routes = JSON.parse(await readFile(resolve(root, "content/routes.json"), "utf8"));
const routeRows = routes.routes || [];
const canonicalTargets = [...new Set(routeRows.map(route => {
  const url = new URL(route.path, "http://localhost/");
  return url.pathname + url.search + url.hash;
}))].sort();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const relative = pathname.replace(/^\/+/, "");
      let file = resolve(root, relative || "index.html");
      if (file !== root && !file.startsWith(root + sep)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      try {
        if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
      } catch {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, {
        "content-type": mime[extname(file)] || "application/octet-stream",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(await readFile(file));
    } catch {
      response.writeHead(500).end("Internal error");
    }
  });
  await new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveServer);
  });
  return { server, baseURL: "http://127.0.0.1:" + server.address().port };
}

const { server, baseURL } = await startServer();
test.after(() => new Promise(resolveServer => server.close(resolveServer)));

test("all canonical routes load in Chromium without uncaught errors or failed local resources", {
  timeout: 180_000,
}, async () => {
  assert.equal(routeRows.length, 47, "the route smoke must track every registered canonical route");
  assert.equal(canonicalTargets.length, 47, "hash destinations are distinct canonical routes even on the same page");
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
    });
    await context.addInitScript(() => {
      globalThis.KNOWVERSE_BACKEND_CONFIG = { supabaseUrl: "", publishableKey: "" };
    });
    const page = await context.newPage();
    let currentPath = "";
    const errors = [];
    page.on("pageerror", error => errors.push({
      path: currentPath, type: "pageerror", message: error.message,
    }));
    page.on("console", message => {
      if (message.type() === "error" && !message.text().includes("favicon.ico")) {
        errors.push({ path: currentPath, type: "console", message: message.text() });
      }
    });
    page.on("requestfailed", request => {
      if (new URL(request.url()).origin === new URL(baseURL).origin) {
        errors.push({
          path: currentPath, type: "requestfailed",
          message: request.method() + " " + request.url() + " :: " +
            (request.failure()?.errorText || "unknown"),
        });
      }
    });

    for (const target of canonicalTargets) {
      currentPath = target;
      const targetUrl = new URL(target, baseURL);
      const currentUrl = page.url() ? new URL(page.url()) : null;
      let response = null;
      if (currentUrl && currentUrl.origin === targetUrl.origin &&
          currentUrl.pathname === targetUrl.pathname && currentUrl.search === targetUrl.search) {
        await page.evaluate(hash => { location.hash = hash; }, targetUrl.hash);
      } else {
        response = await page.goto(targetUrl.href, { waitUntil: "domcontentloaded" });
        assert.ok(response, target + ": navigation must return an HTTP response");
        assert.ok(response.status() < 400, target + ": returned HTTP " + response.status());
      }
      await page.waitForTimeout(100);
      const state = await page.evaluate(() => ({
        title: document.title,
        bodyTextLength: (document.body?.innerText || "").trim().length,
        hasMain: Boolean(document.querySelector("main")),
        hasHeading: Boolean(document.querySelector("h1")),
        loadingError: [
          ...document.querySelectorAll("[role=alert], .error, .rw-empty, .la-empty-small")
        ].some(node => /载入失败|加载失败|暂时不可用|无法读取/.test(node.textContent || "")),
      }));
      assert.ok(state.bodyTextLength > 0, target + ": page body must not be blank");
      assert.equal(state.loadingError, false, target + ": page must not render a load-failure state");
      const hash = new URL(target, baseURL).hash.slice(1);
      if (hash) {
        assert.ok(await page.locator("#" + hash).count(), target + ": canonical hash target must exist");
      }
      results.push({ target, status: response?.status() || 200, ...state });
    }

    assert.deepEqual(errors, [], "canonical route runtime errors:\n" +
      errors.map(item => JSON.stringify(item)).join("\n"));
    assert.equal(results.length, 47);
    await context.close();
  } finally {
    await browser.close();
  }
});
