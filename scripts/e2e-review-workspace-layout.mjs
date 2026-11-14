import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, webkit } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".svg":"image/svg+xml" };
const server = createServer(async (req,res) => {
  try {
    let file = resolve(root, decodeURIComponent(new URL(req.url,"http://localhost").pathname).slice(1) || "index.html");
    if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
    if ((await stat(file)).isDirectory()) file = resolve(file,"index.html");
    res.writeHead(200,{"content-type":mime[extname(file)]||"application/octet-stream","cache-control":"no-store"});
    res.end(await readFile(file));
  } catch { res.writeHead(404).end("Not found"); }
});
await new Promise((resolveServer,reject) => { server.once("error",reject); server.listen(0,"127.0.0.1",resolveServer); });
const baseURL = "http://127.0.0.1:" + server.address().port;
test.after(() => new Promise(resolveServer => server.close(resolveServer)));

for (const [name, engine, viewport] of [
  ["Chromium desktop",chromium,{width:1440,height:960}],
  ["WebKit mobile",webkit,{width:390,height:844}],
]) {
  test(name + ": review targets are grouped by topic and the workspace flow adapts to available panels", { timeout:60000 }, async () => {
    const browser = await engine.launch({headless:true});
    try {
      const context = await browser.newContext({viewport});
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror",error=>errors.push(error.message));
      page.on("console",message=>{ if(message.type()==="error"&&!message.text().includes("favicon")) errors.push(message.text()); });
      await page.goto(baseURL + "/review/",{waitUntil:"domcontentloaded"});
      await page.waitForFunction(() => document.querySelectorAll(".rw-topic-group .rw-target").length > 0 || document.querySelector("#target-list .rw-empty")?.textContent.includes("载入失败"));
      const initial = await page.evaluate(() => ({
        groups: document.querySelectorAll(".rw-topic-group").length,
        targets: document.querySelectorAll(".rw-topic-group .rw-target").length,
        nav: [...document.querySelectorAll(".rw-workspace-nav a")].map(a=>({text:a.textContent.trim(),hidden:a.hidden})),
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }));
      assert.ok(initial.groups >= 1);
      assert.ok(initial.targets >= 1);
      assert.ok(initial.nav.some(item=>item.text.includes("选择知识目标")&&!item.hidden));
      assert.ok(initial.nav.some(item=>item.text.includes("复习记录")&&!item.hidden));
      assert.ok(initial.nav.find(item=>item.text.includes("独立验证")).hidden);
      assert.ok(initial.width <= initial.viewport,"review workspace must not overflow horizontally");
      await page.locator(".rw-topic-group .rw-target").first().click();
      await page.waitForFunction(() => !document.querySelector("#review-session").hidden);
      assert.equal(await page.locator("#question-title").textContent().then(value=>value.trim().length>0),true);
      assert.equal(await page.locator('.rw-workspace-nav a[data-target="review-session"]').isVisible(),true);
      assert.deepEqual(errors,[]);
      await context.close();
    } finally { await browser.close(); }
  });
}

for (const [slug, title] of [
  ["monorepo", "Monorepo"],
  ["react-native", "React Native"],
  ["ai-agents", "AI Agent"],
  ["finance", "金融学"],
]) {
  for (const [engineName, engine, viewport] of [
    ["desktop", chromium, {width:1440,height:960}],
    ["mobile", webkit, {width:390,height:844}],
  ]) {
    test("Knowledge topic " + slug + " " + engineName + ": content remains readable and panoramic media is deferred", {
      timeout:60000,
    }, async () => {
      const browser = await engine.launch({headless:true});
      try {
        const page = await browser.newPage({viewport});
        const errors = [];
        page.on("pageerror",error=>errors.push(error.message));
        await page.goto(baseURL + "/knowledge/" + slug + "/",{waitUntil:"domcontentloaded"});
        const snapshot = await page.evaluate(() => {
          const main = document.querySelector("main");
          const images = [...(main?.querySelectorAll(".atlas img, .atlas-figure img") || [])];
          return {
            heading: main?.querySelector("h1")?.innerText || "",
            imageCount: images.length,
            imageLoading: images.map(image=>image.loading),
            imageAlt: images.map(image=>image.alt.trim()),
            width: document.documentElement.scrollWidth,
            viewport: innerWidth,
            overflow: [...document.querySelectorAll("body *")].map(node=>({tag:node.tagName,cls:typeof node.className==="string"?node.className:"",id:node.id,right:Math.round(node.getBoundingClientRect().right),width:Math.round(node.getBoundingClientRect().width)})).filter(item=>item.right>innerWidth+1).slice(0,18),
            mainText: main?.innerText || "",
          };
        });
        assert.ok(snapshot.heading.includes(title),"topic title should be visible");
        assert.ok(snapshot.mainText.length > 180,"topic should retain substantive content");
        assert.ok(snapshot.imageCount >= 1,"topic should retain its knowledge atlas");
        assert.ok(snapshot.imageLoading.every(value=>value==="lazy"),"atlas media should not block initial content");
        assert.ok(snapshot.imageAlt.every(value=>value.length>4&&!value.includes("join(esc")),"atlas images need meaningful alt text");
        assert.ok(snapshot.width<=snapshot.viewport,"topic page must not overflow horizontally: " + JSON.stringify(snapshot.overflow));
        assert.deepEqual(errors,[]);
      } finally { await browser.close(); }
    });
  }
}
