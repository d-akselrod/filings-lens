import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

interface VercelConfig {
  framework?: string; buildCommand?: string; outputDirectory?: string;
  headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
}

const config = async () => JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8')) as VercelConfig;
const headersFor = (c: VercelConfig, source: string) => Object.fromEntries((c.headers?.find(h => h.source === source)?.headers ?? []).map(h => [h.key, h.value]));

test('Vercel builds the Vite app with the bundle check', async () => {
  expect(await config()).toMatchObject({ framework: 'vite', buildCommand: 'npm run build', outputDirectory: 'dist' });
});

test('every route is cross-origin isolated, so the reranker gets WASM threads in production too', async () => {
  expect(headersFor(await config(), '/(.*)')).toMatchObject({
    'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp',
  });
});

test('the manifest is revalidated, hashed data files are immutable, and the PGlite bundle is served compressible', async () => {
  const c = await config();
  expect(headersFor(c, '/data/manifest.json')).toEqual({ 'Cache-Control': 'no-cache' });
  expect(headersFor(c, '/data/v/(.*)')).toEqual({ 'Cache-Control': 'public, max-age=31536000, immutable' });
  expect(headersFor(c, '/assets/(.*).data')['Content-Type']).toMatch(/^text\/plain/);
});
