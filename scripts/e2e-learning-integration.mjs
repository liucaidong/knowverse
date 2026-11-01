import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, webkit } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml"};
async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const relative = pathname.startsWith("/") ? pathname.slice(1) : pathname;
      let file = resolve(root, relative || "index.html");
      if (file !== root && !file.startsWith(root + sep)) return response.writeHead(403).end("Forbidden");
      try { if ((await stat(file)).isDirectory()) file = resolve(file, "index.html"); }
      catch { return response.writeHead(404).end("Not found"); }
      response.writeHead(200, {"content-type":mime[extname(file)] || "application/octet-stream","cache-control":"no-store"});
      response.end(await readFile(file));
    } catch { response.writeHead(500).end("Internal error"); }
  });
  await new Promise((resolveServer,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolveServer);});
  return {server,baseURL:"http://127.0.0.1:"+server.address().port};
}
const {server,baseURL}=await startServer();
test.after(()=>new Promise(resolveServer=>server.close(resolveServer)));

test("Chromium desktop: work activity and a successful checkpoint are recorded", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:960}});
    const page=await context.newPage();
    const errors=[]; page.on("pageerror",e=>errors.push(e.message));
    await page.goto(baseURL+"/lab/experiments/promise-identity/",{waitUntil:"domcontentloaded"});
    await page.locator("#kv-learning-launcher").waitFor({state:"visible"});
    await page.locator("#kv-learning-launcher").click();
    await page.locator("#kv-learning-checkpoint").waitFor({state:"visible"});
    await page.locator('[data-option-id="b"]').click();
    await page.getByText("验证通过 · 已记录独立证据").waitFor();
    const events=await page.evaluate(()=>JSON.parse(localStorage.getItem("knowverse:learning-progress:v2")).events);
    assert.ok(events.some(e=>e.type==="activity"&&e.stepId==="page_view"&&e.workId==="promise-identity"));
    assert.ok(events.some(e=>e.type==="assessment_passed"&&e.sessionType==="checkpoint"&&e.workId==="promise-identity"));
    assert.deepEqual(errors,[]);
    await context.close();
  } finally { await browser.close(); }
});

test("WebKit mobile: a wrong answer records a gap and links to targeted review", {timeout:60000}, async()=>{
  const browser=await webkit.launch({headless:true});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage();
    const errors=[]; page.on("pageerror",e=>errors.push(e.message));
    await page.goto(baseURL+"/knowledge/monorepo/labs/cache/",{waitUntil:"domcontentloaded"});
    await page.locator("#kv-learning-launcher").waitFor({state:"visible"});
    await page.locator("#kv-learning-launcher").click();
    await page.locator("#kv-learning-checkpoint").waitFor({state:"visible"});
    await page.locator('[data-option-id="a"]').click();
    await page.getByText("还需要补强这个概念").waitFor();
    await page.getByRole("link",{name:"前往针对性复习"}).waitFor();
    const events=await page.evaluate(()=>JSON.parse(localStorage.getItem("knowverse:learning-progress:v2")).events);
    assert.ok(events.some(e=>e.type==="attempt"&&e.correct===false&&e.gapId==="build-cache-input-coverage"));
    assert.deepEqual(errors,[]);
    await context.close();
  } finally { await browser.close(); }
});
