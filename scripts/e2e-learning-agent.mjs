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

async function openWorkspace(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !message.text().includes("favicon.ico")) errors.push(message.text());
  });
  await page.goto(baseURL + "/agent/", { waitUntil: "domcontentloaded" });
  await page.locator("#la-workspace").waitFor({ state: "visible" });
  await page.locator("#la-metrics .la-metric").first().waitFor({ state: "visible" });
  return { context, page, errors };
}

async function createGoalAndPlan(page) {
  await page.locator("#la-goal-title").fill("E2E · 精通 ES Promise");
  await page.locator("#la-goal-description").fill("验证知识图谱、真实学习证据与动态计划闭环。");
  await page.locator("#la-goal-topics").selectOption("promise");
  await page.locator("#la-goal-minutes").selectOption("15");
  await page.locator("#la-goal-priority").selectOption("5");
  await page.locator("#la-create-goal button[type=submit]").click();
  await page.locator("#la-goals-list .la-goal-card").first().waitFor({ state: "visible" });
  await page.locator("#la-daily-minutes").selectOption("15");
  await page.locator("#la-weekly-days").selectOption("5");
  await page.locator("#la-pref-topics").selectOption("promise");
  await page.locator("#la-save-preferences").click();
  await page.locator("#la-regenerate-plan").click();
  await page.locator("#la-plan-proposal .la-proposal-card").waitFor({ state: "visible" });
  const proposal = await page.locator("#la-plan-proposal .la-proposal-card").innerText();
  assert.match(proposal, /15 分钟/);
  assert.match(proposal, /Promise/);
  await page.locator("#la-plan-proposal").getByRole("button", { name: "接受计划并创建任务" }).click();
  await page.locator("#la-active-tasks .la-task-card").first().waitFor({ state: "visible" });
}

test("Chromium desktop: goal -> adaptive plan -> task pause/restore -> offline completion -> rule-mode agent", {
  timeout: 90_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page, errors } = await openWorkspace(browser, { width: 1440, height: 1100 });
    await createGoalAndPlan(page);

    const task = page.locator("#la-active-tasks .la-task-card").first();
    await task.getByRole("button", { name: "开始任务" }).click();
    await task.getByRole("button", { name: "暂停" }).click();
    await page.waitForFunction(() =>
      document.querySelector("#la-active-tasks .la-task-card .la-state")?.textContent === "已暂停"
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#la-workspace").waitFor({ state: "visible" });
    const restored = page.locator("#la-active-tasks .la-task-card").first();
    assert.match(await restored.innerText(), /已暂停/);
    await context.setOffline(true);
    await restored.getByRole("button", { name: "继续执行" }).click();
    await page.locator("#la-active-tasks .la-task-card").first()
      .getByRole("button", { name: "完成阅读任务" }).click();
    await page.waitForFunction(() =>
      document.querySelector("#la-active-tasks .la-task-card .la-state")?.textContent === "已完成"
    );
    await context.setOffline(false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#la-workspace").waitFor({ state: "visible" });
    assert.match(await page.locator("#la-active-tasks .la-task-card").first().innerText(), /已完成/);
    await page.locator("#la-plan-proposal .la-proposal-card").waitFor({ state: "visible" });
    assert.match(await page.locator("#la-plan-proposal .la-proposal-card").innerText(), /待你确认/);

    const persisted = await page.evaluate(async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const repository = await getLearningRepository();
      const documents = await repository.documents.list(1000);
      const events = await repository.events.list();
      return {
        goals: documents.filter(item => item.type === "learning_goal" && !item.payload?._deleted),
        plans: documents.filter(item => item.type === "learning_plan" && !item.payload?._deleted),
        tasks: documents.filter(item => item.type === "learning_task" && !item.payload?._deleted),
        messages: documents.filter(item => item.type === "learning_agent_message" && !item.payload?._deleted),
        events,
      };
    });
    assert.equal(persisted.goals.length, 1);
    assert.ok(persisted.plans.length >= 2, "goal, preference and completion changes should retain plan revisions");
    assert.ok(persisted.plans.some(item => item.payload.status === "accepted"));
    assert.equal(persisted.tasks[0].payload.status, "completed");
    assert.ok(persisted.events.some(event => event.type === "learning_task_completed"));
    assert.equal(persisted.events.some(event => ["completed", "assessment_passed"].includes(event.type)), false,
      "A read task must not create mastery evidence");

    await page.locator("#la-chat-input").fill("目前掌握情况怎么样？");
    await page.locator("#la-send").click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".la-message-assistant p")].some(item =>
        item.textContent.includes("当前追踪"))
    );
    assert.equal(await page.locator("#la-metrics .la-metric strong").nth(1).innerText(), "0");

    await page.locator("#la-ai-consent").check();
    await page.locator("#la-chat-input").fill("请解释我现在的掌握情况");
    await page.locator("#la-send").click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".la-message-assistant p")].some(item =>
        item.textContent.includes("尚未完成 GitHub 登录"))
    );
    await page.waitForFunction(() =>
      /本地规则模式|云端 AI/.test(document.querySelector("#la-chat-status")?.textContent || "")
    );
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("WebKit mobile viewport: workspace, goal editor and persisted plan fit the device width", {
  timeout: 90_000,
}, async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const { context, page, errors } = await openWorkspace(browser, { width: 390, height: 844 });
    await createGoalAndPlan(page);
    const measurements = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      goalForm: document.querySelector("#la-create-goal").getBoundingClientRect().width,
      chatPanel: document.querySelector(".la-chat-panel").getBoundingClientRect().width,
    }));
    assert.equal(measurements.viewport, 390);
    assert.ok(measurements.document <= measurements.viewport + 1, JSON.stringify(measurements));
    assert.ok(measurements.body <= measurements.viewport + 1, JSON.stringify(measurements));
    assert.ok(measurements.goalForm <= measurements.viewport);
    assert.ok(measurements.chatPanel <= measurements.viewport);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#la-workspace").waitFor({ state: "visible" });
    assert.equal(await page.locator("#la-goals-list .la-goal-card").count(), 1);
    assert.equal(await page.locator("#la-active-tasks .la-task-card").count() > 0, true);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});
