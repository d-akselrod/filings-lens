import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { SearchEngine } from './engine';
import { loadCorpus, openDb } from './load';
import { decodeVectorB64, encodeVectorB64, runScorecard, type EvalItem } from './scorecard';
import { basisVector, fixtureCorpus, fixtureVectors, seededRandom } from './test-fixtures';
import { DEFAULT_SETTINGS, type RerankFn, type SearchSettings } from './types';

let db: PGlite;
let engine: SearchEngine;
const items: EvalItem[] = [
  { id: 'a', question: 'export controls china', goldIds: [0], vector: basisVector(0) },
  { id: 'b', question: 'services revenue', goldIds: [4], vector: basisVector(4) },
  { id: 'c', question: '???', goldIds: [1], vector: basisVector(1) },
];

beforeAll(async () => {
  db = await openDb();
  await loadCorpus(db, fixtureCorpus(), fixtureVectors());
  engine = await SearchEngine.open(db);
});
afterAll(async () => {
  await db.close();
});

test('scores the current settings and each baseline without a reranker', async () => {
  const progress: number[] = [];
  const result = await runScorecard(engine, items, DEFAULT_SETTINGS, undefined, done => progress.push(done));
  expect(result.rows.map(r => r.name)).toEqual(['current', 'vector', 'keyword', 'hybrid']);
  const row = (name: string) => result.rows.find(r => r.name === name)!;
  expect(row('vector')).toEqual({ name: 'vector', recall5: 1, recall10: 1, mrr10: 1, ndcg10: 1 });
  expect(row('keyword').recall5).toBeCloseTo(2 / 3, 12);
  expect(result.perQuestion[0]).toMatchObject({ id: 'a', question: 'export controls china', firstGoldRank: { vector: 1 } });
  expect(result.perQuestion[2]!.firstGoldRank.keyword).toBeNull();
  expect(progress.at(-1)).toBe(12);
});

test('adds the hybrid+rerank baseline when a reranker is available, and ignores UI filters', async () => {
  const rerank = async (_q: string, passages: string[]) => passages.map(p => -p.length);
  const seen: SearchSettings[] = [];
  const spy = {
    search: (q: { text: string; vector: Float32Array | null }, s: SearchSettings, r?: RerankFn) => {
      seen.push(s);
      return engine.search(q, s, r);
    },
  };
  const filtered = { ...DEFAULT_SETTINGS, candidates: 3, filters: { tickers: ['AAPL'], fiscalYears: [], items: [] } };
  const result = await runScorecard(spy, items, filtered, rerank);
  expect(result.rows.map(r => r.name)).toEqual(['current', 'vector', 'keyword', 'hybrid', 'hybrid+rerank']);
  expect(seen).toHaveLength(15);
  expect(seen.every(s => s.filters.tickers.length === 0 && s.candidates >= 10)).toBe(true);
  expect(result.perQuestion[0]!.firstGoldRank.current).not.toBeNull();
});

test('base64 vector codec round-trips through float16', () => {
  const r = seededRandom(5);
  const v = Float32Array.from({ length: 768 }, () => r() * 2 - 1);
  const back = decodeVectorB64(encodeVectorB64(v));
  expect(back).toHaveLength(768);
  back.forEach((x, i) => expect(Math.abs(x - v[i]!)).toBeLessThan(1e-3));
});
