import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, webkit } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = {
  ".html":"text/html; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".mjs":"text/javascript; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".svg":"image/svg+xml",
};
async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const relative = pathname.startsWith("/") ? pathname.slice(1) : pathname;
      let file = resolve(root, relative || "index.html");
      if (file !== root && !file.startsWith(root + sep)) return response.writeHead(403).end("Forbidden");
      try { if ((await stat(file)).isDirectory()) file = resolve(file, "index.html"); }
      catch { return response.writeHead(404).end("Not found"); }
      response.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control":"no-store" });
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

test("Chromium desktop: the daily plan respects prerequisites and advances from lesson to practice", { timeout:60000 }, async () => {
  const browser = await chromium.launch({ headless:true });
  try {
    const context = await browser.newContext({ viewport:{ width:1440, height:1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseURL + "/progress/", { waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.learningProgressReady === "true");
    await page.locator("#plan-actions .lp-plan-card").first().waitFor({ state:"visible" });
    await page.locator("#plan-time-budget").selectOption("40");
    const firstCard = page.locator("#plan-actions .lp-plan-card").first();
    const firstCompetency = (await firstCard.locator("h3").textContent()).trim();
    assert.equal(firstCompetency, "thenable 解析与 Promise 采用");
    assert.match(await page.locator("#plan-summary").textContent(), /今日安排/);
    await firstCard.getByRole("button", { name:"完成此学习步骤" }).click();
    await page.waitForFunction(async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const data = await (await getLearningRepository()).events.list();
      return data.some(event => event.type === "plan_action_completed");
    });
    const snapshot = await page.evaluate(async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      return { events: await (await getLearningRepository()).events.list() };
    });
    assert.equal(snapshot.events.filter(event => event.type === "plan_action_completed").length, 1);
    assert.equal(snapshot.events.some(event => event.type === "completed" || event.type === "assessment_passed"), false);
    assert.equal(await page.locator("#hero-tested").textContent(), "0 / 15");
    await page.waitForFunction(() =>
      document.querySelector("#plan-actions .lp-plan-card .lp-tag")?.textContent?.trim() === "实验练习"
    );
    const nextCard = page.locator("#plan-actions .lp-plan-card").first();
    assert.equal((await nextCard.locator("h3").textContent()).trim(), firstCompetency);
    assert.equal((await nextCard.locator(".lp-tag").textContent()).trim(), "实验练习");
    assert.match(await nextCard.textContent(), /进入实验并完成知识检查/);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("WebKit mobile: plan time and focus preferences persist and remain within the viewport", { timeout:60000 }, async () => {
  const browser = await webkit.launch({ headless:true });
  try {
    const context = await browser.newContext({ viewport:{ width:390, height:844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    // Simulate the exact legacy value that Phase C must import before the
    // IndexedDB-backed preference controls become editable.
    await page.addInitScript(() => {
      localStorage.setItem("knowverse:learning-state", JSON.stringify({
        format: "knowverse-learning-state",
        schemaVersion: 1,
        revision: 4,
        records: {
          "knowverse:learning-plan:preferences": JSON.stringify({
            dailyMinutes: 25,
            focusTopicId: "all",
          }),
        },
      }));
    });
    await page.goto(baseURL + "/progress/", { waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.learningProgressReady === "true");
    await page.locator("#plan-actions .lp-plan-card").first().waitFor({ state:"visible" });
    assert.equal(await page.evaluate(() => localStorage.getItem("knowverse:learning-state")), null,
      "legacy Phase C source must be fully imported and cleaned before preference editing");
    await page.locator("#plan-time-budget").selectOption("15");
    await page.waitForFunction(async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const preference = await (await getLearningRepository()).documents.get("plan_preferences", "preferences");
      return preference?.payload?.dailyMinutes === 15 &&
        document.querySelectorAll("#plan-actions .lp-plan-card").length === 1;
    });
    await page.locator("#plan-focus-topic").selectOption("monorepo");
    await page.waitForFunction(async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const preference = await (await getLearningRepository()).documents.get("plan_preferences", "preferences");
      const firstTitle = document.querySelector("#plan-actions .lp-plan-card h3")?.textContent?.trim();
      return preference?.payload?.focusTopicId === "monorepo" &&
        firstTitle === "工作区依赖声明" &&
        document.querySelector("#plan-time-budget")?.value === "15" &&
        document.querySelector("#plan-focus-topic")?.value === "monorepo";
    });
    await page.reload({ waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.learningProgressReady === "true");
    await page.waitForFunction(async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const preference = await (await getLearningRepository()).documents.get("plan_preferences", "preferences");
      return preference?.payload?.dailyMinutes === 15 &&
        preference?.payload?.focusTopicId === "monorepo" &&
        document.querySelector("#plan-time-budget")?.value === "15" &&
        document.querySelector("#plan-focus-topic")?.value === "monorepo" &&
        document.querySelectorAll("#plan-actions .lp-plan-card").length === 1;
    });
    const preference = await page.evaluate(async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      return (await getLearningRepository()).documents.get("plan_preferences", "preferences").then(row => row.payload);
    });
    assert.deepEqual(preference, { dailyMinutes:15, focusTopicId:"monorepo" });
    assert.equal(await page.locator("#plan-actions .lp-plan-card").count(), 1);
    assert.equal((await page.locator("#plan-actions .lp-plan-card h3").first().textContent()).trim(), "工作区依赖声明");
    const box = await page.locator(".lp-plan-shell").boundingBox();
    assert.ok(box && box.width <= 390, "learning plan must fit the mobile viewport");
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("Chromium desktop: strategy mode is user-controlled and persists through reload", { timeout:60000 }, async () => {
  const browser = await chromium.launch({ headless:true });
  try {
    const context = await browser.newContext({ viewport:{ width:1440, height:1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseURL + "/progress/", { waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.learningProgressReady === "true");
    await page.locator("#strategy-mode-default").click();
    await page.waitForFunction(async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const row = await (await getLearningRepository()).documents.get("learner_profile", "preferences");
      return row?.payload?.personalizationMode === "default";
    });
    await page.reload({ waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.learningProgressReady === "true");
    await page.locator("#learning-strategy-content").waitFor({ state:"visible" });
    await page.waitForFunction(() =>
      document.querySelector("#strategy-mode-default")?.getAttribute("aria-pressed") === "true");
    const mode = await page.evaluate(async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      return (await getLearningRepository()).documents.get("learner_profile", "preferences").then(row => row.payload.personalizationMode);
    });
    assert.equal(mode, "default");
    assert.equal(await page.locator("#strategy-mode-default").getAttribute("aria-pressed"), "true");
    await page.locator("#strategy-mode-adaptive").click();
    await page.waitForFunction(async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const row = await (await getLearningRepository()).documents.get("learner_profile", "preferences");
      return row?.payload?.personalizationMode === "adaptive";
    });
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("WebKit mobile: strategy panel controls remain within a narrow viewport", { timeout:60000 }, async () => {
  const browser = await webkit.launch({ headless:true });
  try {
    const context = await browser.newContext({ viewport:{ width:390, height:844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseURL + "/progress/", { waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.learningProgressReady === "true");
    await page.locator("#learning-strategy-content").waitFor({ state:"visible" });
    const box = await page.locator("#learning-strategy").boundingBox();
    assert.ok(box && box.width <= 390, "strategy panel must fit the mobile viewport");
    const controls = await page.locator(".lp-strategy-controls").boundingBox();
    assert.ok(controls && controls.x >= 0 && controls.x + controls.width <= 390);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});
