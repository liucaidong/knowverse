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
    await page.locator("#plan-actions .lp-plan-card").first().waitFor({ state:"visible" });
    await page.locator("#plan-time-budget").selectOption("40");
    const firstCard = page.locator("#plan-actions .lp-plan-card").first();
    const firstCompetency = (await firstCard.locator("h3").textContent()).trim();
    assert.equal(firstCompetency, "thenable 解析与 Promise 采用");
    assert.match(await page.locator("#plan-summary").textContent(), /今日安排/);
    await firstCard.getByRole("button", { name:"完成此学习步骤" }).click();
    await page.waitForFunction(() => {
      const data = JSON.parse(localStorage.getItem("knowverse:learning-progress:v2") || "{}");
      return (data.events || []).some(event => event.type === "plan_action_completed");
    });
    const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem("knowverse:learning-progress:v2")));
    assert.equal(snapshot.events.filter(event => event.type === "plan_action_completed").length, 1);
    assert.equal(snapshot.events.some(event => event.type === "completed" || event.type === "assessment_passed"), false);
    assert.equal(await page.locator("#hero-tested").textContent(), "0 / 9");
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
    await page.goto(baseURL + "/progress/", { waitUntil:"domcontentloaded" });
    await page.locator("#plan-actions .lp-plan-card").first().waitFor({ state:"visible" });
    await page.locator("#plan-time-budget").selectOption("15");
    assert.equal(await page.locator("#plan-actions .lp-plan-card").count(), 1);
    await page.locator("#plan-focus-topic").selectOption("monorepo");
    const preference = await page.evaluate(() => JSON.parse(localStorage.getItem("knowverse:learning-plan:preferences:v1")));
    assert.deepEqual(preference, { dailyMinutes:15, focusTopicId:"monorepo" });
    assert.equal((await page.locator("#plan-actions .lp-plan-card h3").first().textContent()).trim(), "工作区依赖声明");
    const box = await page.locator(".lp-plan-shell").boundingBox();
    assert.ok(box && box.width <= 390, "learning plan must fit the mobile viewport");
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});
