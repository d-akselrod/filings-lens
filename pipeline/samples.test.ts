import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { writeSamplesFile } from './samples';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'samplesfile-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('writeSamplesFile writes a hashed file, removes stale ones, and points the manifest at it', async () => {
  await mkdir(join(dir, 'v'), { recursive: true });
  await writeFile(join(dir, 'v', 'samples.00000000.json'), '{}');
  await writeFile(join(dir, 'v', 'corpus.11111111.json'), '{}');
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, chunkCount: 6 }));
  const manifest = await writeSamplesFile(dir, { schemaVersion: 1, samples: [{ question: 'Q?', vector: 'AAAA' }, { question: 'Q2?', vector: 'AAAA' }] });
  expect(manifest.samples).toMatchObject({ count: 2 });
  expect(manifest.chunkCount).toBe(6);
  expect((await readdir(join(dir, 'v'))).sort()).toEqual(['corpus.11111111.json', manifest.samples!.file.slice(2)].sort());
  expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))).toEqual(manifest);
});
