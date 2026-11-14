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

test("Chromium desktop: AI Agent topic links all four lessons and its Concept pages expose evidence-backed reviews", {
  timeout: 60_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error" && !message.text().includes("favicon.ico")) errors.push(message.text());
    });
    await page.goto(baseURL + "/knowledge/ai-agents/", { waitUntil: "domcontentloaded" });
    assert.equal(await page.locator(".article-card").count(), 4);
    await page.getByRole("link", { name: "工具调用闭环与 MCP 协议边界", exact: true }).click();
    await page.getByRole("heading", { name: "工具调用闭环与 MCP 协议边界" }).waitFor();
    await page.getByText(/function_call_output/).waitFor();
    await page.getByRole("link", { name: "Model Context Protocol Specification · 2026-07-28" }).waitFor();
    await page.goto(baseURL + "/knowledge/ai-agents/chapter-04/", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Agent 安全：不可信上下文、最小权限与人工确认" }).waitFor();
    await page.getByText(/间接注入/).waitFor();
    await page.goto(baseURL + "/concept/ai-agents.agent-tool-execution-contract/", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "工具调用与 MCP 执行契约" }).waitFor();
    await page.getByText("工具调用：应用侧执行边界").waitFor();
    await page.getByText("MCP：角色与能力边界").waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
  }
});

test("WebKit mobile: AI Agent security lesson and Concept detail fit a 390px viewport", {
  timeout: 60_000,
}, async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseURL + "/knowledge/ai-agents/chapter-04/", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Agent 安全：不可信上下文、最小权限与人工确认" }).waitFor();
    const lessonWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(lessonWidth.scroll <= lessonWidth.client, JSON.stringify(lessonWidth));
    await page.goto(baseURL + "/concept/ai-agents.agent-safety-governance/", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Agent 权限、同意与安全治理" }).waitFor();
    const conceptWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(conceptWidth.scroll <= conceptWidth.client, JSON.stringify(conceptWidth));
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
  }
});
