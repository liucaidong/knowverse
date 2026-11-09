import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { waitForAsyncPageCondition } from "./helpers/wait-for-async-page-condition.mjs";

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
      const relative = pathname.startsWith("/") ? pathname.slice(1) : pathname;
      let file = resolve(root, relative || "index.html");
      if (file !== root && !file.startsWith(root + sep)) {
        return response.writeHead(403).end("Forbidden");
      }
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
  await new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveServer);
  });
  return { server, baseURL: "http://127.0.0.1:" + server.address().port };
}

const { server, baseURL } = await startServer();
test.after(() => new Promise(resolveServer => server.close(resolveServer)));

async function createReadingTask(page, competencyId) {
  return page.evaluate(async id => {
    const [{ getLearningRepository }, { mapPlanActionToTask }, learningMap] = await Promise.all([
      import("/assets/js/backend/learning-repository.mjs"),
      import("/assets/js/learning-agent/task-orchestrator.mjs"),
      fetch("/content/learning-map.json").then(response => response.json()),
    ]);
    const topic = learningMap.topics.find(item => item.id === "promise");
    const competency = topic.competencies.find(item => item.id === id);
    if (!competency) throw new Error("Missing Promise competency: " + id);
    const planId = "promise-course-e2e-" + crypto.randomUUID();
    const task = mapPlanActionToTask({
      type: "learn",
      actionId: "read:" + id,
      planDate: new Date().toISOString().slice(0, 10),
      href: competency.lessonHref,
      competencyId: competency.id,
      competencyTitle: competency.title,
      topicId: topic.id,
      topicTitle: topic.title,
      estimatedMinutes: 12,
      resourceType: "lesson",
      resourceTitle: competency.title,
      resourceLabel: "阅读课程",
    }, planId);
    const followup = mapPlanActionToTask({
      type: "practice",
      actionId: "challenge-after-read:" + id,
      planDate: new Date().toISOString().slice(0, 10),
      href: "./puzzles/worlds/promise-mechanism-quest/",
      competencyId: competency.id,
      competencyTitle: competency.title,
      topicId: topic.id,
      topicTitle: topic.title,
      estimatedMinutes: 15,
      resourceType: "challenge",
      resourceTitle: "Promise 综合挑战",
      resourceLabel: "进入挑战",
    }, planId, { dependsOnTaskIds: [task.taskId] });
    const repository = await getLearningRepository();
    await repository.commit({
      documents: [
        {
          type: "learning_task",
          key: task.taskId,
          payload: task,
          expectedLocalRevision: 0,
        },
        {
          type: "learning_task",
          key: followup.taskId,
          payload: followup,
          expectedLocalRevision: 0,
        },
      ],
    });
    return {
      taskId: task.taskId,
      followupTaskId: followup.taskId,
      url: new URL(task.href, location.origin + "/").href,
      competencyId: competency.id,
    };
  }, competencyId);
}

async function readTaskStatus(page, taskId, expectedStatus) {
  return waitForAsyncPageCondition(page, async expected => {
    const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
    const row = await (await getLearningRepository()).documents.get("learning_task", expected.taskId);
    return row?.payload?.status === expected.status ? expected.status : null;
  }, { arg: { taskId, status: expectedStatus }, timeout: 15000, label: "Promise reading task status: " + expectedStatus });
}

