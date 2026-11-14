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
  let expectedOfflineWindow = false;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    const text = message.text();
    const expectedNetworkFailure = expectedOfflineWindow && text.includes("net::ERR_INTERNET_DISCONNECTED");
    if (message.type() === "error" && !text.includes("favicon.ico") && !expectedNetworkFailure) errors.push(text);
  });
  await page.goto(baseURL + "/agent/", { waitUntil: "domcontentloaded" });
  await page.locator("#la-workspace").waitFor({ state: "visible" });
  // Profile metrics and AI conversation are intentionally hidden in Advanced Features.
  await page.locator(".la-advanced-details > summary").click();
  await page.locator("#la-metrics .la-metric").first().waitFor({ state: "visible" });
  await page.locator("#la-proactive-summary").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#la-proactive-summary")?.children.length > 0);
  return { context, page, errors, setExpectedOfflineWindow(value) { expectedOfflineWindow = Boolean(value); } };
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
  await waitForAsyncPageCondition(page, async () => {
    const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
    const repository = await getLearningRepository();
    const preferences = await repository.documents.get("learner_profile", "preferences");
    return preferences?.payload?.dailyMinutes === 15 &&
      preferences?.payload?.weeklyDays === 5 &&
      document.querySelector("#la-save-preferences")?.disabled === false &&
      document.querySelector("#la-regenerate-plan")?.disabled === false;
  }, { label: "learner preferences to persist" });
  await page.locator("#la-regenerate-plan").click();
  await waitForAsyncPageCondition(page, async () => {
    const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
    const repository = await getLearningRepository();
    const head = await repository.documents.get("learning_plan_head", "current");
    const proposalId = head?.payload?.proposedPlanId;
    if (!proposalId) return false;
    const proposal = await repository.documents.get("learning_plan", proposalId);
    return proposal?.payload?.status === "proposed" &&
      proposal?.payload?.dailyMinutes === 15 &&
      proposal?.payload?.reason === "学习者在工作区点击重新规划";
  }, { label: "a proposed adaptive learning plan to persist" });
  await page.locator("#la-plan-proposal .la-proposal-card").waitFor({ state: "visible" });
  const proposal = await page.locator("#la-plan-proposal .la-proposal-card").innerText();
  assert.match(proposal, /15 分钟/);
  assert.match(proposal, /Promise/);
  const acceptedPlanId = await page.locator("#la-plan-proposal .la-proposal-card").getAttribute("data-plan-id");
  await page.locator("#la-plan-proposal").getByRole("button", { name: "接受计划并创建任务" }).click();
  await waitForAsyncPageCondition(page, async () => {
    const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
    const repository = await getLearningRepository();
    const head = await repository.documents.get("learning_plan_head", "current");
    const activePlanId = head?.payload?.activePlanId;
    if (!activePlanId) return false;
    const active = await repository.documents.get("learning_plan", activePlanId);
    const rows = await repository.documents.list(1000);
    const tasks = rows.filter(row => row.type === "learning_task" && row.payload?.planId === activePlanId);
    return active?.payload?.status === "accepted" && tasks.length === active.payload.actions.length;
  }, { timeout: 30000, label: "accepted plan and its complete task set to persist" });
  await page.waitForFunction(() =>
    document.querySelectorAll("#la-active-tasks .la-task-card").length > 0 &&
    document.querySelector("#la-chat-status")?.textContent.includes("已保存")
  , { timeout: 30000 });
  await page.locator("#la-active-tasks .la-task-card").first().waitFor({ state: "visible" });
}

