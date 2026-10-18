import { rm } from 'node:fs/promises';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { openDb } from '../core/load';
import { basisVector } from '../core/test-fixtures';
import { DEFAULT_SETTINGS } from '../core/types';
import type { InitResult, LoadProgress, WorkerApi } from './protocol';
import { createWorkerApi } from './search.worker';
import { dirFetch, writeFixtureData } from './test-data';

const dirs: string[] = [];
let api: WorkerApi;
let init: InitResult;
const progress: LoadProgress[] = [];

beforeAll(async () => {
  const dir = await writeFixtureData({ withEval: true });
  dirs.push(dir);
  api = createWorkerApi({ baseUrl: '/data', fetch: dirFetch(dir, '/data').fn });
  init = await api.init(p => progress.push(p));
}, 30_000);
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

test('init reports each phase in order and returns the manifest, chunk count, facets and eval presence', () => {
  const phases = progress.map(p => p.phase).filter((p, i, all) => p !== all[i - 1]);
  expect(phases).toEqual(['manifest', 'download', 'database', 'keyword-index', 'vectors', 'ready']);
  const loaded = progress.filter(p => p.phase === 'download').map(p => p.loadedBytes!);
  expect(loaded).toEqual([...loaded].sort((a, b) => a - b));
  expect(loaded.at(-1)).toBe(init.manifest.corpus.bytes + init.manifest.vectors.bytes);
  expect(init).toMatchObject({ chunkCount: 6, hasEval: true, facets: { tickers: ['NVDA', 'AAPL'], fiscalYears: [2025, 2024] } });
});

test('search runs hybrid search and notes that no reranker is loaded yet', async () => {
  const r = await api.search({ text: 'export controls China', vector: basisVector(0) }, DEFAULT_SETTINGS);
  expect(r.results[0]?.chunkId).toBe(0);
  expect(r.notes).toContain('reranker-unavailable');
});

test('getChunks returns chunk views in the requested order', async () => {
  expect((await api.getChunks([3, 0])).map(c => [c.id, c.ticker])).toEqual([[3, 'AAPL'], [0, 'NVDA']]);
});

test('samples are decoded to 768-length vectors', async () => {
  const samples = await api.samples();
  expect(samples.map(s => s.question)).toEqual(['How does NVIDIA describe export controls?']);
  expect(samples[0]!.vector).toHaveLength(768);
  expect(samples[0]!.vector[0]).toBe(1);
});

test('scorecard maps gold keys to chunk ids and scores the current settings and each baseline', async () => {
  const ticks: number[] = [];
  const r = await api.scorecard({ ...DEFAULT_SETTINGS, rerank: false }, done => ticks.push(done));
  expect(r.rows.map(row => row.name)).toEqual(['current', 'vector', 'keyword', 'hybrid']);
  expect(r.rows.find(row => row.name === 'vector')!.recall5).toBe(1);
  expect(ticks.at(-1)).toBe(4);
});

test('without an eval set, scorecard rejects; a loaded reranker reorders the head of the results', async () => {
  const dir = await writeFixtureData({ withEval: false });
  dirs.push(dir);
  let loads = 0;
  const bare = createWorkerApi({
    baseUrl: '/data', fetch: dirFetch(dir, '/data').fn,
    loadReranker: async onProgress => {
      loads++;
      onProgress(1, 1);
      return async (_query, passages) => passages.map(p => (p.includes('iPhone') ? 1 : 0));
    },
  });
  expect(await bare.init(() => {})).toMatchObject({ hasEval: false });
  expect(await bare.samples()).toEqual([]);
  await expect(bare.scorecard(DEFAULT_SETTINGS, () => {})).rejects.toThrow('No evaluation set');

  await Promise.all([bare.loadReranker(() => {}), bare.loadReranker(() => {})]);
  expect(loads).toBe(1);
  const r = await bare.search({ text: 'China', vector: basisVector(0) }, DEFAULT_SETTINGS);
  expect(r.notes).not.toContain('reranker-unavailable');
  expect(r.results[0]).toMatchObject({ chunkId: 3, rerank: { rank: 1 } });
}, 30_000);

test('init starts opening the database before the data downloads finish', async () => {
  const dir = await writeFixtureData({ withEval: false });
  dirs.push(dir);
  const files = dirFetch(dir, '/data');
  const events: string[] = [];
  const overlapped = createWorkerApi({
    baseUrl: '/data',
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      events.push(String(input));
      return files.fn(input, init);
    }) as typeof fetch,
    openDb: () => {
      events.push('openDb');
      return openDb();
    },
  });
  await overlapped.init(() => {});
  expect(events.indexOf('openDb')).toBeGreaterThanOrEqual(0);
  expect(events.indexOf('openDb')).toBeLessThan(events.findIndex(e => e.includes('/v/vectors.')));
}, 30_000);

test('a failed download closes the database it had started opening', async () => {
  const close = vi.fn(async () => {});
  const failing = createWorkerApi({
    baseUrl: '/data', fetch: dirFetch('/nonexistent', '/data').fn, openDb: async () => ({ close }) as unknown as PGlite,
  });
  await expect(failing.init(() => {})).rejects.toThrow('Could not load manifest (404)');
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
});

test('a worker without a reranker loader says so', async () => {
  await expect(api.loadReranker(() => {})).rejects.toThrow('Reranker is not available');
});
