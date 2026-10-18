import { expect, test } from 'vitest';
import { loadCorpus, openDb, type LoadStep } from './load';
import { fixtureCorpus, fixtureVectors } from './test-fixtures';

test('loads companies, filings, chunks, vectors and the BM25 tables', async () => {
  const db = await openDb();
  const steps: LoadStep[] = [];
  await loadCorpus(db, fixtureCorpus(), fixtureVectors(), s => steps.push(s));
  const count = async (table: string) =>
    (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;
  expect(await count('companies')).toBe(2);
  expect(await count('filings')).toBe(3);
  expect(await count('chunks')).toBe(6);
  expect((await db.query<{ n: number }>('SELECT n FROM corpus_stats')).rows[0]!.n).toBe(6);
  const emb = (await db.query<{ embedding: Uint8Array }>('SELECT embedding FROM chunks WHERE id = 2')).rows[0]!.embedding;
  expect(emb).toBeInstanceOf(Uint8Array);
  expect(Array.from(emb)).toEqual(Array.from(fixtureVectors().subarray(3072, 4608)));
  const exportTerm = (await db.query<{ df: number; chunk_ids: number[] }>(
    "SELECT df, chunk_ids FROM terms WHERE term = 'export'")).rows[0]!;
  expect(exportTerm).toEqual({ df: 2, chunk_ids: [0, 2] });
  expect(steps).toEqual(['schema', 'rows', 'keyword-index', 'analyze']);
  await db.close();
});

test('round-trips CSV-hostile text byte for byte', async () => {
  const corpus = fixtureCorpus();
  const hostile = 'He said "hi", then\nleft \\ ok; a,b';
  corpus.chunks[4]!.text = hostile;
  const db = await openDb();
  await loadCorpus(db, corpus, fixtureVectors());
  expect((await db.query<{ text: string }>('SELECT text FROM chunks WHERE id = 4')).rows[0]!.text).toBe(hostile);
  await db.close();
});

test('rejects vectors that do not match the chunk count', async () => {
  const db = await openDb();
  await expect(loadCorpus(db, fixtureCorpus(), fixtureVectors().subarray(0, 1536 * 5))).rejects.toThrow(/vectors/i);
  await db.close();
});

test('rejects chunk ids that are not 0..N-1', async () => {
  const corpus = fixtureCorpus();
  corpus.chunks[5]!.id = 9;
  const db = await openDb();
  await expect(loadCorpus(db, corpus, fixtureVectors())).rejects.toThrow(/chunk ids/i);
  await db.close();
});
