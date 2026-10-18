import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { fixtureCorpus } from '../src/core/test-fixtures';
import { embedWithCache, readCachedVectors } from './embed-runner';
import { subsetCorpus } from './subset';

test('subsetCorpus keeps whole filings and renumbers ids densely', () => {
  const sub = subsetCorpus(fixtureCorpus(), new Set([2, 0]));
  expect(sub.companies.map(c => [c.id, c.ticker])).toEqual([[0, 'NVDA'], [1, 'AAPL']]);
  expect(sub.filings.map(f => [f.id, f.companyId, f.fiscalYear])).toEqual([[0, 0, 2025], [1, 1, 2025]]);
  expect(sub.chunks.map(c => [c.id, c.filingId, c.item])).toEqual([[0, 0, '1A'], [1, 0, '7'], [2, 1, '1A'], [3, 1, '7'], [4, 1, '8']]);
  expect(sub.chunks[2]!.key).toBe(fixtureCorpus().chunks[3]!.key);
});

test('subsetCorpus drops companies left without filings', () => {
  const sub = subsetCorpus(fixtureCorpus(), new Set([2]));
  expect(sub.companies.map(c => [c.id, c.ticker])).toEqual([[0, 'AAPL']]);
  expect(sub.filings.map(f => f.companyId)).toEqual([0]);
});

test('readCachedVectors returns only texts already embedded, without calling the API', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cached-'));
  try {
    const items = [{ key: 'a', text: 'alpha' }, { key: 'b', text: 'beta' }];
    await embedWithCache(items, { apiKey: 'k', cacheDir: dir, embed: async (_k, texts) => texts.map(() => new Float32Array(768).fill(1)) });
    const found = await readCachedVectors([...items, { key: 'c', text: 'gamma' }], dir);
    expect([...found.keys()]).toEqual(['a', 'b']);
    expect(found.get('a')![0]).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
