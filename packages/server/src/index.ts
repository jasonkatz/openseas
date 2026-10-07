import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { World } from './world';

const PORT = Number(process.env.PORT ?? 8787);
const here = resolve(fileURLToPath(import.meta.url), '..');
const DATA_PATH = process.env.TIDEBOUND_DATA ?? resolve(here, '../../..', 'data', 'world.json');
const STATIC_DIR = process.env.TIDEBOUND_STATIC ?? resolve(here, '../../client/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

const world = new World(DATA_PATH);
world.bots.spawn(Number(process.env.TIDEBOUND_BOTS ?? 8));

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, online: world.byPirate.size, pirates: Object.keys(world.data.pirates).length, ships: Object.keys(world.data.ships).length }));
    return;
  }
  // Static client (production).
  if (existsSync(STATIC_DIR)) {
    let file = join(STATIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, 'index.html');
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable' });
      res.end(body);
      return;
    } catch { /* fallthrough */ }
  }
  res.writeHead(404);
  res.end('Tidebound server. Client not built; run `pnpm dev`.');
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  const session = world.connect(ws);
  ws.on('message', (data) => world.handle(session, data.toString()));
  ws.on('close', () => world.disconnect(session));
  ws.on('error', () => world.disconnect(session));
});

setInterval(() => world.tick(), 100);
setInterval(() => world.store.flush(), 10000);

server.listen(PORT, () => {
  console.log(`⚓ Tidebound server listening on http://localhost:${PORT} (ws at /ws)`);
  console.log(`   data: ${DATA_PATH}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => { world.store.flush(); process.exit(0); });
}
