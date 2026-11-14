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

async function waitForStrategyMode(page, mode, timeout = 10000) {
  await waitForAsyncPageCondition(page, async expectedMode => {
    const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
    const row = await (await getLearningRepository()).documents.get("learner_profile", "preferences");
    const pressed = document.querySelector("#strategy-mode-" + expectedMode)?.getAttribute("aria-pressed");
    const matches = row?.payload?.personalizationMode === expectedMode && pressed === "true";
    window.__kvStrategyModeStableCount = matches
      ? Math.min(3, (window.__kvStrategyModeStableCount || 0) + 1)
      : 0;
    return window.__kvStrategyModeStableCount >= 3;
  }, { arg: mode, timeout, label: "strategy mode " + mode + " to persist" });
}

async function traceLearningDocuments(page) {
  const writes = [];
  const clicks = [];
  page.on("console", message => {
    const value = message.text();
    if (value.startsWith("__KV_DOCUMENT_TRACE__")) writes.push(value.slice("__KV_DOCUMENT_TRACE__".length));
    if (value.startsWith("__KV_STRATEGY_CLICK__")) clicks.push(value.slice("__KV_STRATEGY_CLICK__".length));
  });
  await page.addInitScript(() => {
    // These cases verify the local-first IndexedDB contract. Keep them isolated
    // from the live Supabase project so a browser runner's auth/network state
    // cannot race the local preference persistence assertions.
    globalThis.KNOWVERSE_BACKEND_CONFIG = { supabaseUrl: "", publishableKey: "" };
    if (globalThis.__kvDocumentTraceInstalled) return;
    globalThis.__kvDocumentTraceInstalled = true;
    document.addEventListener("click", event => {
      const button = event.target?.closest?.("#strategy-mode-default, #strategy-mode-adaptive");
      if (button) console.info("__KV_STRATEGY_CLICK__" + button.id);
    }, true);
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...args) {
      if (this.name === "learningDocuments" &&
          ["plan_preferences", "learner_profile"].includes(value?.type)) {
        console.info("__KV_DOCUMENT_TRACE__" + JSON.stringify({
          operation: "put", type: value.type, key: value.key,
          revision: value.localRevision, payload: value.payload,
          dirty: value.dirty, cloudRevision: value.cloudRevision,
        }));
      }
      return originalPut.call(this, value, ...args);
    };
    const originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function(key) {
      if (this.name === "learningDocuments") {
        console.info("__KV_DOCUMENT_TRACE__" + JSON.stringify({ operation: "delete", key }));
      }
      return originalDelete.call(this, key);
    };
    const originalClear = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.clear = function() {
      if (this.name === "learningDocuments") {
        console.info("__KV_DOCUMENT_TRACE__" + JSON.stringify({ operation: "clear", store: this.name }));
      }
      return originalClear.call(this);
    };
    const originalDeleteDatabase = IDBFactory.prototype.deleteDatabase;
    IDBFactory.prototype.deleteDatabase = function(name) {
      console.info("__KV_DOCUMENT_TRACE__" + JSON.stringify({ operation: "deleteDatabase", name }));
      return originalDeleteDatabase.call(this, name);
    };
  });
  return { writes, clicks };
}


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
    await waitForAsyncPageCondition(page, async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const data = await (await getLearningRepository()).events.list();
      return data.some(event => event.type === "plan_action_completed");
    }, { label: "completed plan action event" });
    const snapshot = await page.evaluate(async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      return { events: await (await getLearningRepository()).events.list() };
    });
    assert.equal(snapshot.events.filter(event => event.type === "plan_action_completed").length, 1);
    assert.equal(snapshot.events.some(event => event.type === "completed" || event.type === "assessment_passed"), false);
    assert.equal(await page.locator("#hero-tested").textContent(), "0 / 34");
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
    const documentWrites = await traceLearningDocuments(page);
    // Simulate the exact legacy value that Phase C must import before the
    // IndexedDB-backed preference controls become editable.
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__kv_phase_c_seeded") === "true") return;
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
      sessionStorage.setItem("__kv_phase_c_seeded", "true");
    });
    await page.goto(baseURL + "/progress/", { waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.learningProgressReady === "true");
    await page.locator("#plan-actions .lp-plan-card").first().waitFor({ state:"visible" });
    assert.equal(await page.evaluate(() => localStorage.getItem("knowverse:learning-state")), null,
      "legacy Phase C source must be fully imported and cleaned before preference editing");
    await page.locator("#plan-time-budget").selectOption("15");
    await waitForAsyncPageCondition(page, async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const preference = await (await getLearningRepository()).documents.get("plan_preferences", "preferences");
      return preference?.payload?.dailyMinutes === 15 &&
        document.querySelectorAll("#plan-actions .lp-plan-card").length === 1;
    }, { label: "daily time preference to persist" });
    await page.locator("#plan-focus-topic").selectOption("monorepo");
    await waitForAsyncPageCondition(page, async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const preference = await (await getLearningRepository()).documents.get("plan_preferences", "preferences");
      const firstTitle = document.querySelector("#plan-actions .lp-plan-card h3")?.textContent?.trim();
      return preference?.payload?.focusTopicId === "monorepo" &&
        firstTitle === "工作区依赖声明" &&
        document.querySelector("#plan-time-budget")?.value === "15" &&
        document.querySelector("#plan-focus-topic")?.value === "monorepo";
    }, { label: "focused plan preference to persist" });
    await page.reload({ waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.learningProgressReady === "true");
    // Require the persisted document and rendered controls to agree across
    // three separate IndexedDB reads before asserting the restored state.
    const preference = await waitForAsyncPageCondition(page, async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const row = await (await getLearningRepository()).documents.get("plan_preferences", "preferences");
      const title = document.querySelector("#plan-actions .lp-plan-card h3")?.textContent?.trim();
      const state = {
        payload: row?.payload || null,
        dailyMinutes: document.querySelector("#plan-time-budget")?.value || null,
        focusTopicId: document.querySelector("#plan-focus-topic")?.value || null,
        cardCount: document.querySelectorAll("#plan-actions .lp-plan-card").length,
        firstTitle: title || null,
      };
      const matches = state.payload?.dailyMinutes === 15 &&
        state.payload?.focusTopicId === "monorepo" &&
        state.dailyMinutes === "15" && state.focusTopicId === "monorepo" &&
        state.cardCount === 1 && state.firstTitle === "工作区依赖声明";
      window.__kvPlanPreferenceTrace = state;
      window.__kvPlanPreferenceStableCount = matches
        ? Math.min(3, (window.__kvPlanPreferenceStableCount || 0) + 1)
        : 0;
      return window.__kvPlanPreferenceStableCount >= 3 ? state.payload : false;
    }, { timeout:10000, polling:100, label: "reloaded plan preferences to remain stable" }).catch(async error => {
      const diagnostic = await page.evaluate(async () => {
        const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
        const row = await (await getLearningRepository()).documents.get("plan_preferences", "preferences");
        return {
          finalPayload: row?.payload || null,
          dom: window.__kvPlanPreferenceTrace || null,
          stableCount: window.__kvPlanPreferenceStableCount || 0,
          title: document.querySelector("#plan-actions .lp-plan-card h3")?.textContent?.trim() || null,
          dailyMinutes: document.querySelector("#plan-time-budget")?.value || null,
          focusTopicId: document.querySelector("#plan-focus-topic")?.value || null,
          cards: document.querySelectorAll("#plan-actions .lp-plan-card").length,
          ready: document.documentElement.dataset.learningProgressReady || null,
          error: document.documentElement.dataset.learningProgressError || null,
        };
      });
      throw new Error("Persisted plan preference never stabilized: " + JSON.stringify({diagnostic,documentWrites,errors}) + " | " + error.message);
    });
    assert.deepEqual(preference, { dailyMinutes:15, focusTopicId:"monorepo" },
      JSON.stringify({ preference, documentWrites, errors }));
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
    const documentTrace = await traceLearningDocuments(page);
    await page.goto(baseURL + "/progress/", { waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.learningProgressReady === "true");
    // Strategy controls live in advanced analysis and are intentionally collapsed by default.
    await page.locator("#proactive-learning > summary").click();
    await page.locator("#strategy-mode-default").waitFor({ state:"visible" });
    await page.locator("#strategy-mode-default").click();
    await page.waitForFunction(() => {
      const status = document.querySelector("#strategy-control-status")?.textContent || "";
      return status.startsWith("已切换为默认策略") || status.startsWith("策略设置保存失败");
    }, { timeout:5000 }).catch(async error => {
      const state = await page.evaluate(() => ({
        buttonCount: document.querySelectorAll("#strategy-mode-default").length,
        button: document.querySelector("#strategy-mode-default")?.outerHTML || null,
        status: document.querySelector("#strategy-control-status")?.textContent || null,
        ready: document.documentElement.dataset.learningProgressReady || null,
      }));
      throw new Error("Strategy click did not reach its handler: " +
        JSON.stringify({state, clicks:documentTrace.clicks, writes:documentTrace.writes, errors}) +
        " | " + error.message);
    });
    await waitForAsyncPageCondition(page, async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const row = await (await getLearningRepository()).documents.get("learner_profile", "preferences");
      return row?.payload?.personalizationMode === "default";
    }, { label: "default strategy preference to persist" });
    assert.ok(documentTrace.clicks.includes("strategy-mode-default"),
      "default-mode click must reach the document; trace=" + JSON.stringify(documentTrace));
    const defaultWrite = documentTrace.writes.map(value => JSON.parse(value)).find(item =>
      item.operation === "put" && item.type === "learner_profile" &&
      item.key === "preferences" && item.payload?.personalizationMode === "default");
    assert.ok(defaultWrite, "default preference must be durably written; trace=" + JSON.stringify(documentTrace));
    await page.reload({ waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.learningProgressReady === "true");
    await page.locator("#proactive-learning > summary").click();
    await page.locator("#learning-strategy-content").waitFor({ state:"visible" });
    try {
      await waitForStrategyMode(page, "default");
    } catch (error) {
      const state = await page.evaluate(async () => {
        const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
        const row = await (await getLearningRepository()).documents.get("learner_profile", "preferences");
        return {
          payload: row?.payload || null,
          button: document.querySelector("#strategy-mode-default")?.getAttribute("aria-pressed"),
          progressError: document.documentElement.dataset.learningProgressError || null,
          status: document.querySelector("#strategy-control-status")?.textContent || null,
        };
      });
      throw new Error("Strategy preference did not survive reload: " +
        JSON.stringify({ state, writes: documentTrace.writes, clicks: documentTrace.clicks, errors }) + " | " + error.message);
    }
    const modeState = await page.evaluate(async () => {
      const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
      const row = await (await getLearningRepository()).documents.get("learner_profile", "preferences");
      return {
        payload: row?.payload || null,
        revision: row?.localRevision || null,
      };
    });
    assert.equal(modeState.payload?.personalizationMode, "default",
      JSON.stringify({ modeState, writes: documentTrace.writes, clicks: documentTrace.clicks, errors }));
    assert.equal(await page.locator("#strategy-mode-default").getAttribute("aria-pressed"), "true");
    await page.locator("#strategy-mode-adaptive").click();
    await page.waitForFunction(() => {
      const status = document.querySelector("#strategy-control-status")?.textContent || "";
      return status.startsWith("已启用个性化策略") || status.startsWith("策略设置保存失败");
    }, { timeout:5000 });
    try {
      await waitForStrategyMode(page, "adaptive");
    } catch (error) {
      const state = await page.evaluate(async () => {
        const { getLearningRepository } = await import("/assets/js/backend/learning-repository.mjs");
        const row = await (await getLearningRepository()).documents.get("learner_profile", "preferences");
        return {
          payload: row?.payload || null,
          button: document.querySelector("#strategy-mode-adaptive")?.getAttribute("aria-pressed"),
          status: document.querySelector("#strategy-control-status")?.textContent || null,
        };
      });
      throw new Error("Strategy adaptive mode did not persist: " +
        JSON.stringify({ state, writes: documentTrace.writes, clicks: documentTrace.clicks, errors }) + " | " + error.message);
    }
    await page.reload({ waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.learningProgressReady === "true");
    // Strategy controls are intentionally lazy: reopen advanced analysis after
    // reload before asserting the persisted mode in its rendered projection.
    await page.locator("#proactive-learning > summary").click();
    await page.locator("#learning-strategy-content").waitFor({ state:"visible" });
    await waitForStrategyMode(page, "adaptive");
    assert.ok(documentTrace.clicks.includes("strategy-mode-adaptive"),
      "adaptive-mode click must reach the document; trace=" + JSON.stringify(documentTrace));
    const adaptiveWrite = documentTrace.writes.map(value => JSON.parse(value)).find(item =>
      item.operation === "put" && item.type === "learner_profile" &&
      item.key === "preferences" && item.payload?.personalizationMode === "adaptive");
    assert.ok(adaptiveWrite, "adaptive preference must be durably written; trace=" + JSON.stringify(documentTrace));
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
    await page.locator("#proactive-learning > summary").click();
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
