import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function freePort() {
  const srv = createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise(r => srv.close(r));
  return port;
}
async function waitReady(url) {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* startup */ }
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`Proxy failed to start: ${url}`);
}

test('Device proxy logs only valid API responses, not arbitrary HTTP 200 bodies', async () => {
  let response = { revision: 1, lessons: [{ id: 'a', title:'A', level:'foundation', minutes:5 }, { id: 'b', title:'B', level:'practice', minutes:10 }, { id: 'c', title:'C', level:'architecture', minutes:15 }] };
  const upstream = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(response)); });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  const upPort = upstream.address().port;
  const proxyPort = await freePort();
  const dir = await mkdtemp(join(tmpdir(), 'kv-proxy-'));
  const log = join(dir, 'hits.log');
  const child = spawn(process.execPath, ['tools/device-smoke/api-proxy.mjs'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, KV_DEVICE_API_URL: `http://127.0.0.1:${upPort}`, KV_DEVICE_PROXY_PORT: String(proxyPort), KV_DEVICE_HITS_FILE: log },
    stdio: 'ignore',
  });
  try {
    await waitReady(`http://127.0.0.1:${proxyPort}/__ready`);
    const good = await fetch(`http://127.0.0.1:${proxyPort}/api/lessons`);
    assert.equal(good.status, 200);
    assert.equal((await good.json()).lessons.length, 3);
    assert.match(await readFile(log, 'utf-8'), /valid-api-hit/);
    response = { revision: 99, lessons: [] };
    const invalid = await fetch(`http://127.0.0.1:${proxyPort}/api/lessons`);
    assert.equal(invalid.status, 200); // Transport success is not contract success.
    const hits = await readFile(log, 'utf-8');
    assert.equal((hits.match(/valid-api-hit/g) || []).length, 1);
    assert.equal((hits.match(/invalid-api-contract/g) || []).length, 1);
    assert.equal((await fetch(`http://127.0.0.1:${proxyPort}/wrong`)).status, 404);
  } finally {
    child.kill('SIGTERM');
    upstream.close();
    await rm(dir, { recursive: true, force: true });
  }
});
