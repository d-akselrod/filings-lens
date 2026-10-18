import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { SearchEngine } from './engine';
import { loadCorpus, openDb } from './load';
import { basisVector, fixtureCorpus, fixtureVectors } from './test-fixtures';
import { DEFAULT_SETTINGS, type SearchSettings } from './types';

let db: PGlite;
let engine: SearchEngine;
const NO_RERANK: SearchSettings = { ...DEFAULT_SETTINGS, rerank: false };
const withFilters = (f: Partial<SearchSettings['filters']>): SearchSettings =>
  ({ ...NO_RERANK, filters: { ...NO_RERANK.filters, ...f } });

beforeAll(async () => {
  db = await openDb();
  await loadCorpus(db, fixtureCorpus(), fixtureVectors());
  engine = await SearchEngine.open(db);
});
afterAll(async () => {
  await db.close();
});

test('opens with one vector per chunk', () => {
  expect(engine.count).toBe(6);
});

test('hybrid search ranks the chunk that wins both retrievers first', async () => {
  const r = await engine.search({ text: 'export controls china', vector: basisVector(0) }, NO_RERANK);
  expect(r.usedMode).toBe('hybrid');
  expect(r.results[0]).toMatchObject({ chunkId: 0, finalRank: 1, vector: { rank: 1 }, keyword: { rank: 1 } });
  expect(r.results.map(x => x.chunkId)).toEqual([0, 2, 3, 1, 4, 5]);
  expect(r.notes).toEqual([]);
});

test('no query vector falls back to keyword search', async () => {
  const r = await engine.search({ text: 'export controls china', vector: null }, NO_RERANK);
  expect(r.usedMode).toBe('keyword');
  expect(r.notes).toContain('no-query-vector');
  expect(r.results.map(x => x.chunkId)).toEqual([0, 2, 3]);
  expect(r.results[0]!.vector).toBeUndefined();
});

test('a question with no indexable terms still returns vector results', async () => {
  const r = await engine.search({ text: '???', vector: basisVector(3) }, NO_RERANK);
  expect(r.notes).toContain('no-keyword-terms');
  expect(r.results[0]!.chunkId).toBe(3);
});

test('filters restrict both retrievers; filters that match nothing give no-matches', async () => {
  const aapl = await engine.search({ text: 'export controls china', vector: basisVector(0) }, withFilters({ tickers: ['AAPL'] }));
  expect(aapl.results.length).toBeGreaterThan(0);
  expect(aapl.results.every(x => [3, 4, 5].includes(x.chunkId))).toBe(true);
  const none = await engine.search({ text: 'export controls china', vector: basisVector(0) }, withFilters({ fiscalYears: [2023] }));
  expect(none.results).toEqual([]);
  expect(none.notes).toContain('no-matches');
});

test('rerank reorders the head with the passage texts in fused order and keeps the tail', async () => {
  const rerank = vi.fn(async (_q: string, passages: string[]) => passages.map(p => p.length));
  const r = await engine.search({ text: 'export controls china', vector: basisVector(0) },
    { ...DEFAULT_SETTINGS, rerank: true, rerankTop: 3 }, rerank);
  const texts = fixtureCorpus().chunks.map(c => c.text);
  expect(rerank).toHaveBeenCalledWith('export controls china', [texts[0], texts[2], texts[3]]);
  expect(r.results.map(x => x.chunkId)).toEqual([3, 0, 2, 1, 4, 5]);
  expect(r.results[0]).toMatchObject({ finalRank: 1, rerank: { rank: 1, score: texts[3]!.length }, fused: { rank: 3 } });
  expect(r.results[3]!.rerank).toBeUndefined();
});

test('rerank requested without a reranker notes it and still returns results', async () => {
  const r = await engine.search({ text: 'export', vector: basisVector(2) }, { ...DEFAULT_SETTINGS, rerank: true });
  expect(r.notes).toContain('reranker-unavailable');
  expect(r.results[0]!.chunkId).toBe(2);
});

test('returns at most `candidates` results', async () => {
  const r = await engine.search({ text: 'export controls china', vector: basisVector(0) }, { ...NO_RERANK, candidates: 2 });
  // vector top-2 = [0, 1] (orthogonal ties by id), keyword top-2 = [0, 2]; 1 and 2 tie on score and best rank → id order
  expect(r.results.map(x => x.chunkId)).toEqual([0, 1]);
});

test('getChunks returns views in the requested order and skips unknown ids', async () => {
  const views = await engine.getChunks([4, 0, 99]);
  expect(views.map(v => [v.id, v.ticker, v.fiscalYear])).toEqual([[4, 'AAPL', 2025], [0, 'NVDA', 2025]]);
  expect(views[1]).toMatchObject({ companyName: 'NVIDIA', form: '10-K', item: '1A', itemTitle: 'Risk Factors',
    accession: '0001045810-25-000023', url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581025000023/nvda-20250126.htm' });
});

test('facets list tickers by company id, years descending, items in 10-K order', async () => {
  const f = await engine.facets();
  expect(f.tickers).toEqual(['NVDA', 'AAPL']);
  expect(f.fiscalYears).toEqual([2025, 2024]);
  expect(f.items.map(i => i.item)).toEqual(['1A', '7', '8']);
  expect(f.items[0]!.title).toBe('Risk Factors');
});
