import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const mime={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml"};
async function startServer(){
  const server=createServer(async(request,response)=>{
    try{
      const pathname=decodeURIComponent(new URL(request.url,"http://localhost").pathname);
      const relative=pathname.startsWith("/")?pathname.slice(1):pathname;
      let file=resolve(root,relative||"index.html");
      if(file!==root&&!file.startsWith(root+sep))return response.writeHead(403).end("Forbidden");
      try{if((await stat(file)).isDirectory())file=resolve(file,"index.html");}
      catch{return response.writeHead(404).end("Not found");}
      response.writeHead(200,{"content-type":mime[extname(file)]||"application/octet-stream","cache-control":"no-store"});
      response.end(await readFile(file));
    }catch{return response.writeHead(500).end("Internal error");}
  });
  await new Promise((resolveServer,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolveServer);});
  return {server,baseURL:"http://127.0.0.1:"+server.address().port};
}
const {server,baseURL}=await startServer();
test.after(()=>new Promise(resolveServer=>server.close(resolveServer)));

test("Monorepo ten-unit course renders current official source references",{timeout:60000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(baseURL+"/knowledge/monorepo/",{waitUntil:"domcontentloaded"});
    await page.goto(baseURL+"/knowledge/monorepo/unit-01/",{waitUntil:"domcontentloaded"});
    for(let i=1;i<=10;i++){
      await page.goto(baseURL+`/knowledge/monorepo/unit-${String(i).padStart(2,"0")}/`,{waitUntil:"domcontentloaded"});
      await page.getByRole("heading",{name:"官方资料与规范"}).waitFor();
      const officialLinks=page.locator('a[href^="https://"]');
      assert.ok(await officialLinks.count()>=2,`Unit ${i} must render official references`);
    }
    await page.goto(baseURL+"/knowledge/monorepo/unit-02/",{waitUntil:"domcontentloaded"});
    const body=await page.locator(".article").innerText();
    assert.match(body,/pnpm 12\.7\.0 起/);
    assert.match(body,/merge-base/);
    assert.match(body,/浅克隆/);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
