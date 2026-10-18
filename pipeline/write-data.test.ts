import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { basisVector, fixtureCorpus } from '../src/core/test-fixtures';
import { DEFAULT_SETTINGS, type Manifest } from '../src/core/types';
import { loadEngineFromDisk } from './node-data';
import { BudgetError, writeDataFiles } from './write-data';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'data-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const vectors = () => new Map(fixtureCorpus().chunks.map(c => [c.key, basisVector(c.id)]));

test('written data files load back into a working search engine', async () => {
  const manifest = await writeDataFiles(fixtureCorpus(), vectors(), { publicDir: dir });
  expect(manifest).toMatchObject({ schemaVersion: 1, chunkCount: 6, dims: 768, vectorEncoding: 'f16le', embeddingModel: 'nvidia/nemotron-3-embed-1b:free' });
  expect(manifest.corpus.file).toMatch(/^v\/corpus\.[0-9a-f]{8}\.json$/);
  expect(manifest.vectors).toMatchObject({ bytes: 6 * 1536 });
  expect(manifest.vectors.file).toMatch(/^v\/vectors\.[0-9a-f]{8}\.f16$/);
  const { engine } = await loadEngineFromDisk(dir);
  const r = await engine.search({ text: 'services revenue', vector: basisVector(4) }, { ...DEFAULT_SETTINGS, rerank: false });
  expect(r.results[0]!.chunkId).toBe(4);
});

test('replaces stale hashed files and keeps eval and samples entries in the manifest', async () => {
  await mkdir(join(dir, 'v'), { recursive: true });
  await writeFile(join(dir, 'v', 'corpus.deadbeef.json'), '{}');
  await writeFile(join(dir, 'v', 'vectors.deadbeef.f16'), '');
  await writeFile(join(dir, 'v', 'eval.cafef00d.json'), '{}');
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ eval: { file: 'v/eval.cafef00d.json', count: 40 } }));
  const manifest = await writeDataFiles(fixtureCorpus(), vectors(), { publicDir: dir });
  const files = await readdir(join(dir, 'v'));
  expect(files).not.toContain('corpus.deadbeef.json');
  expect(files).not.toContain('vectors.deadbeef.f16');
  expect(files).toContain('eval.cafef00d.json');
  expect(manifest.eval).toEqual({ file: 'v/eval.cafef00d.json', count: 40 });
  const onDisk = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Manifest;
  expect(onDisk).toEqual(manifest);
});

test('refuses to write over the first-visit budget', async () => {
  await expect(writeDataFiles(fixtureCorpus(), vectors(), { publicDir: dir, budgetBytes: 1000 })).rejects.toBeInstanceOf(BudgetError);
  await expect(readdir(dir)).resolves.toEqual([]);
});

test('names the chunk whose vector is missing or malformed', async () => {
  const missing = vectors();
  const key = fixtureCorpus().chunks[3]!.key;
  missing.delete(key);
  await expect(writeDataFiles(fixtureCorpus(), missing, { publicDir: dir })).rejects.toThrow(key);
  const short = vectors();
  short.set(key, new Float32Array(10));
  await expect(writeDataFiles(fixtureCorpus(), short, { publicDir: dir })).rejects.toThrow(key);
});
