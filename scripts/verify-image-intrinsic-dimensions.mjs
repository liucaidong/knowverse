import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const htmlFiles = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes:true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.name.endsWith(".html")) htmlFiles.push(file);
  }
}
function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

await walk(root);
let imageCount = 0;
const failures = [];
for (const page of htmlFiles) {
  const source = await readFile(page, "utf8");
  for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = attribute(tag, "src");
    if (!src || /^(?:https?:|data:|blob:|\/\/)/i.test(src)) continue;
    imageCount++;
    const width = Number(attribute(tag, "width"));
    const height = Number(attribute(tag, "height"));
    if (!(width > 0 && height > 0)) failures.push(`${page}: image missing intrinsic width/height (${src})`);
    if (attribute(tag, "decoding") !== "async") failures.push(`${page}: image missing decoding=async (${src})`);
    const target = resolve(dirname(page), src.split(/[?#]/, 1)[0]);
    if (target !== root && !target.startsWith(root + sep)) failures.push(`${page}: image path escapes site root (${src})`);
    else {
      try { if (!(await stat(target)).isFile()) failures.push(`${page}: image source is not a file (${src})`); }
      catch { failures.push(`${page}: local image source does not exist (${src})`); }
    }
  }
}
assert.deepEqual(failures, [], failures.join("\n"));
console.log(`Image policy verified: ${imageCount} local images across ${htmlFiles.length} HTML pages have intrinsic dimensions, async decoding, and valid local sources.`);
