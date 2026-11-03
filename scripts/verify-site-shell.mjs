import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builder = path.join(root, "scripts/build-site-shell.mjs");

test("build-time shell creates four direct navigation destinations and one account control", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "kv-shell-"));
  try {
    await mkdir(path.join(fixture, "content"), { recursive: true });
    for (const name of ["navigation.json","routes.json","knowledge.json"]) await cp(path.join(root,"content",name),path.join(fixture,"content",name));
    await mkdir(path.join(fixture,"knowledge","promise"),{recursive:true});
    await writeFile(path.join(fixture,"index.html"), '<!doctype html><html><head></head><body data-root="./"><header class="navwrap"><nav class="navbar"><a class="mark" href="./">Old</a><div class="navlinks">old links</div><button id="mobile-menu">Menu</button></nav></header><main></main><footer class="sitefooter"></footer><script defer src="./assets/js/v2.js"></script></body></html>');
    await writeFile(path.join(fixture,"knowledge","promise","index.html"), '<!doctype html><html><head></head><body data-root="../../"><header class="sitehead"><nav class="sitehead-inner"><a class="brand" href="../../">Old</a></nav></header><main></main></body></html>');
    await writeFile(path.join(fixture,"custom.html"), '<!doctype html><html><body><header class="workbench-toolbar">Keep me</header></body></html>');
    execFileSync(process.execPath,[builder,"--root",fixture],{stdio:"pipe"});
    const home = await readFile(path.join(fixture,"index.html"),"utf8");
    const topic = await readFile(path.join(fixture,"knowledge","promise","index.html"),"utf8");
    const custom = await readFile(path.join(fixture,"custom.html"),"utf8");
    assert.equal((home.match(/data-group-id=/g)||[]).length,4);
    assert.equal((home.match(/id="kv-global-account"/g)||[]).length,1);
    assert.ok(home.includes('data-route-id="learning.start"'));
    assert.ok(home.includes('href="./start/"'));
    assert.ok(home.includes('data-group-id="knowledge"'));
    assert.ok(home.includes('data-group-id="progress"'));
    assert.doesNotMatch(home, /kv-nav-toggle|kv-nav-submenu/);
    assert.ok(home.includes('data-kv-shell-version="4.0"'));
    assert.ok(home.includes('href="./assets/css/site-architecture.css"'));
    assert.equal((topic.match(/id="kv-global-account"/g)||[]).length,1);
    assert.ok(topic.includes('href="../../start/"'));
    assert.ok(custom.includes("workbench-toolbar"));
    assert.ok(custom.includes('data-kv-shell-version="4.0"'));
    assert.equal((custom.match(/id="kv-global-account"/g)||[]).length,1);
  } finally { await rm(fixture,{recursive:true,force:true}); }
});

test("shell generation is idempotent and keeps the static navigation", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "kv-shell-repeat-"));
  try {
    await mkdir(path.join(fixture,"content"),{recursive:true});
    for (const name of ["navigation.json","routes.json","knowledge.json"]) await cp(path.join(root,"content",name),path.join(fixture,"content",name));
    await writeFile(path.join(fixture,"index.html"),'<html><head></head><body><header class="navwrap"><nav class="navbar"></nav></header></body></html>');
    execFileSync(process.execPath,[builder,"--root",fixture],{stdio:"pipe"});
    const first = await readFile(path.join(fixture,"index.html"),"utf8");
    execFileSync(process.execPath,[builder,"--root",fixture],{stdio:"pipe"});
    const second = await readFile(path.join(fixture,"index.html"),"utf8");
    assert.equal(second,first);
  } finally { await rm(fixture,{recursive:true,force:true}); }
});
