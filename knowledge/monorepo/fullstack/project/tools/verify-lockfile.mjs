import { readFileSync, existsSync } from 'node:fs';
import { strict as assert } from 'node:assert';
const root = new URL('../', import.meta.url);
const file = new URL('../pnpm-lock.yaml', import.meta.url);
assert.ok(existsSync(file), 'pnpm-lock.yaml must be committed');
const raw = readFileSync(file, 'utf8');
assert.match(raw, /^lockfileVersion:\s*['"]?\d/m, 'Missing pnpm lockfile schema');
// pnpm 12 may write two YAML documents: the env document and the project graph.
// Validate the LAST document, otherwise an env-only lockfile might appear valid.
const sections = raw.split(/^---\s*$/m).map(s => s.trim()).filter(Boolean);
const projectDoc = sections.at(-1);
assert.match(projectDoc, /^importers:\s*$/m);
for (const name of ['apps/api:', 'apps/web:', 'apps/mobile:', 'packages/contracts:', 'packages/domain:']) {
  assert.ok(projectDoc.includes('  ' + name), `Missing project workspace importer ${name}`);
}
assert.match(projectDoc, /^  react@/m, 'Expected React package resolution in project document');
assert.match(projectDoc, /^  react-native@/m, 'Expected React Native package resolution in project document');
assert.match(projectDoc, /^  '@nestjs\/common@/m, 'Expected NestJS resolution in project document');
const lock = raw.match(/lockfileVersion:\s*['"]?([^'"\s]+)/)?.[1];
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url),'utf8'));
assert.equal(pkg.packageManager, 'pnpm@12.16.1');
console.log(`pnpm lockfile v${lock} contains all five workspace importers`);
