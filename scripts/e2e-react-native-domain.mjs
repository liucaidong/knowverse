import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

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
      response.writeHead(200, {"content-type":mime[extname(file)] || "application/octet-stream","cache-control":"no-store"});
      response.end(await readFile(file));
    } catch { response.writeHead(500).end("Internal error"); }
  });
  await new Promise((resolveServer,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolveServer);});
  return {server,baseURL:"http://127.0.0.1:"+server.address().port};
}
const {server,baseURL}=await startServer();
test.after(()=>new Promise(resolveServer=>server.close(resolveServer)));

test("React Native lab: phase tabs, step navigation and real checkpoint", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(baseURL+"/lab/experiments/rn-render-pipeline/",{waitUntil:"domcontentloaded"});
    await page.locator("#rn-step-title").waitFor();
    await page.locator('[data-phase="build"]').click();
    assert.equal(await page.locator("#rn-step-title").textContent(),"Hermes 生成字节码");
    await page.locator("#rn-next").click();
    assert.equal(await page.locator("#rn-step-title").textContent(),"Codegen 生成接口脚手架");
    await page.locator('[data-phase="runtime"]').click();
    assert.equal(await page.locator("#rn-step-title").textContent(),"Render：构建 React / Shadow Tree");
    await page.locator("#kv-learning-launcher").waitFor({state:"visible"});
    await page.locator("#kv-learning-launcher").click();
    await page.locator("#kv-learning-checkpoint").waitFor({state:"visible"});
    await page.locator('[data-option-id="b"]').click();
    await page.getByText("验证通过",{exact:false}).waitFor();
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test("React Native gallery: stage filtering and spatial node details", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(baseURL+"/gallery/exhibits/rn-new-architecture/",{waitUntil:"domcontentloaded"});
    await page.locator('[data-space-stage="runtime"]').click();
    await page.locator('[data-node="fabric"]').waitFor({state:"visible"});
    assert.match(await page.locator("#rn-node-title").textContent(),/Fabric/);
    await page.locator('[data-node="threads"]').click();
    assert.match(await page.locator("#rn-node-title").textContent(),/Thread model/);
    await page.locator("#kv-learning-launcher").waitFor({state:"visible"});
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test("React Native architecture quest: all six campaign steps create learning evidence", {timeout:60000}, async()=>{
  const registry=JSON.parse(await readFile(new URL("../content/challenges.json",import.meta.url),"utf8"));
  const quest=registry.challenges.find(item=>item.id==="rn-architecture-quest");
  assert.ok(quest);
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:960}});
    const page=await context.newPage();
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(baseURL+"/puzzles/worlds/rn-architecture-quest/",{waitUntil:"domcontentloaded"});
    await page.locator("#quest-title").waitFor();
    for(const step of quest.steps){
      await page.getByText(step.title,{exact:true}).waitFor();
      const answerIndex=step.options.findIndex(option=>option.id===step.answer);
      assert.ok(answerIndex>=0,"Missing correct answer for "+step.id);
      await page.locator(".rn-quest-option").nth(answerIndex).click();
      await page.locator("#quest-submit").click();
      if(step!==quest.steps.at(-1)){
        const nextTitle=quest.steps[quest.steps.indexOf(step)+1].title;
        await page.getByText(nextTitle,{exact:true}).waitFor();
      }
    }
    await page.locator("#quest-success").waitFor({state:"visible"});
    const snapshot=await page.evaluate(()=>JSON.parse(localStorage.getItem("knowverse:learning-progress:v2")||"{}"));
    const completed=(snapshot.events||[]).filter(event=>event.challengeId==="rn-architecture-quest"&&event.type==="completed");
    assert.equal(completed.length,6);
    assert.deepEqual(errors,[]);
    await context.close();
  } finally { await browser.close(); }
});
