import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('platform boundary guard',()=>{assert.match(execFileSync(process.execPath,['tools/check-boundaries.mjs'],{cwd:root,encoding:'utf8'}),/^OK:/)});
test('transitive affected closure for a contract change',()=>{
 const r=JSON.parse(execFileSync(process.execPath,['tools/affected.mjs','packages/contracts/src/index.ts'],{cwd:root,encoding:'utf8'}));
 assert.deepEqual(r.affected,['api','contracts','domain','mobile','web']);
});
test('web-only change does not rebuild api or mobile',()=>{
 const r=JSON.parse(execFileSync(process.execPath,['tools/affected.mjs','apps/web/src/main.tsx'],{cwd:root,encoding:'utf8'}));
 assert.deepEqual(r.affected,['web']);
});
