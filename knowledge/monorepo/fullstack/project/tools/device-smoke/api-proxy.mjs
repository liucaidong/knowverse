/** CI-only loopback proxy: asserts the mobile app reached the real NestJS API.
 * Failure injection is deliberately disabled unless KV_DEVICE_TEST_MODE=1.
 * Never deploy this service or accept its control endpoint on a public interface.
 */
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const logPath = process.env.KV_DEVICE_HITS_FILE ?? '/tmp/kv-device-hits.log';
const port = Number(process.env.KV_DEVICE_PROXY_PORT ?? 3001);
const upstream = process.env.KV_DEVICE_API_URL ?? 'http://127.0.0.1:3000';
const testMode = process.env.KV_DEVICE_TEST_MODE === '1';
const scenarios = new Set(['ok', 'http-503', 'malformed-json']);
const count = { valid: 0, rejected: 0, malformed: 0 };
let scenario = 'ok';
mkdirSync(dirname(logPath), { recursive: true });
writeFileSync(logPath, '', { flag: 'a' });
const record = (type) => appendFileSync(logPath, `${new Date().toISOString()} ${type}\n`);
const configuredDelay = Number(process.env.KV_DEVICE_RESPONSE_DELAY_MS ?? 4500);
const responseDelay = Number.isFinite(configuredDelay) ? Math.max(0, Math.min(configuredDelay, 5000)) : 4500;
const delay = () => testMode ? new Promise(resolve => setTimeout(resolve, responseDelay)) : Promise.resolve();
const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
};
const loopback = (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);

const server = createServer(async (req, res) => {
  if (req.url === '/__ready' && req.method === 'GET') { res.writeHead(200); res.end('device-proxy-ready'); return; }
  if (req.url === '/__state' && req.method === 'GET' && testMode && loopback(req.socket.remoteAddress)) {
    json(res, 200, { scenario, ...count }); return;
  }
  if (req.url === '/__control' && req.method === 'POST' && testMode && loopback(req.socket.remoteAddress)) {
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 256) throw Error('Body too large');
      }
      const { mode } = JSON.parse(body);
      if (!scenarios.has(mode)) { json(res, 400, { error: 'Unsupported mode' }); return; }
      scenario = mode;
      record(`scenario:${scenario}`);
      json(res, 200, { scenario });
    } catch { json(res, 400, { error: 'Malformed control message' }); }
    return;
  }
  if (req.method !== 'GET' || req.url !== '/api/lessons') {
    json(res, 404, { error: 'Unknown path' }); return;
  }
  if (scenario === 'http-503') {
    count.rejected++;
    record('injected-http-503');
    await delay();
    json(res, 503, { error: 'E2E-injected service unavailable' });
    return;
  }
  if (scenario === 'malformed-json') {
    count.malformed++;
    record('injected-malformed-json');
    await delay();
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end('{invalid-json');
    return;
  }
  try {
    const reply = await fetch(`${upstream}/api/lessons`, { signal: AbortSignal.timeout(8000) });
    const body = await reply.text();
    if (reply.ok) {
      try {
        const result = JSON.parse(body);
        const levels = new Set(['foundation', 'architecture', 'practice']);
        if (result.revision === 1 && Array.isArray(result.lessons) && result.lessons.length === 3
          && result.lessons.every(x => typeof x.id === 'string' && x.id.length > 0
            && typeof x.title === 'string' && levels.has(x.level)
            && Number.isInteger(x.minutes) && x.minutes > 0)) {
          count.valid++;
          record('valid-api-hit');
        } else {
          record('invalid-api-contract');
        }
      } catch {
        record('invalid-upstream-json');
      }
    }
    if (reply.ok) await delay();
    res.writeHead(reply.status, {
      'content-type': reply.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store'
    });
    res.end(body);
  } catch (error) {
    count.rejected++;
    record('upstream-failed');
    json(res, 502, { error: String(error) });
  }
});
server.listen(port, '127.0.0.1', () => console.log(`KV CI proxy on 127.0.0.1:${port} -> ${upstream}`));
