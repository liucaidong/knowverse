import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, cp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builder = path.join(root, "scripts/build-public-content.mjs");
const requiredContent = ["knowledge.json","works.json","learning-map.json","learning-checkpoints.json","review-assessments.json","search-metadata.json","concepts.json","sources.json","routes.json"];
const pages = ["index.html","knowledge/index.html","provenance/index.html"];

test("public builder renders canonical topic catalogues, home portal, provenance and all Concept routes", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "kv-public-content-"));
  try {
    await mkdir(path.join(fixture,"content"),{recursive:true});
    for (const name of requiredContent) await cp(path.join(root,"content",name),path.join(fixture,"content",name));
    for (const rel of pages) {
      await mkdir(path.dirname(path.join(fixture,rel)),{recursive:true});
      await cp(path.join(root,rel),path.join(fixture,rel));
    }
    execFileSync(process.execPath,[builder,"--root",fixture],{stdio:"pipe"});
    const home = await readFile(path.join(fixture,"index.html"),"utf8");
    const atlas = await readFile(path.join(fixture,"knowledge/index.html"),"utf8");
    const provenance = await readFile(path.join(fixture,"provenance/index.html"),"utf8");
    const manifest = JSON.parse(await readFile(path.join(fixture,"content/concepts.json"),"utf8"));
    assert.ok(home.includes('data-kv-home-portal="true"'));
    assert.equal((home.match(/class="kv-home-action primary"/g)||[]).length,1);
    assert.equal((home.match(/class="kv-home-secondary"/g)||[]).length,1);
    const secondary = home.match(/<div class="kv-home-secondary">([\s\S]*?)<\/div>/)?.[1] || "";
    assert.equal((secondary.match(/<a\s+href=/g)||[]).length,2);
    assert.ok(home.includes('href="./start/"'));
    assert.equal((home.match(/data-knowledge-catalog=/g)||[]).length,0);
    assert.equal((atlas.match(/class="topic-card"/g)||[]).length,12);
    assert.ok(atlas.includes("<strong>12</strong>"));
    assert.ok(provenance.includes('data-kv-provenance-registry="true"'));
    assert.ok(provenance.includes("SOURCE REGISTRY / 17 RECORDS"));
    assert.ok(provenance.includes("CONTENT ONLY"));
    for (const concept of manifest.concepts) {
      const page = await readFile(path.join(fixture,"concept",concept.id,"index.html"),"utf8");
      assert.ok(page.includes("稳定 ID：" + concept.id));
      assert.ok(page.includes("KNOWLEDGE GRAPH"));
      assert.ok(page.includes("SOURCES & REFERENCES"));
    }
    assert.equal(manifest.concepts.length,19);
  } finally { await rm(fixture,{recursive:true,force:true}); }
});

test("public content generation is deterministic and does not duplicate the home or provenance portal", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "kv-public-repeat-"));
  try {
    await mkdir(path.join(fixture,"content"),{recursive:true});
    for (const name of requiredContent) await cp(path.join(root,"content",name),path.join(fixture,"content",name));
    for (const rel of pages) {
      await mkdir(path.dirname(path.join(fixture,rel)),{recursive:true});
      await cp(path.join(root,rel),path.join(fixture,rel));
    }
    execFileSync(process.execPath,[builder,"--root",fixture],{stdio:"pipe"});
    const sample = ["index.html","knowledge/index.html","provenance/index.html","concept/promise.state-model/index.html"];
    const first = await Promise.all(sample.map(rel=>readFile(path.join(fixture,rel),"utf8")));
    execFileSync(process.execPath,[builder,"--root",fixture],{stdio:"pipe"});
    const second = await Promise.all(sample.map(rel=>readFile(path.join(fixture,rel),"utf8")));
    assert.deepEqual(second,first);
    assert.equal((second[0].match(/data-kv-home-portal/g)||[]).length,1);
    assert.equal((second[2].match(/data-kv-provenance-registry/g)||[]).length,1);
  } finally { await rm(fixture,{recursive:true,force:true}); }
});
