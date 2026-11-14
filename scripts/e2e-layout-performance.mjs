import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".svg":"image/svg+xml", ".ico":"image/x-icon" };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = resolve(root, pathname.slice(1) || "index.html");
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try { if ((await stat(file)).isDirectory()) file = resolve(file, "index.html"); }
    catch { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control":"no-store" });
    res.end(await readFile(file));
  } catch { res.writeHead(500).end(); }
});
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
const baseURL = "http://127.0.0.1:" + server.address().port;
test.after(() => new Promise(resolveClose => server.close(resolveClose)));

async function openPage(browser, path, viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers:"block" });
  await context.addInitScript(() => {
    globalThis.KNOWVERSE_BACKEND_CONFIG = { supabaseUrl:"", publishableKey:"" };
    window.__layoutPerf = { cls:0, lcp:0 };
    try {
      new PerformanceObserver(list => list.getEntries().forEach(entry => { if (!entry.hadRecentInput) window.__layoutPerf.cls += entry.value; }))
        .observe({ type:"layout-shift", buffered:true });
      new PerformanceObserver(list => list.getEntries().forEach(entry => { window.__layoutPerf.lcp = entry.startTime; }))
        .observe({ type:"largest-contentful-paint", buffered:true });
    } catch {}
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(baseURL + path, { waitUntil:"networkidle" });
  return { context, page, errors };
}

test("home and knowledge directory avoid late layout injection and redundant registry downloads", { timeout:60000 }, async () => {
  const browser = await chromium.launch({ headless:true });
  try {
    for (const path of ["/", "/knowledge/"]) {
      const { context, page, errors } = await openPage(browser, path, { width:390, height:844 });
      await page.waitForTimeout(300);
      const metrics = await page.evaluate(() => ({
        cls: Number(window.__layoutPerf.cls.toFixed(4)),
        bytes: performance.getEntriesByType("resource").reduce((sum, item) => sum + item.encodedBodySize, 0),
        manifestRequests: performance.getEntriesByType("resource").filter(item => /content\/(knowledge|works|learning-map|search-metadata)\.json/.test(item.name)).map(item => new URL(item.name).pathname),
        overflow: document.documentElement.scrollWidth > innerWidth,
        designSystem: Boolean(document.querySelector('link[href*="site-design-system.css"]')),
        knowledgeGraphCss: performance.getEntriesByType("resource").filter(item => item.name.includes("knowledge-graph.css")).map(item => new URL(item.name).pathname),
      }));
      assert.ok(metrics.cls < 0.1, path + " CLS " + JSON.stringify(metrics));
      assert.equal(metrics.overflow, false, path + " must not overflow horizontally");
      assert.equal(metrics.designSystem, true);
      if (path === "/") assert.deepEqual(metrics.knowledgeGraphCss, [], "homepage must not download relationship-card CSS when it does not render a knowledge graph");
      if (path === "/knowledge/") assert.equal(metrics.knowledgeGraphCss.length, 1, "knowledge directory retains its relationship surfaces");
      assert.deepEqual(metrics.manifestRequests, [], path + " must not refetch build-time registry content");
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
});

test("progress first load defers advanced analysis modules until the learner reaches that section", { timeout:60000 }, async () => {
  const browser = await chromium.launch({ headless:true });
  try {
    const { context, page, errors } = await openPage(browser, "/progress/", { width:1440, height:1000 });
    await page.waitForFunction(() => document.documentElement.dataset.learningProgressReady === "true");
    const initial = await page.evaluate(() => ({
      bytes: performance.getEntriesByType("resource").reduce((sum, item) => sum + item.encodedBodySize, 0),
      scripts: performance.getEntriesByType("resource").filter(item => item.initiatorType === "script").length,
      heavy: performance.getEntriesByType("resource").filter(item => /proactive-learning-engine|task-orchestrator|learner-profile|goal-manager/.test(item.name)).map(item => new URL(item.name).pathname),
      advancedOpen: document.querySelector("#proactive-learning")?.open,
    }));
    assert.ok(initial.bytes < 480000, "progress first-load decoded resource budget: " + JSON.stringify(initial));
    assert.ok(initial.scripts < 22, "progress first-load script budget: " + JSON.stringify(initial));
    assert.deepEqual(initial.heavy, [], "advanced modules must not be fetched before the user reaches advanced analysis");
    assert.equal(initial.advancedOpen, false);
    await page.locator("#review-plan").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => performance.getEntriesByType("resource").some(item => item.name.includes("proactive-learning-engine.mjs")), { timeout:15000 });
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test("mobile knowledge graph stays inside the page and supports horizontal node exploration", { timeout:60000 }, async () => {
  const browser = await chromium.launch({ headless:true });
  try {
    const { context, page, errors } = await openPage(browser, "/progress/", { width:390, height:844 });
    await page.waitForFunction(() => document.documentElement.dataset.learningProgressReady === "true");
    await page.locator("#knowledge-map").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector("#graph-canvas")?.querySelectorAll(".lp-node").length > 0, { timeout:15000 });
    const before = await page.evaluate(() => ({
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      clientWidth: document.querySelector(".lp-graph-scroll").clientWidth,
      scrollWidth: document.querySelector(".lp-graph-scroll").scrollWidth,
      nodes: document.querySelectorAll("#graph-canvas .lp-node").length,
    }));
    assert.ok(before.documentWidth <= before.viewport + 1, JSON.stringify(before));
    assert.ok(before.scrollWidth > before.clientWidth, "the graph must expose its own horizontal scroll area");
    await page.locator(".lp-graph-scroll").evaluate(element => { element.scrollLeft = element.scrollWidth; });
    const scrollLeft = await page.locator(".lp-graph-scroll").evaluate(element => element.scrollLeft);
    assert.ok(scrollLeft > 0, "users must be able to reach nodes beyond the initial mobile viewport");
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});


test("review and agent workspaces keep below-fold layout stable during async initialization", { timeout:60000 }, async () => {
  const browser = await chromium.launch({ headless:true });
  try {
    for (const viewport of [{ width:1440, height:960 }, { width:390, height:844 }]) {
      for (const path of ["/review/", "/agent/"]) {
        const { context, page, errors } = await openPage(browser, path, viewport);
        if (path === "/review/") {
          await page.waitForFunction(() => document.querySelectorAll("#target-list .rw-topic-group").length > 0);
        } else {
          await page.waitForFunction(() => document.querySelector("#la-workspace")?.hidden === false);
          assert.equal(await page.locator(".la-footer").getAttribute("hidden"), null, "agent footer should return after workspace initialization");
        }
        await page.waitForTimeout(150);
        const metrics = await page.evaluate(() => ({
          cls:Number(window.__layoutPerf.cls.toFixed(4)),
          overflow:document.documentElement.scrollWidth > innerWidth,
          historyTop:document.querySelector("#review-history")?.getBoundingClientRect().top ?? null,
          footerTop:document.querySelector("footer")?.getBoundingClientRect().top ?? null,
        }));
        assert.ok(metrics.cls < 0.1, path + " layout shift budget at " + viewport.width + "px: " + JSON.stringify(metrics));
        assert.equal(metrics.overflow, false, path + " must not overflow horizontally");
        assert.deepEqual(errors, [], path + " page errors");
        await context.close();
      }
    }
  } finally { await browser.close(); }
});

test("Agent defers proactive analysis until advanced insights are opened", { timeout:60000 }, async () => {
  const browser = await chromium.launch({ headless:true });
  try {
    const { context, page, errors } = await openPage(browser, "/agent/", { width:1440, height:960 });
    await page.waitForFunction(() => document.querySelector("#la-workspace")?.hidden === false);
    const initial = await page.evaluate(() => {
      const resources = performance.getEntriesByType("resource");
      return {
        jsBytes:resources.filter(item => item.initiatorType === "script").reduce((sum, item) => sum + item.encodedBodySize, 0),
        heavy:resources.filter(item => /proactive-learning-engine|learning-strategy-engine|learning-risk-engine|spaced-repetition-engine|next-best-action/.test(item.name)).map(item => new URL(item.name).pathname),
      };
    });
    assert.ok(initial.jsBytes < 370000, "Agent first-load JavaScript budget: " + JSON.stringify(initial));
    assert.deepEqual(initial.heavy, [], "proactive strategy and risk engines must remain unloaded while advanced insights are closed");
    await page.locator(".la-advanced-details > summary").click();
    await page.waitForFunction(() => performance.getEntriesByType("resource").some(item => item.name.includes("proactive-learning-engine.mjs")));
    await page.waitForFunction(() => !document.querySelector("#la-proactive-summary")?.textContent.includes("尚未计算"));
    const loaded = await page.evaluate(() => performance.getEntriesByType("resource").filter(item => /proactive-learning-engine|learning-strategy-engine|learning-risk-engine|spaced-repetition-engine|next-best-action/.test(item.name)).map(item => new URL(item.name).pathname));
    assert.ok(loaded.some(path => path.endsWith("/proactive-learning-engine.mjs")), JSON.stringify(loaded));
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test("manual plan regeneration loads proactive analysis on demand when advanced insights stay closed", { timeout:60000 }, async () => {
  const browser = await chromium.launch({ headless:true });
  try {
    const { context, page, errors } = await openPage(browser, "/agent/", { width:1440, height:960 });
    await page.waitForFunction(() => document.querySelector("#la-workspace")?.hidden === false);
    const initialHeavy = await page.evaluate(() => performance.getEntriesByType("resource").filter(item => item.name.includes("proactive-learning-engine.mjs")).length);
    assert.equal(initialHeavy, 0);
    await page.locator("#la-regenerate-plan").click();
    await page.waitForFunction(() => performance.getEntriesByType("resource").some(item => item.name.includes("proactive-learning-engine.mjs")));
    await page.waitForFunction(() => document.querySelector("#la-chat-status")?.textContent.includes("已生成计划提案"), null, { timeout:20000 });
    assert.equal(await page.locator(".la-advanced-details").evaluate(element => element.open), false, "plan generation must not force open the advanced workspace");
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});
