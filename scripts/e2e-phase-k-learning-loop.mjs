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

async function openTutor(browser, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    localStorage.setItem("knowverse:supabase-session", JSON.stringify({
      access_token: "e2e-access-token",
      refresh_token: "e2e-refresh-token",
      token_type: "bearer",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "e2e-user" },
    }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !message.text().includes("favicon.ico")) errors.push(message.text());
  });
  await page.goto(baseURL + "/knowledge/promise/lesson-03/", { waitUntil: "domcontentloaded" });
  await page.locator("#kv-learning-tutor-launcher").waitFor({ state: "visible", timeout: 15000 });
  await page.locator("#kv-learning-tutor-launcher").click();
  await page.locator("#kv-learning-tutor-overlay").waitFor({ state: "visible" });
  return { context, page, errors };
}

test("Chromium desktop: Socratic tutor guides one question at a time and private reflections never become mastery evidence", {
  timeout: 60_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
      localStorage.setItem("knowverse:supabase-session", JSON.stringify({
        access_token: "e2e-access-token",
        refresh_token: "e2e-refresh-token",
        token_type: "bearer",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: "e2e-user" },
      }));
    });
    const page = await context.newPage();
    const errors = [];
    const httpErrors = [];
    page.on("response", response => {
      if (response.status() >= 400) httpErrors.push(response.status() + " " + response.url());
    });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error" && !message.text().includes("favicon.ico")) errors.push(message.text());
    });
    let payload = null;
    let requests = 0;
    await page.route("**/rest/v1/rpc/get_learning_sync_profile", async route => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authorized: true }),
      });
    });
    await page.route("**/functions/v1/learning-agent", async route => {
      requests += 1;
      payload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          reply: "先不急着下结论：你认为读取 then 属性与执行 then 函数之间，哪一步会先发生？",
          suggestions: [{ toolName: "create_learning_goal", input: { title: "must be ignored" } }],
          dataRequests: [{ toolName: "get_learner_profile", input: {} }],
        }),
      });
    });
    await page.goto(baseURL + "/knowledge/promise/lesson-03/", { waitUntil: "domcontentloaded" });
    await page.locator("#kv-learning-tutor-launcher").waitFor({ state: "visible", timeout: 15000 });
    await page.locator("#kv-learning-tutor-launcher").click();
    await page.getByRole("button", { name: "苏格拉底引导" }).click();
    assert.match(await page.locator("#kv-tutor-question").inputValue(), /每轮只提出一个短问题/);
    await page.locator("#kv-tutor-question").fill("我猜先读取 then 属性，再把函数放入微任务。");
    await page.locator("#kv-tutor-cloud-consent").check();
    await page.locator(".kv-tutor-send").click();
    await page.getByText("你认为读取 then 属性与执行 then 函数之间").waitFor();
    assert.equal(requests, 1);
    assert.equal(payload.mode, "tutor");
    assert.equal(payload.tutorMode, "socratic");
    assert.equal(JSON.stringify(await page.locator(".kv-tutor-message.assistant").allInnerTexts())
      .includes("must be ignored"), false);

    const before = await page.evaluate(async () => {
      const { createLearningProgressStore } = await import("/assets/js/learning-progress.mjs");
      return (await createLearningProgressStore().load()).events.map(item => item.id);
    });
    await page.locator(".kv-tutor-reflection > summary").click();
    await page.locator("#kv-tutor-reflect-initialThinking").fill("我原以为 thenable 的 then 函数会在属性读取时立即执行。");
    await page.locator("#kv-tutor-reflect-insightChanged").fill("getter 读取与 thenable 调用是不同阶段。");
    await page.locator(".kv-tutor-reflection-save").click();
    await page.getByText(/已保存到你的私有学习档案/).waitFor();
    const journal = await page.evaluate(async () => {
      const { createLearningReflectionStore } = await import("/assets/js/learning-reflections.mjs");
      const { createLearningProgressStore } = await import("/assets/js/learning-progress.mjs");
      return {
        reflections: await createLearningReflectionStore().list({ competencyIds: ["thenable-adoption"] }),
        events: (await createLearningProgressStore().load()).events.map(item => item.id),
      };
    });
    assert.equal(journal.reflections.length, 1);
    assert.equal(journal.reflections[0].initialThinking, "我原以为 thenable 的 then 函数会在属性读取时立即执行。");
    await page.locator(".kv-tutor-reflection-item > summary").click();
    await page.getByRole("button", { name: "编辑这条反思" }).click();
    assert.equal(await page.locator("#kv-tutor-reflect-insightChanged").inputValue(), "getter 读取与 thenable 调用是不同阶段。");
    await page.locator("#kv-tutor-reflect-insightChanged").fill("getter 先读取；之后再通过 ThenableJob 调用 then。");
    await page.getByRole("button", { name: "保存修改" }).click();
    await page.getByText(/已保存到你的私有学习档案/).waitFor();
    const edited = await page.evaluate(async () => {
      const { createLearningReflectionStore } = await import("/assets/js/learning-reflections.mjs");
      return createLearningReflectionStore().list({ competencyIds: ["thenable-adoption"] });
    });
    assert.equal(edited.length, 1);
    assert.equal(edited[0].insightChanged, "getter 先读取；之后再通过 ThenableJob 调用 then。");
    await page.locator(".kv-tutor-reflection-item > summary").click();
    await page.getByRole("button", { name: "删除这条反思" }).click();
    await page.getByText("这里还没有反思记录。").waitFor();
    const afterDelete = await page.evaluate(async () => {
      const { createLearningReflectionStore } = await import("/assets/js/learning-reflections.mjs");
      return createLearningReflectionStore().list({ competencyIds: ["thenable-adoption"] });
    });
    assert.equal(afterDelete.length, 0);
    assert.deepEqual(journal.events, before, "reflection create/edit/delete and tutor messages must not create mastery/activity events");
    assert.deepEqual(errors, [], httpErrors.join("\n"));
    assert.deepEqual(httpErrors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("WebKit mobile: private reflection inputs fit the 390px tutor drawer", {
  timeout: 60_000,
}, async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const { context, page, errors } = await openTutor(browser, { width: 390, height: 844 });
    await page.locator(".kv-tutor-reflection > summary").click();
    const field = page.locator("#kv-tutor-reflect-transferPlan");
    await field.fill("换一个自定义 thenable，先预测 getter 与调用的日志顺序。");
    assert.equal(await field.inputValue(), "换一个自定义 thenable，先预测 getter 与调用的日志顺序。");
    const drawer = await page.locator(".kv-tutor-drawer").boundingBox();
    assert.ok(drawer && drawer.width >= 380 && drawer.width <= 390);
    assert.equal(await page.locator(".kv-tutor-reflection-save").isVisible(), true);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});
