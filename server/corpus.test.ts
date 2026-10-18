import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { writeDataFiles } from '../pipeline/write-data';
import { basisVector, fixtureCorpus } from '../src/core/test-fixtures';
import { loadCorpusLookup } from './corpus';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'corpus-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('looks up passage metadata and text by chunk id from the published data files', async () => {
  const corpus = fixtureCorpus();
  const manifest = await writeDataFiles(corpus, new Map(corpus.chunks.map(c => [c.key, basisVector(c.id)])), { publicDir: join(root, 'public/data') });
  const lookup = await loadCorpusLookup(root);
  expect(lookup.version).toBe(manifest.corpus.file);
  expect(lookup.get(0)).toEqual({
    ticker: 'NVDA', fiscalYear: 2025, item: '1A', itemTitle: 'Risk Factors',
    text: 'Export controls restrict sales of data center products to China.',
  });
  expect(lookup.get(4)).toMatchObject({ ticker: 'AAPL', item: '7' });
  expect(lookup.get(99)).toBeUndefined();
});
