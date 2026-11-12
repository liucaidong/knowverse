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
  page.on("requestfailed", request => {
    pageErrors.push("REQUEST_FAILED " + request.method() + " " + request.url() +
      " :: " + (request.failure()?.errorText || "unknown"));
  });
  await page.addInitScript(event => {
    const marker = "knowverse:e2e-learning-seeded";
    if (localStorage.getItem(marker)) return;
    const rootKey = "knowverse:learning-state";
    const envelope = JSON.parse(localStorage.getItem(rootKey) || JSON.stringify({
      format: "knowverse-learning-state",
      schemaVersion: 1,
      revision: 0,
      records: {},
    }));
    envelope.revision += 1;
    envelope.records["knowverse:learning-progress"] = JSON.stringify({
      schemaVersion: 1,
      createdAt: event.at,
      updatedAt: event.at,
      events: [event],
      remoteEventIds: [],
    });
    localStorage.setItem(rootKey, JSON.stringify(envelope));
    localStorage.setItem(marker, "1");
  }, seedGap);

  await page.goto(baseURL + "/progress/", { waitUntil: "domcontentloaded" });
  await page.locator("#hero-tested").waitFor();
  // Advanced review scheduling is intentionally collapsed on first entry.
  await page.locator("#proactive-learning > summary").click();
  assert.equal(await page.locator("#proactive-learning").evaluate(element => element.open), true,
    label + ": the advanced analytics disclosure must open when explicitly selected");
  await page.locator("#proactive-kpis .lp-proactive-kpi").first().waitFor({ state: "visible" });
  const scheduledReview = page.locator("#proactive-review-queue a").first();
  await scheduledReview.waitFor({ state: "visible" });
  const reviewURL = await scheduledReview.getAttribute("href");
  assert.ok(reviewURL, label + ": due review must have an executable task link");
  const scheduledURL = new URL(reviewURL, baseURL);
  assert.ok(scheduledURL.searchParams.get("taskId"), label + ": due review link must carry a task id");
  assert.equal(scheduledURL.searchParams.get("gapId"), "thenable-get-vs-call");
  await scheduledReview.click();
  await page.locator("#question-title").waitFor({ state: "visible" });
  assert.match(await page.locator("#question-title").innerText(), /Get 与 Call：同步边界/);

  await page.locator('[data-option-id="a"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#answer-feedback")?.innerText.includes("这次判断还不正确。")
  );
  assert.equal(await page.locator("#next-variant").isVisible(), true);

  await page.locator("#next-variant").click();
  await page.waitForFunction(() =>
    document.querySelector("#question-title")?.innerText.includes("Get 与 Call：输出顺序验证")
  );
  await page.locator('[data-option-id="b"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#answer-feedback")?.innerText.includes("独立验证通过")
  );
  assert.match(await page.locator("#answer-feedback").innerText(), /精确纠正/);
  const completedTask = await page.evaluate(async taskId => {
    const { createLearningTaskOrchestrator } = await import("/assets/js/learning-agent/task-orchestrator.mjs");
    const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
    const repository = await getLearningRepository();
    const task = await createLearningTaskOrchestrator({ repository }).get(taskId);
    return {
      status: task?.status,
      evidenceEventIds: task?.evidenceEventIds || [],
      completedEventExists: (await repository.events.list()).some(event =>
        event.type === "learning_task_completed" && event.taskId === taskId),
    };
  }, scheduledURL.searchParams.get("taskId"));
  assert.equal(completedTask.status, "completed", label + ": completed review must close the scheduled task");
  assert.ok(completedTask.evidenceEventIds.length > 0, label + ": completion must retain assessment evidence");
  assert.equal(completedTask.completedEventExists, true, label + ": task completion must append an audit event");

  await page.waitForFunction(() => document.querySelectorAll(".rw-history-row").length === 2);
  const historyCount = await page.locator(".rw-history-row").count();
  assert.equal(historyCount, 2, label + ": review sessions should persist independently");
  await page.goto(baseURL + "/review/", { waitUntil: "domcontentloaded" });
  // Wait for the module's three registry fetches and the actual picker render
  // before reloading. WebKit can otherwise abort in-flight same-origin fetches
  // when navigation starts immediately after DOMContentLoaded.
  await page.locator("#target-list .rw-target").first().waitFor({ state: "visible" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#target-list .rw-target").first().waitFor({ state: "visible" });
  await page.goto(baseURL + "/progress/", { waitUntil: "domcontentloaded" });
  await page.locator("#hero-tested").waitFor();
  await page.locator("#gap-list").waitFor();
  // Every page load starts with advanced analysis collapsed; open it only for this audit assertion.
  await page.locator("#proactive-learning > summary").click();
  assert.equal(await page.locator("#proactive-learning").evaluate(element => element.open), true,
    label + ": advanced analysis must open on explicit user action after navigation");
  await page.locator("#proactive-kpis .lp-proactive-kpi").first().waitFor({ state: "visible" });
  await page.locator("#proactive-actions").waitFor({ state: "visible" });
  await page.locator("#proactive-timeline").waitFor({ state: "visible" });
  await page.waitForFunction(() =>
    document.querySelectorAll("#proactive-timeline .lp-timeline-row").length > 0
  );
  await page.waitForFunction(() =>
    document.querySelector("#gap-list")?.innerText.includes("没有尚未纠正的概念误区") &&
    document.querySelector("#hero-tested")?.innerText.replaceAll(" ", "").includes("1/18")
  );
  assert.match(await page.locator("#gap-list").innerText(), /没有尚未纠正的概念误区/);
  assert.match(await page.locator("#hero-tested").innerText(), /1\s*\/\s*18/);
  assert.deepEqual(pageErrors, [], label + ": uncaught browser exceptions or failed requests");
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