test("Chromium desktop: goal -> adaptive plan -> task pause/restore -> offline completion -> rule-mode agent", {
  timeout: 90_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page, errors, setExpectedOfflineWindow } = await openWorkspace(browser, { width: 1440, height: 1100 });
    const eagerAgentModules = await page.evaluate(() => performance.getEntriesByType("resource")
      .map(item => item.name)
      .filter(url => /\/(?:agent-provider|agent-tools|local-agent)\.mjs(?:[?#]|$)/.test(url)));
    assert.deepEqual(eagerAgentModules, [],
      "optional AI and tool modules must stay unloaded until the learner opens the chat workflow");
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
    setExpectedOfflineWindow(true);
    await context.setOffline(true);
    await restored.getByRole("button", { name: "继续执行" }).click();
    await page.locator("#la-active-tasks .la-task-card").first()
      .getByRole("button", { name: "完成阅读任务" }).click();
    await page.waitForFunction(() =>
      document.querySelector("#la-active-tasks .la-task-card .la-state")?.textContent === "已完成"
    );
    await context.setOffline(false);
    setExpectedOfflineWindow(false);
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

    // The AI conversation is optional and collapsed after each page load.
    await page.locator(".la-advanced-details > summary").click();
    await page.locator("#la-chat-input").waitFor({ state: "visible" });
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

test("Chromium desktop: learning events arriving during auto-replan are drained after the first proposal commits", {
  timeout: 90_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page, errors } = await openWorkspace(browser, { width: 1440, height: 1100 });
    await createGoalAndPlan(page);

    await page.evaluate(async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const repository = await getLearningRepository();
      const originalCommit = repository.commit.bind(repository);
      let blocked = false;
      window.__autoReplanAttemptedPlanIds = [];
      repository.commit = async change => {
        const proposedPlan = (change.documents || []).find(row =>
          row.type === "learning_plan" && row.payload?.status === "proposed" &&
          row.payload?.reason?.startsWith("检测到新的学习事实")
        );
        if (proposedPlan) window.__autoReplanAttemptedPlanIds.push(proposedPlan.key);
        if (proposedPlan && !blocked) {
          blocked = true;
          window.__heldAutoReplanPlanId = proposedPlan.key;
          window.__autoReplanCommitEntered = true;
          await new Promise(resolve => { window.__releaseAutoReplanCommit = resolve; });
        }
        return originalCommit(change);
      };
      const makeAttempt = (id, at) => ({
        id, eventSchemaVersion: 3, type: "attempt", at,
        topicId: "promise", challengeId: "promise-mechanism-quest",
        challengeTitle: "Promise 机制挑战", stepId: "thenable-adoption",
        stepTitle: "thenable 解析与 Promise 采用",
        competencyIds: ["thenable-adoption"], sessionId: id,
        sessionType: "campaign", variantId: "e2e-auto-replan-" + id,
        attemptNumber: 1, correct: true, hintsUsed: 0,
      });
      await originalCommit({ events: [makeAttempt("auto-replan-first", new Date().toISOString())] });
    });

    await page.waitForFunction(() => window.__autoReplanCommitEntered === true, { timeout: 15000 });
    await page.evaluate(async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const repository = await getLearningRepository();
      await repository.commit({ events: [{
        id: "auto-replan-second-during-commit", eventSchemaVersion: 3,
        type: "attempt", at: new Date(Date.now() + 10).toISOString(),
        topicId: "promise", challengeId: "promise-mechanism-quest",
        challengeTitle: "Promise 机制挑战", stepId: "thenable-adoption",
        stepTitle: "thenable 解析与 Promise 采用",
        competencyIds: ["thenable-adoption"], sessionId: "auto-replan-second-during-commit",
        sessionType: "campaign", variantId: "e2e-auto-replan-second",
        attemptNumber: 1, correct: true, hintsUsed: 0,
      }] });
      window.__releaseAutoReplanCommit();
    });

    await waitForAsyncPageCondition(page, async () => {
      return (window.__autoReplanAttemptedPlanIds || []).length === 2;
    }, { timeout: 12000, label: "both concurrent event batches to trigger auto-replan commits" }).catch(async error => {
      const diagnostic = await page.evaluate(async () => {
        const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
        const repository = await getLearningRepository();
        const documents = await repository.documents.list(1000);
        const events = await repository.events.list();
        return {
          attemptedPlanIds: window.__autoReplanAttemptedPlanIds || [],
          plans: documents.filter(row => row.type === "learning_plan").map(row => ({
            id: row.key, status: row.payload?.status, reason: row.payload?.reason,
            generatedAt: row.payload?.generatedAt,
          })),
          events: events.filter(event => event.id.startsWith("auto-replan-")).map(event => ({
            id: event.id, at: event.at, type: event.type,
          })),
          status: document.querySelector("#la-chat-status")?.textContent,
          proposalText: document.querySelector("#la-plan-proposal")?.innerText,
        };
      });
      throw new Error("Auto-replan queue diagnostic: " + JSON.stringify(diagnostic) + " | " + error.message);
    });

    const result = await page.evaluate(async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const repository = await getLearningRepository();
      const documents = await repository.documents.list(1000);
      const events = await repository.events.list();
      const attemptedIds = window.__autoReplanAttemptedPlanIds || [];
      const plans = attemptedIds.map(id => documents.find(row =>
        row.type === "learning_plan" && row.key === id && !row.payload?._deleted
      )?.payload || null);
      return {
        plans: plans.map(plan => plan && ({
          planId: plan.planId, status: plan.status,
          supersedesProposalId: plan.supersedesProposalId, reason: plan.reason,
        })),
        bothEventsPersisted: [
          "auto-replan-first",
          "auto-replan-second-during-commit",
        ].every(id => events.some(event => event.id === id)),
      };
    });
    assert.equal(result.plans.length, 2);
    assert.ok(result.plans.every(Boolean), JSON.stringify(result));
    assert.equal(result.plans[0].status, "superseded", JSON.stringify(result));
    assert.equal(result.plans[1].status, "proposed", JSON.stringify(result));
    assert.equal(result.plans[1].supersedesProposalId, result.plans[0].planId, JSON.stringify(result));
    assert.ok(result.plans.every(plan => plan.reason.includes("attempt")), JSON.stringify(result));
    assert.equal(result.bothEventsPersisted, true);
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
