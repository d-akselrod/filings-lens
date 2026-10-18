import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { fetchWithProgress, loadData } from './load-data';
import type { LoadProgress } from './protocol';
import { dirFetch, writeFixtureData } from './test-data';

let dir: string;
let bare: string;
beforeAll(async () => {
  dir = await writeFixtureData({ withEval: true });
  bare = await writeFixtureData({ withEval: false });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(bare, { recursive: true, force: true });
});

test('fetchWithProgress returns the whole body and reports cumulative bytes per chunk', async () => {
  const seen: number[] = [];
  const bytes = await fetchWithProgress('/data/manifest.json', n => seen.push(n), dirFetch(dir, '/data').fn);
  expect(new TextDecoder().decode(bytes)).toBe(await readFile(join(dir, 'manifest.json'), 'utf8'));
  expect(seen).toHaveLength(3);
  expect(seen).toEqual([...seen].sort((a, b) => a - b));
  expect(seen.at(-1)).toBe(bytes.byteLength);
});

test('fetchWithProgress rejects on an HTTP error', async () => {
  await expect(fetchWithProgress('/data/v/missing.json', () => {}, dirFetch(dir, '/data').fn)).rejects.toThrow('(404)');
});

test('loadData reads the manifest past the HTTP cache, then the corpus and vectors, then eval and samples', async () => {
  const f = dirFetch(dir, '/data');
  const progress: LoadProgress[] = [];
  const out = await loadData('/data', p => progress.push(p), f.fn);
  expect(f.calls[0]).toMatchObject({ url: '/data/manifest.json', init: { cache: 'no-cache' } });
  const m = out.manifest;
  expect(f.calls.map(c => c.url).slice(1)).toEqual([m.corpus.file, m.vectors.file, m.eval!.file, m.samples!.file].map(p => `/data/${p}`));
  expect(out.corpus.chunks).toHaveLength(6);
  expect(out.vectors.byteLength).toBe(6 * 768 * 2);
  expect(out.evalFile?.questions.map(q => q.id)).toEqual(['q01']);
  expect(out.samplesFile?.samples).toHaveLength(1);

  expect(progress[0]).toEqual({ phase: 'manifest' });
  const downloads = progress.filter(p => p.phase === 'download');
  const total = m.corpus.bytes + m.vectors.bytes;
  expect(downloads.every(p => p.totalBytes === total)).toBe(true);
  const loaded = downloads.map(p => p.loadedBytes!);
  expect(loaded).toEqual([...loaded].sort((a, b) => a - b));
  expect(loaded.at(-1)).toBe(total);
});

test('download progress is reported at most once per percent, however small the network chunks', async () => {
  const progress: LoadProgress[] = [];
  await loadData('/data', p => progress.push(p), dirFetch(dir, '/data', 2000).fn);
  const downloads = progress.filter(p => p.phase === 'download');
  expect(downloads.length).toBeLessThanOrEqual(102);
  expect(downloads.at(-1)!.loadedBytes).toBe(downloads.at(-1)!.totalBytes);
});

test('loadData without eval or samples in the manifest returns nulls for them', async () => {
  const f = dirFetch(bare, '/data');
  const out = await loadData('/data', () => {}, f.fn);
  expect(out.evalFile).toBeNull();
  expect(out.samplesFile).toBeNull();
  expect(f.calls).toHaveLength(3);
});

test('a manifest 404 rejects with a readable error', async () => {
  await expect(loadData('/data', () => {}, dirFetch(dir, '/elsewhere').fn)).rejects.toThrow('Could not load manifest (404)');
});
