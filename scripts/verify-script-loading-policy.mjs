import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pages = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes:true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.name.endsWith(".html")) pages.push(file);
  }
}
function attr(source, name) {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

await walk(root);
const failures = [];
const blockingConfigPages = [];
for (const page of pages) {
  const source = await readFile(page, "utf8");
  const scripts = [...source.matchAll(/<script\b([^>]*)>(?:[\s\S]*?)<\/script\s*>/gi)].map(match => ({
    attrs:match[1], src:attr(match[1], "src"), type:attr(match[1], "type"),
  }));
  const configIndex = scripts.findIndex(script => script.src?.endsWith("/backend/public-config.js"));
  if (configIndex >= 0) {
    blockingConfigPages.push(page);
    if (scripts.slice(0, configIndex).some(script => script.type?.toLowerCase() === "module")) {
      failures.push(`${page}: public config must appear before module scripts`);
    }
  }
  for (const script of scripts) {
    if (!script.src || script.type?.toLowerCase() === "module" || /\b(?:async|defer)\b/i.test(script.attrs)) continue;
    const target = resolve(dirname(page), script.src.split(/[?#]/, 1)[0]);
    const expectedConfig = resolve(root, "assets/js/backend/public-config.js");
    if (target !== expectedConfig) failures.push(`${page}: classic external script must be async/defer (${script.src})`);
  }
}
const configPath = resolve(root, "assets/js/backend/public-config.js");
const configBytes = (await stat(configPath)).size;
if (configBytes > 1024) failures.push(`public-config.js bootstrap grew beyond 1 KiB (${configBytes} bytes)`);
assert.deepEqual(failures, [], failures.join("\n"));
console.log(`Script loading policy verified: ${pages.length} HTML pages; ${blockingConfigPages.length} intentionally ordered public-config bootstraps (${configBytes} bytes); no other parser-blocking classic scripts.`);
