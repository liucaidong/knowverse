import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, webkit } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
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
      const body = await readFile(file);
      response.writeHead(200, {
        "content-type": mime[extname(file)] || "application/octet-stream",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(body);
    } catch {
      response.writeHead(500).end("Internal error");
    }
  });
  await new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveServer);
  });
  const address = server.address();
  return { server, baseURL: "http://127.0.0.1:" + address.port };
}

const { server, baseURL } = await startServer();
test.after(() => new Promise(resolveServer => server.close(resolveServer)));

const seedGap = {
  id: "campaign:attempt:thenable:1",
  eventSchemaVersion: 2,
  type: "attempt",
  at: "2026-11-01T08:00:00.000Z",
  topicId: "promise",
  challengeId: "promise-mechanism-quest",
  challengeTitle: "Promise 机制挑战",
  stepId: "thenable-adoption",
  stepTitle: "thenable 解析",
  competencyIds: ["thenable-adoption"],
  sessionId: "e2e-campaign-run",
  sessionType: "campaign",
  variantId: "promise-mechanism-quest:thenable-adoption",
  attemptNumber: 1,
  correct: false,
  selectedOptionId: "wrong",
  gapId: "thenable-get-vs-call",
  hintsUsed: 0,
};

async function exerciseReview(browser, label, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.addInitScript(event => {
    const marker = "knowverse:e2e-learning-seeded";
    if (localStorage.getItem(marker)) return;
    localStorage.setItem("knowverse:learning-progress:v2", JSON.stringify({
      schemaVersion: 2,
      createdAt: event.at,
      updatedAt: event.at,
      events: [event],
    }));
    localStorage.setItem(marker, "1");
  }, seedGap);

  const reviewURL = baseURL + "/review/?competencyId=thenable-adoption&gapId=thenable-get-vs-call";
  await page.goto(reviewURL, { waitUntil: "domcontentloaded" });
  await page.locator("#question-title").waitFor({ state: "visible" });
  assert.match(await page.locator("#question-title").innerText(), /Get 与 Call：同步边界/);

  await page.locator('[data-option-id="a"]').click();
  await page.locator("#answer-feedback").waitFor();
  assert.match(await page.locator("#answer-feedback").innerText(), /还不正确/);
  assert.equal(await page.locator("#next-variant").isVisible(), true);

  await page.locator("#next-variant").click();
  await page.locator("#question-title").waitFor();
  assert.match(await page.locator("#question-title").innerText(), /Get 与 Call：输出顺序验证/);
  await page.locator('[data-option-id="b"]').click();
  assert.match(await page.locator("#answer-feedback").innerText(), /精确纠正/);

  const historyCount = await page.locator(".rw-history-row").count();
  assert.equal(historyCount, 2, label + ": review sessions should persist independently");
  await page.goto(baseURL + "/review/", { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#target-list .rw-target").first().waitFor();
  await page.goto(baseURL + "/progress/", { waitUntil: "domcontentloaded" });
  await page.locator("#hero-tested").waitFor();
  await page.locator("#gap-list").waitFor();
  assert.match(await page.locator("#gap-list").innerText(), /没有尚未纠正的概念误区/);
  assert.match(await page.locator("#hero-tested").innerText(), /1\s*\/\s*9/);
  assert.deepEqual(pageErrors, [], label + ": uncaught browser exceptions");
  await context.close();
}

test("Chromium desktop: targeted gap -> independent variant -> resolved", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await exerciseReview(browser, "Chromium desktop", { width: 1440, height: 960 });
  } finally {
    await browser.close();
  }
});

test("WebKit mobile viewport: targeted review persists across navigation and reload", { timeout: 60000 }, async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    await exerciseReview(browser, "WebKit mobile viewport", { width: 390, height: 844 });
  } finally {
    await browser.close();
  }
});
