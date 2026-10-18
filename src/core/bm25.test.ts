import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { bm25Search } from './bm25';
import { loadCorpus, openDb } from './load';
import { buildPostings } from './postings';
import { fixtureCorpus, fixtureVectors } from './test-fixtures';
import type { SearchFilters } from './types';

const NO_FILTERS: SearchFilters = { tickers: [], fiscalYears: [], items: [] };
let db: PGlite;

beforeAll(async () => {
  db = await openDb();
  await loadCorpus(db, fixtureCorpus(), fixtureVectors());
});
afterAll(async () => {
  await db.close();
});

/** Textbook BM25 over the fixture, independent of the SQL under test. */
function reference(terms: string[], k1: number, b: number) {
  const p = buildPostings(fixtureCorpus().chunks.map(c => c.text));
  const scores = new Map<number, number>();
  for (const term of new Set(terms)) {
    const t = p.terms.find(x => x.term === term);
    if (!t) continue;
    const idf = Math.log(1 + (p.n - t.df + 0.5) / (t.df + 0.5));
    t.chunkIds.forEach((id, i) => {
      const tf = t.tfs[i]!;
      const len = p.lengths[id]!;
      scores.set(id, (scores.get(id) ?? 0) + (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * len) / p.avgdl)));
    });
  }
  return [...scores].map(([id, score]) => ({ id, score })).sort((x, y) => y.score - x.score || x.id - y.id);
}

const queries = [['export', 'china'], ['revenu'], ['data', 'center', 'china']];
const params = [[1.2, 0.75], [2.0, 0.3]];

test.each(queries.flatMap(q => params.map(([k1, b]) => [q, k1!, b!] as const)))(
  'SQL BM25 matches the textbook formula for %j (k1=%d, b=%d)', async (terms, k1, b) => {
    const got = await bm25Search(db, [...terms], { k1, b, limit: 10, filters: NO_FILTERS });
    const want = reference([...terms], k1, b);
    expect(got.map(h => h.id)).toEqual(want.map(h => h.id));
    got.forEach((h, i) => expect(Math.abs(h.score - want[i]!.score)).toBeLessThan(1e-9));
  });

test('hand-computed scores for "revenu" (N=6, avgdl=6.5, df=2)', async () => {
  const got = await bm25Search(db, ['revenu'], { k1: 1.2, b: 0.75, limit: 10, filters: NO_FILTERS });
  expect(got.map(h => h.id)).toEqual([4, 1]);
  expect(got[0]!.score).toBeCloseTo(1.221872005451499, 9);
  expect(got[1]!.score).toBeCloseTo(0.9982072993688518, 9);
});

test('ticker, fiscal year and item filters', async () => {
  const ids = async (terms: string[], filters: Partial<SearchFilters>) =>
    (await bm25Search(db, terms, { k1: 1.2, b: 0.75, limit: 10, filters: { ...NO_FILTERS, ...filters } })).map(h => h.id);
  expect(await ids(['china', 'revenu', 'sale'], { tickers: ['AAPL'] })).toEqual(expect.arrayContaining([3, 4, 5]));
  expect((await ids(['china', 'revenu', 'sale'], { tickers: ['AAPL'] })).every(id => [3, 4, 5].includes(id))).toBe(true);
  expect(await ids(['export', 'china'], { fiscalYears: [2024] })).toEqual([2]);
  expect((await ids(['revenu', 'data'], { items: ['7'] })).sort()).toEqual([1, 4]);
});

test('empty terms, unknown terms, duplicate terms and limit', async () => {
  const run = (terms: string[], limit = 10) => bm25Search(db, terms, { k1: 1.2, b: 0.75, limit, filters: NO_FILTERS });
  expect(await run([])).toEqual([]);
  expect(await run(['zzz'])).toEqual([]);
  expect(await run(['export', 'china'], 1)).toHaveLength(1);
  expect((await run(['revenu', 'revenu']))[0]!.score).toBeCloseTo(1.221872005451499, 9);
});
