/** Device-only transparent HTTP proxy: proves the app reached the real local NestJS API. */
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const logPath = process.env.KV_DEVICE_HITS_FILE ?? '/tmp/kv-device-hits.log';
const port = Number(process.env.KV_DEVICE_PROXY_PORT ?? 3001);
const upstream = process.env.KV_DEVICE_API_URL ?? 'http://127.0.0.1:3000';
mkdirSync(dirname(logPath), { recursive: true });
const server = createServer(async (req, res) => {
  if (req.url === '/__ready') { res.writeHead(200); res.end('device-proxy-ready'); return; }
  if (req.method !== 'GET' || req.url !== '/api/lessons') { res.writeHead(404); res.end('Unknown path'); return; }
  try {
    const reply = await fetch(`${upstream}/api/lessons`, { signal: AbortSignal.timeout(8000) });
    const body = await reply.text();
    res.writeHead(reply.status, { 'content-type': reply.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' });
    res.end(body);
    // Count a hit only when API was actually reached, decoded, and returned HTTP 200.
    if (reply.ok) {
      const json = JSON.parse(body);
      const levels = new Set(['foundation', 'architecture', 'practice']);
      if (json.revision === 1 && Array.isArray(json.lessons) && json.lessons.length === 3
          && json.lessons.every(x => typeof x.id === 'string' && x.id.length > 0
            && typeof x.title === 'string' && levels.has(x.level)
            && Number.isInteger(x.minutes) && x.minutes > 0)) {
        appendFileSync(logPath, `${new Date().toISOString()} valid-api-hit\n`);
      }
    }
  } catch (err) { res.writeHead(502); res.end(String(err)); }
});
server.listen(port, '0.0.0.0', () => console.log(`KV device proxy on :${port} forwarding to ${upstream}`));
