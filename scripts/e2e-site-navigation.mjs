import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = {
  ".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",
  ".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon",
};
async function startServer(){
  const server=createServer(async(req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
      let file = resolve(root, pathname.slice(1) || "index.html");
      if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403).end("Forbidden");return;}
      try{if((await stat(file)).isDirectory())file=resolve(file,"index.html");}
      catch{res.writeHead(404).end("Not found");return;}
      res.writeHead(200,{"content-type":mime[extname(file)]||"application/octet-stream","cache-control":"no-store"});
      res.end(await readFile(file));
    }catch{res.writeHead(500).end("Internal error");}
  });
  await new Promise((ok,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",ok);});
  return {server,url:"http://127.0.0.1:"+server.address().port};
}
const {server,url}=await startServer();
test.after(()=>new Promise(resolveClose=>server.close(resolveClose)));

test("desktop navigation exposes four direct destinations without nested menus", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(url+"/knowledge/promise/",{waitUntil:"networkidle"});
    assert.equal(await page.locator("#kv-global-account").count(),1);
    assert.equal(await page.locator(".kv-nav-group").count(),4);
    assert.equal(await page.locator(".kv-nav-toggle,.kv-nav-submenu").count(),0);
    assert.deepEqual(await page.locator(".kv-nav-group .kv-nav-link").allTextContents(),
      ["开始学习","知识库","实践中心","我的进度"]);
    const practice=page.locator('[data-group-id="experience"] .kv-nav-link');
    await practice.click();
    await page.waitForURL("**/works/");
    await page.waitForFunction(
      () => document.querySelector('[data-group-id="experience"] .kv-nav-link')?.getAttribute("aria-current")==="page",
      null,{timeout:5000}
    );
    assert.equal(await practice.getAttribute("aria-current"),"page");
    await page.goto(url+"/progress/",{waitUntil:"networkidle"});
    await page.waitForFunction(() => document.querySelector('[data-group-id="progress"] .kv-nav-link')?.getAttribute("aria-current")==="page");
    assert.equal(await page.locator('[data-group-id="start"] .kv-nav-link').getAttribute("aria-current"),null);
    assert.equal(await page.locator('[data-group-id="progress"] .kv-nav-link').getAttribute("aria-current"),"page");
    await page.locator("#kv-global-account > summary").click();
    assert.equal(await page.locator(".kv-account-panel").isVisible(),true);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test("mobile menu is one short direct-link list and closes after navigation", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(url+"/",{waitUntil:"networkidle"});
    await page.locator("#mobile-menu").click();
    assert.equal(await page.locator("#kv-site-navigation").isVisible(),true);
    assert.equal(await page.locator("#kv-site-navigation .kv-nav-link").count(),4);
    assert.equal(await page.locator("#kv-site-navigation .kv-nav-toggle,.kv-nav-submenu").count(),0);
    await page.locator('[data-group-id="knowledge"] .kv-nav-link').click();
    await page.waitForURL("**/knowledge/");
    assert.equal(await page.locator("#kv-site-navigation").evaluate(e=>e.classList.contains("open")),false);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test("all four destinations remain visible with JavaScript disabled", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
    const page=await context.newPage();
    await page.goto(url+"/knowledge/",{waitUntil:"domcontentloaded"});
    assert.equal(await page.locator(".kv-static-shell").count(),1);
    assert.equal(await page.locator(".kv-nav-group").count(),4);
    for(const label of ["开始学习","知识库","实践中心","我的进度"]){
      assert.equal(await page.getByRole("link",{name:label,exact:true}).isVisible(),true,label);
    }
    assert.equal(await page.locator("#kv-global-account").count(),1);
    await context.close();
  }finally{await browser.close();}
});

test("guided start page identifies one next action and opens the matching goal form", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(url+"/start/",{waitUntil:"networkidle"});
    await page.waitForFunction(()=>document.querySelector("#ls-focus")?.getAttribute("aria-busy")==="false");
    assert.match(await page.locator("#ls-focus-stage").innerText(),/第 1 步/);
    assert.match(await page.locator("#ls-next-title").innerText(),/告诉 KNOWVERSE/);
    assert.match(await page.locator("#ls-next-action").getAttribute("href"),/agent\/#la-learning-goals/);
    await page.locator("#ls-next-action").click();
    await page.waitForURL("**/agent/#la-learning-goals");
    await page.locator("#la-goal-title").waitFor({state:"visible",timeout:15000});
    assert.equal(await page.locator("#la-learning-goals").isVisible(),true);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test("guided start page fits a narrow mobile viewport without horizontal overflow", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(url+"/start/",{waitUntil:"networkidle"});
    await page.waitForFunction(()=>document.querySelector("#ls-focus")?.getAttribute("aria-busy")==="false");
    const metrics=await page.evaluate(()=>({
      viewport:document.documentElement.clientWidth,
      content:document.documentElement.scrollWidth,
      action:document.querySelector("#ls-next-action").getBoundingClientRect().width
    }));
    assert.ok(metrics.content<=metrics.viewport+1,JSON.stringify(metrics));
    assert.ok(metrics.action>120);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test("global search resolves a generated Concept into its canonical detail page", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(url+"/",{waitUntil:"networkidle"});
    await page.locator("#search-open").click();
    await page.locator("#search-input").fill("thenable 解析与 Promise 采用");
    const result=page.getByRole("link",{name:/thenable 解析与 Promise 采用/}).first();
    await result.waitFor({state:"visible"});
    assert.match(await result.getAttribute("href"),/concept\/promise\.thenable-adoption\//);
    await result.click();
    await page.waitForURL("**/concept/promise.thenable-adoption/");
    assert.match(await page.locator("h1").first().innerText(),/thenable 解析与 Promise 采用/);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test("homepage keeps one learning CTA and moves the architecture overview into the knowledge directory", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    await page.goto(url+"/",{waitUntil:"networkidle"});
    assert.equal(await page.locator("[data-kv-architecture-overview]").count(),0);
    assert.equal(await page.locator("[data-kv-home-portal]").count(),1);
    assert.equal(await page.locator(".kv-home-action.primary").count(),1);
    assert.equal(await page.locator(".kv-home-action.primary").getAttribute("href"),"./start/");
    assert.equal(await page.locator(".kv-home-welcome,.kv-home-flow").count(),0);
    await page.goto(url+"/knowledge/",{waitUntil:"networkidle"});
    assert.equal(await page.locator("[data-kv-architecture-overview]").count(),1);
  }finally{await browser.close();}
});

test("Agent first-run state explains goal creation; progress starts with a closed advanced section", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(url+"/agent/",{waitUntil:"networkidle"});
    await page.locator("#la-goals-list .la-goals-empty-state").waitFor({state:"visible"});
    assert.match(await page.locator("#la-goals-list").innerText(),/你的学习目标会出现在这里/);
    await page.goto(url+"/progress/",{waitUntil:"networkidle"});
    await page.waitForFunction(()=>document.querySelector("#plan-actions")?.children.length>0);
    assert.equal(await page.locator("#proactive-learning").evaluate(e=>e.open),false);
    const order=await page.evaluate(()=>{
      const plan=document.querySelector("#adaptive-plan").getBoundingClientRect().top;
      const advanced=document.querySelector("#proactive-learning").getBoundingClientRect().top;
      return plan<advanced;
    });
    assert.equal(order,true);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test("mobile progress and agent have no horizontal layout overflow", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    for(const path of ["/progress/","/agent/"]){
      const page=await browser.newPage({viewport:{width:390,height:844}});
      const errors=[];page.on("pageerror",e=>errors.push(e.message));
      await page.goto(url+path,{waitUntil:"networkidle"});
      const widths=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
      assert.ok(widths.scroll<=widths.client+1,path+" "+JSON.stringify(widths));
      assert.deepEqual(errors,[]);
      await page.close();
    }
  }finally{await browser.close();}
});