test("Chromium desktop: Promise reading task is learner-confirmed, restorable and never mastery evidence", {
  timeout: 60000,
}, async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.KNOWVERSE_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.KNOWVERSE_CHROMIUM_EXECUTABLE }
      : {}),
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseURL + "/", { waitUntil: "domcontentloaded" });

    const task = await createReadingTask(page, "thenable-adoption");
    await page.goto(task.url, { waitUntil: "domcontentloaded" });
    await page.locator("#kv-course-learning-task").waitFor({ state: "visible" });

    await page.getByRole("button", { name: "开始本节阅读" }).click();
    assert.equal(await readTaskStatus(page, task.taskId, "in_progress"), "in_progress");
    assert.equal(await page.locator(".kv-course-task-status").textContent(), "阅读进行中。读完本节后，请明确确认完成。");

    await page.getByRole("button", { name: "暂停阅读" }).click();
    assert.equal(await readTaskStatus(page, task.taskId, "paused"), "paused");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#kv-course-learning-task").waitFor({ state: "visible" });
    await page.getByText("本节阅读已暂停；可以从当前进度继续。", { exact: true }).waitFor({ state: "visible" });
    assert.equal((await page.locator(".kv-course-task-status").textContent()).includes("已暂停"), true);

    await page.getByRole("button", { name: "继续阅读" }).click();
    assert.equal(await readTaskStatus(page, task.taskId, "in_progress"), "in_progress");
    await page.getByRole("button", { name: "确认完成本节阅读" }).click();
    assert.equal(await readTaskStatus(page, task.taskId, "completed"), "completed");
    assert.equal(await readTaskStatus(page, task.followupTaskId, "ready"), "ready",
      "completing a reading task must unlock its dependent challenge task");

    const result = await page.evaluate(async taskId => {
      const [{ getLearningRepository }, map, challenges] = await Promise.all([
        import("/assets/js/backend/learning-repository.mjs"),
        fetch("/content/learning-map.json").then(response => response.json()),
        fetch("/content/challenges.json").then(response => response.json()),
      ]);
      const { deriveLearningInsights } = await import("/assets/js/learning-progress.mjs");
      const repository = await getLearningRepository();
      const [events, row] = await Promise.all([
        repository.events.list(),
        repository.documents.get("learning_task", taskId),
      ]);
      const snapshot = { events };
      const insights = deriveLearningInsights(map, challenges, snapshot);
      const node = insights.competencyInsights.find(item => item.id === "thenable-adoption");
      return {
        task: row?.payload,
        events: events.filter(event => event.taskId === taskId),
        pageViews: events.filter(event => event.type === "activity" &&
          event.action === "page_view" && event.workId === "course:promise"),
        masteryEvidenceCount: node?.evidenceCount ?? null,
      };
    }, task.taskId);

    assert.equal(result.task.status, "completed");
    assert.equal(result.task.evidenceEventIds.length, 0);
    assert.ok(result.events.some(event => event.type === "learning_task_in_progress"));
    assert.ok(result.events.some(event => event.type === "learning_task_paused"));
    assert.ok(result.events.some(event => event.type === "learning_task_completed"));
    assert.ok(result.pageViews.length >= 2, "course open and reload should record exploration activity");
    assert.equal(result.masteryEvidenceCount, 0, "reading and task completion must not create mastery evidence");
    assert.equal(result.events.some(event => ["attempt", "assessment_passed", "completed"].includes(event.type)), false);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("WebKit mobile: Promise reading task controls remain visible inside a narrow viewport", {
  timeout: 60000,
}, async () => {
  const browser = await webkit.launch({
    headless: true,
    ...(process.env.KNOWVERSE_WEBKIT_EXECUTABLE
      ? { executablePath: process.env.KNOWVERSE_WEBKIT_EXECUTABLE }
      : {}),
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseURL + "/", { waitUntil: "domcontentloaded" });
    const task = await createReadingTask(page, "microtask-scheduling");
    await page.goto(task.url, { waitUntil: "domcontentloaded" });
    await page.locator("#kv-course-learning-task").waitFor({ state: "visible" });
    const bounds = await page.locator("#kv-course-learning-task").evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    assert.ok(bounds.left >= -1);
    assert.ok(bounds.right <= 391);
    await page.getByRole("button", { name: "开始本节阅读" }).waitFor({ state: "visible" });
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("Chromium: Promise Review displays calibrated difficulty and its source lesson", {
  timeout: 60000,
}, async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.KNOWVERSE_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.KNOWVERSE_CHROMIUM_EXECUTABLE }
      : {}),
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseURL + "/review/?competencyId=thenable-adoption", { waitUntil: "domcontentloaded" });
    await page.locator("#question-difficulty").waitFor({ state: "visible" });
    assert.equal(await page.locator("#question-difficulty").textContent(), "难度 · 基础");
    assert.equal(await page.locator("#question-source").textContent(), "课程来源 · 第 03 单元 ↗");
    assert.match(await page.locator("#question-source a").getAttribute("href"), /knowledge\/promise\/lesson-03\/$/);
    assert.equal(await page.locator("#question-title").textContent(), "Get 与 Call：同步边界");
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});
