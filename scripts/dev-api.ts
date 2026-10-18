/** Local stand-in for the Vercel functions: npm run dev:api (DEV_COUNTRY=DE to simulate a restricted visitor). */
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { getDeps } from '../server/deps.js';
import { handleAnswer, handleEmbed, handleStatus } from '../server/handlers.js';

try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local: the handlers report missing_key
}

const routes: Record<string, typeof handleStatus> = { '/api/status': handleStatus, '/api/embed': handleEmbed, '/api/answer': handleAnswer };
const PORT = 8787;

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const handler = routes[url.pathname];
  if (!handler) {
    res.writeHead(404).end();
    return;
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
  headers.set('x-vercel-ip-country', process.env.DEV_COUNTRY ?? 'US');
  headers.set('x-real-ip', req.socket.remoteAddress ?? 'unknown');
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>) : undefined,
    duplex: 'half',
  } as RequestInit);
  const response = await handler(request, getDeps());
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) Readable.fromWeb(response.body as unknown as NodeReadableStream).pipe(res);
  else res.end();
}).listen(PORT, () => console.log(`API on http://localhost:${PORT} (country ${process.env.DEV_COUNTRY ?? 'US'})`));
