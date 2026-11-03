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

async function openPage(browser, path, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !message.text().includes("favicon.ico")) errors.push(message.text());
  });
  await page.goto(baseURL + path, { waitUntil: "domcontentloaded" });
  await page.locator("#kv-learning-tutor-launcher").waitFor({ state: "visible", timeout: 15000 });
  return { context, page, errors };
}

test("Chromium desktop: mapped course tutor sees the current competency and does not send without consent", {
  timeout: 60_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page, errors } = await openPage(
      browser, "/knowledge/promise/lesson-03/", { width: 1440, height: 1000 },
    );
    let providerRequests = 0;
    await page.route("**/functions/v1/learning-agent", async route => {
      providerRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: 1, reply: "unexpected", suggestions: [], dataRequests: [] }),
      });
    });

    await page.locator("#kv-learning-tutor-launcher").click();
    const overlay = page.locator("#kv-learning-tutor-overlay");
    await overlay.waitFor({ state: "visible" });
    const contextText = await page.locator(".kv-tutor-context").innerText();
    assert.match(contextText, /当前学习现场/);
    assert.match(contextText, /thenable 解析与 Promise 采用/);
    assert.match(contextText, /待验证/);
    const privacyText = await page.locator(".kv-tutor-privacy").innerText();
    assert.match(privacyText, /最多发送 6 条此前的对话消息/);
    assert.match(privacyText, /每条最多 1,000 字/);
    assert.match(privacyText, /页面摘录只有在你单独勾选时才会附加/);

    await page.getByRole("button", { name: "分级提示" }).click();
    const input = page.locator("#kv-tutor-question");
    assert.match(await input.inputValue(), /第一级提示/);
    await input.fill("解释为什么 then 属性读取是同步操作？");
    assert.equal(await page.locator("#kv-tutor-cloud-consent").isChecked(), false);
    await page.locator(".kv-tutor-send").click();
    await page.waitForFunction(() =>
      document.querySelector(".kv-tutor-status")?.textContent.includes("本轮没有发送任何数据")
    );
    assert.equal(providerRequests, 0, "no network request is allowed without explicit consent");
    assert.equal(await page.locator(".kv-tutor-message.user").count(), 1);
    assert.deepEqual(errors, []);

    const eventTypes = await page.evaluate(async () => {
      const { createLearningProgressStore } = await import("/assets/js/learning-progress.mjs");
      const snapshot = await createLearningProgressStore().load();
      return snapshot.events.map(event => event.type);
    });
    assert.equal(eventTypes.includes("tutor_message"), false);
    assert.equal(eventTypes.includes("ai_tutor_used"), false);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("Chromium desktop: live Promise debugger work gets its own relevant scene", {
  timeout: 60_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page, errors } = await openPage(
      browser, "/lab/experiments/promise-debugger/", { width: 1365, height: 900 },
    );
    await page.locator("#kv-learning-tutor-launcher").click();
    await page.locator("#kv-learning-tutor-overlay").waitFor({ state: "visible" });
    const scene = await page.locator(".kv-tutor-context").innerText();
    assert.match(scene, /Promise 调试工作台/);
    assert.match(scene, /thenable 解析与 Promise 采用/);
    assert.match(scene, /微任务 FIFO 与嵌套入队/);

    await page.goto(baseURL + "/lab/experiments/rn-render-pipeline/", { waitUntil: "domcontentloaded" });
    await page.locator("#kv-learning-tutor-launcher").waitFor({ state: "visible", timeout: 15000 });
    await page.locator("#kv-learning-tutor-launcher").click();
    await page.locator("#kv-learning-tutor-overlay").waitFor({ state: "visible" });
    const rnScene = await page.locator(".kv-tutor-context").innerText();
    assert.match(rnScene, /Fabric 渲染管线观测器/);
    assert.match(rnScene, /Fabric 渲染管线/);

    await page.goto(baseURL + "/knowledge/monorepo/labs/graph/", { waitUntil: "domcontentloaded" });
    await page.locator("#kv-learning-tutor-launcher").waitFor({ state: "visible", timeout: 15000 });
    await page.locator("#kv-learning-tutor-launcher").click();
    await page.locator("#kv-learning-tutor-overlay").waitFor({ state: "visible" });
    const monorepoScene = await page.locator(".kv-tutor-context").innerText();
    assert.match(monorepoScene, /依赖图与 Affected/);
    assert.match(monorepoScene, /Affected/);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("WebKit mobile: tutor drawer fits a 390px viewport and remains dismissible", {
  timeout: 60_000,
}, async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const { context, page, errors } = await openPage(
      browser, "/gallery/exhibits/promise-cosmos/", { width: 390, height: 844 },
    );
    await page.locator("#kv-learning-tutor-launcher").click();
    const overlay = page.locator("#kv-learning-tutor-overlay");
    await overlay.waitFor({ state: "visible" });
    const drawer = page.locator(".kv-tutor-drawer");
    const box = await drawer.boundingBox();
    assert.ok(box && box.width >= 380 && box.width <= 390, "mobile tutor must use the available viewport width");
    await page.locator(".kv-tutor-close").click();
    await overlay.waitFor({ state: "hidden" });
    assert.equal(await page.locator("#kv-learning-tutor-launcher").getAttribute("aria-expanded"), "false");
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("Chromium desktop: one-turn consent sends only the explicitly selected excerpt and tutor mode", {
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
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error" && !message.text().includes("favicon.ico")) errors.push(message.text());
    });
    let payload = null;
    let authorization = "";
    let requests = 0;
    await page.route("**/functions/v1/learning-agent", async route => {
      requests += 1;
      payload = route.request().postDataJSON();
      authorization = route.request().headers().authorization || "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          reply: "观察 getter 读取与 thenable 调用是两个不同的时机。",
          suggestions: [{ toolName: "create_learning_goal", input: { title: "unsafe" } }],
          dataRequests: [{ toolName: "get_learner_profile", input: {} }],
        }),
      });
    });
    await page.goto(baseURL + "/knowledge/promise/lesson-03/", { waitUntil: "domcontentloaded" });
    await page.locator("#kv-learning-tutor-launcher").waitFor({ state: "visible", timeout: 15000 });
    const heading = page.locator("h1").first();
    const selectedText = (await heading.innerText()).trim();
    await heading.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.locator("#kv-learning-tutor-launcher").click();
    await page.locator("#kv-learning-tutor-overlay").waitFor({ state: "visible" });
    await page.locator("#kv-tutor-include-selection").check();
    await page.getByRole("button", { name: "分级提示" }).click();
    await page.locator("#kv-tutor-question").fill("下一步应该观察什么？");
    await page.locator("#kv-tutor-cloud-consent").check();
    await page.locator(".kv-tutor-send").click();
    await page.getByText("观察 getter 读取与 thenable 调用是两个不同的时机。").waitFor();
    assert.equal(requests, 1);
    assert.equal(authorization, "Bearer e2e-access-token");
    assert.equal(payload.mode, "tutor");
    assert.equal(payload.tutorMode, "hint");
    assert.equal(payload.context.learningScene.selectedExcerpt, selectedText);
    assert.equal(JSON.stringify(payload).includes("e2e-refresh-token"), false);
    assert.equal(await page.locator("#kv-tutor-cloud-consent").isChecked(), false,
      "consent must reset after the single request");
    assert.equal(await page.locator(".kv-tutor-status").innerText(),
      "导师已回复 · 本轮没有产生掌握证据，也没有修改学习计划。");
    assert.equal(JSON.stringify(await page.locator(".kv-tutor-message.assistant").allInnerTexts())
      .includes("create_learning_goal"), false, "tutor suggestions and data requests are never rendered");
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});
