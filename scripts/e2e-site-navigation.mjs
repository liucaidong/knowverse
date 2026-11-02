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

test("desktop navigation has one static shell, nested menus and one global account", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(url+"/knowledge/promise/",{waitUntil:"networkidle"});
    assert.equal(await page.locator("#kv-global-account").count(),1);
    assert.equal(await page.locator(".kv-nav-group").count(),3);
    assert.equal(await page.locator(".kv-account-quick-login").count(),0);
    const toggle=page.locator('[data-group-id="experience"] .kv-nav-toggle');
    await toggle.click();
    assert.equal(await page.locator("#kv-menu-experience").isVisible(),true);
    await page.getByRole("link",{name:"01 · 原理实验室"}).click();
    await page.waitForURL("**/lab/");
    // The shared shell is loaded by an asynchronous module after navigation; wait for
    // its current-route hydration rather than racing the URL transition.
    await page.waitForFunction(
      () => document.querySelector('[data-group-id="experience"] .kv-nav-link')?.getAttribute("aria-current") === "page",
      null,
      { timeout: 5000 }
    );
    assert.equal(await page.locator('[data-group-id="experience"] .kv-nav-link').getAttribute("aria-current"),"page");
    await page.locator("#kv-global-account > summary").click();
    assert.equal(await page.locator(".kv-account-panel").isVisible(),true);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test("mobile Chromium drawer expands nested routes without double toggling", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(url+"/",{waitUntil:"networkidle"});
    await page.locator("#mobile-menu").click();
    assert.equal(await page.locator("#kv-site-navigation").isVisible(),true);
    await page.locator('[data-group-id="knowledge"] .kv-nav-toggle').click();
    assert.equal(await page.locator("#kv-menu-knowledge").isVisible(),true);
    await page.getByRole("link",{name:"JavaScript · Promise",exact:true}).click();
    await page.waitForURL("**/knowledge/promise/");
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test("navigation and secondary routes remain visible with JavaScript disabled", {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
    const page=await context.newPage();
    await page.goto(url+"/knowledge/",{waitUntil:"domcontentloaded"});
    assert.equal(await page.locator(".kv-static-shell").count(),1);
    assert.equal(await page.locator(".kv-nav-group").count(),3);
    assert.equal(await page.getByRole("link",{name:"JavaScript · Promise",exact:true}).isVisible(),true);
    assert.equal(await page.getByRole("link",{name:"独立复习工作台",exact:true}).isVisible(),true);
    assert.equal(await page.locator("#kv-global-account").count(),1);
    await context.close();
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
