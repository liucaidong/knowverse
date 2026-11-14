import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, webkit } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".wasm": "application/wasm",
};
async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      let file = resolve(root, pathname.replace(/^\/+/, "") || "index.html");
      if (file !== root && !file.startsWith(root + sep)) return response.writeHead(403).end("Forbidden");
      try { if ((await stat(file)).isDirectory()) file = resolve(file, "index.html"); }
      catch { return response.writeHead(404).end("Not found"); }
      response.writeHead(200, {
        "content-type": mime[extname(file)] || "application/octet-stream",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(await readFile(file));
    } catch { response.writeHead(500).end("Internal error"); }
  });
  await new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveServer);
  });
  return { server, baseURL: "http://127.0.0.1:" + server.address().port };
}
const { server, baseURL } = await startServer();
test.after(() => new Promise(resolveServer => server.close(resolveServer)));

async function openProgress(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !message.text().includes("favicon.ico")) errors.push(message.text());
  });
  await page.goto(baseURL + "/progress/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.documentElement.dataset.learningProgressReady === "true" ||
    document.documentElement.dataset.learningProgressError
  );
  assert.equal(await page.locator("#weekly-learning-review-content").count(), 1);
  return { context, page, errors };
}

function createEvent(id, type, fields = {}) {
  return {
    id,
    eventSchemaVersion: 3,
    type,
    at: new Date().toISOString(),
    topicId: "promise",
    challengeId: "promise-mechanism-quest",
    challengeTitle: "Promise 机制挑战",
    stepId: "thenable-adoption",
    stepTitle: "thenable 解析与采用",
    competencyIds: ["thenable-adoption"],
    sessionId: "weekly-e2e-session",
    sessionType: "campaign",
    variantId: "promise-variant-a",
    ...fields,
  };
}

test("Chromium desktop: empty seven-day review shows a truthful no-evidence state", {
  timeout: 60_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page, errors } = await openProgress(browser, { width: 1440, height: 960 });
    const copy = await page.locator("#weekly-learning-review-content").innerText();
    assert.match(copy, /过去 7 天还没有可归纳的学习事件/);
    assert.match(copy, /不会用浏览、阅读时长或 AI 对话填充成绩/);
    assert.equal(await page.locator(".lp-weekly-day").count(), 7);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("Chromium desktop: weekly review reflects real evidence types and settled task time", {
  timeout: 60_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page, errors } = await openProgress(browser, { width: 1440, height: 960 });
    const inserted = await page.evaluate(async () => {
      const { createLearningProgressStore } = await import("/assets/js/learning-progress.mjs");
      const store = createLearningProgressStore();
      const now = new Date().toISOString();
      const base = {
        at: now,
        eventSchemaVersion: 3,
        topicId: "promise",
        challengeId: "promise-mechanism-quest",
        challengeTitle: "Promise 机制挑战",
        stepId: "thenable-adoption",
        stepTitle: "thenable 解析与采用",
        competencyIds: ["thenable-adoption"],
        variantId: "promise-variant-a",
      };
      const events = [
        { ...base, id: "weekly-wrong", type: "attempt", correct: false,
          gapId: "thenable-get-vs-call", gapObservationId: "weekly-gap-1",
          sessionId: "campaign-e2e", sessionType: "campaign", hintsUsed: 0 },
        { ...base, id: "weekly-independent", type: "assessment_passed",
          independent: true, hintsUsed: 0, variantId: "promise-variant-b",
          sessionId: "assessment-e2e", sessionType: "campaign" },
        { ...base, id: "weekly-assisted", type: "completed",
          independent: false, hintsUsed: 1,
          sessionId: "assisted-e2e", sessionType: "campaign" },
        { ...base, id: "weekly-hint", type: "hint", hintNumber: 1,
          sessionId: "assisted-e2e", sessionType: "campaign" },
        { ...base, id: "weekly-review-start", type: "review_started",
          sessionId: "review-e2e", sessionType: "review" },
        { ...base, id: "weekly-task-start", type: "learning_task_in_progress",
          taskId: "task-weekly-e2e", estimatedMinutes: 90,
          sessionId: "plan-weekly-e2e", sessionType: "orchestration" },
        { ...base, id: "weekly-task-pause", type: "learning_task_paused",
          taskId: "task-weekly-e2e", durationSeconds: 120,
          sessionId: "plan-weekly-e2e", sessionType: "orchestration" },
        { ...base, id: "weekly-task-complete", type: "learning_task_completed",
          taskId: "task-weekly-e2e", durationSeconds: 600,
          sessionId: "plan-weekly-e2e", sessionType: "orchestration" },
        { ...base, id: "weekly-browse-only", type: "activity",
          activity: "page_view", sessionId: "browse-e2e", sessionType: "exploration" },
      ];
      await store.appendMany(events);
      return events.length;
    });
    assert.equal(inserted, 9);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() =>
      document.documentElement.dataset.learningProgressReady === "true"
    );
    await page.waitForFunction(() =>
      document.querySelector("#weekly-learning-review-content")?.innerText.includes("1 / 7")
    );
    const recap = await page.locator("#weekly-learning-review-content").innerText();
    assert.match(recap, /1 \/ 7/);
    assert.match(recap, /独立无提示通过\s+1/);
    assert.match(recap, /提示辅助通过\s+1/);
    assert.match(recap, /实际任务耗时\s+12 分钟/);
    assert.match(recap, /当前待修复误区\s+1/);
    assert.match(recap, /作答\s+1 次 · 错误 1 次/);
    assert.match(recap, /复习\s+1 个复习会话/);
    assert.match(recap, /提示\s+1 次/);
    assert.match(recap, /thenable 解析与 Promise 采用/);
    assert.equal(await page.locator(".lp-weekly-day").count(), 7);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("WebKit mobile: weekly recap cards and seven-day activity strip fit the viewport", {
  timeout: 60_000,
}, async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const { context, page, errors } = await openProgress(browser, { width: 390, height: 844 });
    const section = page.locator("#weekly-learning-review");
    await section.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await page.waitForFunction(() =>
      document.querySelectorAll(".lp-weekly-kpi").length === 5 &&
      document.querySelectorAll(".lp-weekly-day").length === 7
    );
    const box = await section.boundingBox();
    assert.ok(box && box.width <= 390);
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(pageWidth <= 390, "weekly review must not introduce horizontal overflow");
    assert.equal(await page.locator(".lp-weekly-kpi").count(), 5);
    assert.equal(await page.locator(".lp-weekly-day").count(), 7);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});
