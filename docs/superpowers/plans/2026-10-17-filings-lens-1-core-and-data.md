# Filings Lens — Plan 1 of 3: Search Core & Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tested, environment-agnostic search core (hand-written vector math, BM25 in SQL on PGlite, rank fusion, retrieval metrics, scorecard runner) plus an offline pipeline that turns the Magnificent 7's latest three 10-Ks into the site's data files, verified end to end by a Node CLI search.

**Architecture:** `src/core/` holds code shared by the Node pipeline, the browser worker (Plan 3), and the Vercel function (Plan 2). It has no DOM or Node-only APIs. `pipeline/` (Node only) runs these steps:
- fetch from EDGAR
- parse and chunk the 10-Ks
- embed with `gemini-embedding-2`
- write `public/data/`: manifest, corpus JSON, float16 vectors, eval and sample files

At load time (the Node CLI here, the browser in Plan 3), `loadCorpus()` builds an in-memory PGlite database from those files, including the BM25 tables. `SearchEngine` then searches it.

**Tech Stack:** TypeScript 7.0, Node ≥24 (local 26.7), Vitest 5.0, `@electric-sql/pglite` 0.5.10, `@electric-sql/pglite-pgvector` 0.0.11 (tests only), cheerio 1.2.0, stemmer 2.0.1, tsx 4.23.

**Spec:** `docs/superpowers/specs/2026-10-17-sec-filings-rag-design.md`

**Deliberate deviations from the spec** (measured 2026-10-17; tell the owner at hand-off):
1. **No PGlite data-directory snapshot.**
   - An *empty* PGlite snapshot is 4.7 MB gzipped (measured), on top of the 5.6 MB PGlite runtime. Shipping one would break the ~15 MB first-visit budget.
   - Instead, the site ships compact files: corpus JSON plus float16 vectors. `loadCorpus()` rebuilds the database at load. Measured in Node for 3,500 synthetic chunks: init 0.9 s, bulk load 0.4 s, keyword index 0.4 s, reading vectors back 0.4 s.
   - PGlite still holds companies, filings, chunks, vectors (`bytea`), and the BM25 tables.
2. **Memory database in the browser.** Plan 3 uses an in-memory PGlite database instead of IndexedDB. Return visits still skip the download, because the data files are hash-named and cached immutably over HTTP. This also avoids two tabs locking the same IndexedDB database.

## Global Constraints

- **Cost:** $0 total. Free tiers only.
- **Embeddings:**
  - Model `gemini-embedding-2` with `outputDimensionality: 768`.
  - Document text: `title: {title} | text: {content}`. Query text: `task: search result | query: {text}`.
  - Vectors are stored as float16 little-endian, 768 dims, and the row index is the chunk id.
- **No frameworks:** no LangChain, LlamaIndex, Orama, or hosted vector database. pgvector is allowed only inside `*.test.ts`.
- **Distance semantics match pgvector:**
  - `l2` = Euclidean distance
  - `cosine` = 1 − cosine similarity
  - `dot` = −(a·b)
  - Lower is better for all three.
- **Defaults:** cosine, 768 dims, re-normalize on, 50 candidates per search, k1 1.2, b 0.75, RRF k 60, α 0.5, rerank on with top 20, 8 passages to the model.
- **Corpus:** AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA, using each company's latest three filings with form exactly `10-K` (never `10-K/A`).
- **SEC fair access:** `User-Agent` comes from `SEC_USER_AGENT` (a name and an email), and requests are spaced ≥150 ms apart, which stays under 10 per second.
- **First-visit budget:** vectors file + gzipped corpus file + 6,000,000 bytes (allowance for the PGlite runtime and the app) ≤ 15,000,000 bytes. The build fails if it's over.
- **Data file layout:** hashed data files live in `public/data/v/`. `public/data/manifest.json` points to them using paths relative to `/data/`.
- **Imports:** relative imports only, no TS path aliases. Vercel functions don't support path mappings, and they import `src/core`.
- **Modules and tests:** ESM everywhere (`"type": "module"`), with tests colocated as `*.test.ts`.
- **Secrets:** only in `.env.local`, which is git-ignored, and written by the owner. Never commit keys and never print them.
- **Commits:** every commit message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A question with no indexable terms** (empty, only stopwords, punctuation): keyword search returns `[]` with note `no-keyword-terms`, and hybrid search still returns the vector results. Test lives in Task 6.
2. **Filters that match no chunk** (a fiscal year the corpus doesn't have): empty results with note `no-matches`, and no exception. Task 6.
3. **10-K HTML with a table of contents that repeats every Item heading:** the body sections are chosen, never the TOC lines. Task 9.
4. **Free-tier quota exhaustion mid-embedding** (repeated 429s): progress stays on disk, and a rerun embeds only what's missing. Task 11.
5. **Chunk text with CSV-hostile characters** (quotes, commas, newlines, backslashes): it round-trips through PGlite byte-for-byte. Task 3.

---

## File Structure

```
package.json, tsconfig.json, vitest.config.ts, .gitignore, .env.example
docs/design/layout-a-modern.html        approved UI mockup (copied from .superpowers/)
src/core/
  types.ts            shared contract types + DEFAULT_SETTINGS + compareItems
  stopwords.ts        NLTK English stopword list
  tokenize.ts         one tokenizer for pipeline, browser, and SQL index
  float16.ts          f16 encode/decode (round-to-nearest-even)
  vector.ts           distance(), prepareQuery(), scan() — the hand-written vector math
  csv.ts              RFC 4180 row writer for COPY FROM /dev/blob
  schema.ts           SCHEMA_SQL
  postings.ts         buildPostings() — BM25 inverted index from chunk texts
  load.ts             openDb(), loadCorpus() — builds the PGlite database from data files
  bm25.ts             BM25_SQL + bm25Search()
  fusion.ts           fuseRrf()
  metrics.ts          recallAtK, mrrAtK, ndcgAtK
  engine.ts           SearchEngine (filters, vector scan, BM25, fusion, optional rerank)
  gemini.ts           REST client: embedBatch, generateText, toGeminiError, prefixes
  scorecard.ts        runScorecard, BASELINES, base64 vector codec
  test-fixtures.ts    seeded RNG + 6-chunk fixture corpus (tests only)
pipeline/
  companies.ts        the 7 companies + CIKs
  edgar.ts            latest10Ks(), EdgarClient (UA, spacing, disk cache)
  html-blocks.ts      htmlToBlocks() — HTML → paragraphs + tables
  parse10k.ts         ITEM_TITLES, splitItems()
  chunk.ts            chunkSection()
  embed-runner.ts     embedWithCache() — resumable, quota-aware
  write-data.ts       writeDataFiles() — manifest, corpus, vectors, budget guard
  node-data.ts        readDataFiles() + loadEngineFromDisk() for CLIs/tests
  eval.ts             validateEval(), sample/eval file writers
  env.ts              loads .env.local, requireEnv()
  cli/ingest.ts, cli/search.ts, cli/eval-draft.ts, cli/eval-finalize.ts
  fixtures/           trimmed EDGAR JSON + mini 10-K HTML
data/eval/            questions.jsonl (owner-reviewed), samples.jsonl, candidates.jsonl
data/parse-report.json  generated by ingest
public/data/          manifest.json + v/ hashed files (generated, committed)
```

---

### Task 1: Repository scaffold, shared types, tokenizer

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/core/types.ts`, `src/core/stopwords.ts`, `src/core/tokenize.ts`
- Copy: `.superpowers/brainstorm/75632-1792278100/content/layout-v2.html` → `docs/design/layout-a-modern.html`
- Test: `src/core/tokenize.test.ts`

**Interfaces:**
- Produces: everything in `src/core/types.ts` below, and `tokenize(text: string): string[]`.

- [ ] **Step 1: Initialize git and commit the docs on `main`, then branch**

```bash
cd /Users/daniel/repos/d-akselrod/rag-engine
git init -b main
printf 'node_modules/\ndist/\n.env*\n!.env.example\ndata/.cache/\n.superpowers/\ntest-results/\nplaywright-report/\n' > .gitignore
mkdir -p docs/design && cp .superpowers/brainstorm/75632-1792278100/content/layout-v2.html docs/design/layout-a-modern.html
git add .gitignore docs && git commit -m "docs: design spec, plans, approved UI mockup"
git switch -c plan-1-core-data
```

- [ ] **Step 2: Create the package and tooling**

`package.json`:
- `"name": "filings-lens"`, `"private": true`, `"type": "module"`, `"engines": {"node": ">=24"}`.
- Scripts:
  - `"test": "vitest run"`
  - `"typecheck": "tsc --noEmit"`
  - `"ingest": "tsx pipeline/cli/ingest.ts"`
  - `"search": "tsx pipeline/cli/search.ts"`
  - `"eval:draft": "tsx pipeline/cli/eval-draft.ts"`
  - `"eval:finalize": "tsx pipeline/cli/eval-finalize.ts"`

```bash
npm i @electric-sql/pglite@0.5.10 stemmer@2.0.1
npm i -D typescript@7.0.2 vitest@5.0.5 tsx@4.23.15 cheerio@1.2.0 @electric-sql/pglite-pgvector@0.0.11 @types/node
```

`tsconfig.json`:
- `target: "ES2023"`, `module: "ESNext"`, `moduleResolution: "Bundler"`
- `strict: true`, `noUncheckedIndexedAccess: true`, `skipLibCheck: true`
- `lib: ["ES2023","DOM","DOM.Iterable","WebWorker"]`, `types: ["node"]`
- `include: ["src","pipeline","server","api","scripts"]`

`vitest.config.ts`: `test: { environment: 'node', include: ['**/*.test.ts','**/*.test.tsx'], exclude: ['node_modules','dist','e2e'], testTimeout: 30000 }`.

`.env.example`:
```
GEMINI_API_KEY=
SEC_USER_AGENT="Your Name you@example.com"
```

- [ ] **Step 3: Write `src/core/types.ts`, the contract every later task uses**

```ts
export type Metric = 'cosine' | 'l2' | 'dot';
export type Dims = 128 | 256 | 512 | 768;
export type SearchMode = 'hybrid' | 'vector' | 'keyword';
export interface SearchFilters { tickers: string[]; fiscalYears: number[]; items: string[] } // [] = no filter
export interface SearchSettings {
  metric: Metric; dims: Dims; renormalize: boolean; candidates: number;
  k1: number; b: number; mode: SearchMode; rrfK: number; alpha: number;
  rerank: boolean; rerankTop: number; contextPassages: number; filters: SearchFilters;
}
export const DEFAULT_SETTINGS: SearchSettings = {
  metric: 'cosine', dims: 768, renormalize: true, candidates: 50, k1: 1.2, b: 0.75,
  mode: 'hybrid', rrfK: 60, alpha: 0.5, rerank: true, rerankTop: 20, contextPassages: 8,
  filters: { tickers: [], fiscalYears: [], items: [] },
};
export interface Hit { id: number; score: number }
export interface RankedResult {
  chunkId: number; finalRank: number;                  // 1-based
  vector?: { rank: number; distance: number };
  keyword?: { rank: number; score: number };
  fused: { rank: number; score: number };
  rerank?: { rank: number; score: number };
}
export type SearchNote = 'no-query-vector' | 'no-keyword-terms' | 'no-matches' | 'reranker-unavailable';
export interface SearchResponse {
  results: RankedResult[]; usedMode: SearchMode; notes: SearchNote[];
  timings: { vectorMs: number; keywordMs: number; fuseMs: number; rerankMs: number };
}
export type RerankFn = (query: string, passages: string[]) => Promise<number[]>; // higher = more relevant
export interface CompanyRow { id: number; ticker: string; name: string; cik: string }
export interface FilingRow { id: number; companyId: number; form: '10-K'; fiscalYear: number; periodEnd: string; filedAt: string; accession: string; url: string }
export interface ChunkRow { id: number; key: string; filingId: number; item: string; itemTitle: string; ordinal: number; text: string; tokenCount: number }
export interface CorpusFile { schemaVersion: 1; companies: CompanyRow[]; filings: FilingRow[]; chunks: ChunkRow[] }
export interface ChunkView extends ChunkRow { ticker: string; companyName: string; fiscalYear: number; form: '10-K'; url: string; accession: string }
export interface Facets { tickers: string[]; fiscalYears: number[]; items: Array<{ item: string; title: string }> }
export interface Manifest {
  schemaVersion: 1; builtAt: string; embeddingModel: 'gemini-embedding-2'; dims: 768; vectorEncoding: 'f16le';
  chunkCount: number;
  corpus: { file: string; bytes: number; gzipBytes: number };   // file is relative to /data/, e.g. "v/corpus.1a2b3c4d.json"
  vectors: { file: string; bytes: number };
  eval?: { file: string; count: number };
  samples?: { file: string; count: number };
}
/** Orders 10-K item codes: 1 < 1A < 1B < 1C < 2 < … < 7 < 7A < 8 < 9 < 9A … */
export function compareItems(a: string, b: string): number
```
Chunk key format everywhere: `${accession}:${item}:${ordinal}`.

- [ ] **Step 4: Write the failing tokenizer tests**

```ts
import { expect, test } from 'vitest';
import { tokenize } from './tokenize';
test('lowercases, splits, drops stopwords, stems words', () =>
  expect(tokenize("NVIDIA's export-controls in FY2025")).toEqual(['nvidia', 'export', 'control', 'fy2025']));
test('keeps numbers, strips thousands separators and currency', () =>
  expect(tokenize('Revenue was $60,922 million, up 12.5%')).toEqual(['revenu', '60922', 'million', '12.5']));
test('keeps 10-K item codes', () =>
  expect(tokenize('Item 1A. Risk Factors')).toEqual(['item', '1a', 'risk', 'factor']));
test('returns [] for stopwords and punctuation only', () => expect(tokenize('the of and ... ?!')).toEqual([]));
test('drops single letters but keeps single digits', () => expect(tokenize('a b 7 x')).toEqual(['7']));
test('compareItems orders 10-K items', () =>
  expect(['8', '1A', '7A', '1', '10', '7'].sort(compareItems)).toEqual(['1', '1A', '7', '7A', '8', '10']));
```
(Import `compareItems` from `./types` in the same file.)

- [ ] **Step 5: Run the tests to make sure they fail.** `npx vitest run src/core/tokenize.test.ts` should FAIL with "Failed to resolve import ./tokenize".

- [ ] **Step 6: Implement `tokenize(text: string): string[]` in `src/core/tokenize.ts`, plus `STOPWORDS` (the 179-word NLTK English list, lowercase) in `stopwords.ts`**

Rules, in order:
1. `normalize('NFKC').toLowerCase()`.
2. Remove thousands separators with `/(\d),(?=\d{3}(?:\D|$))/g` → `'$1'`.
3. Split on `/[^a-z0-9.]+/`, then trim leading and trailing `.` from each token.
4. Drop empty tokens and tokens in `STOPWORDS`.
5. Drop 1-character tokens unless they match `/^\d$/`.
6. Stem only tokens that match `/^[a-z]+$/`, using `stemmer` (`import { stemmer } from 'stemmer'`).

- [ ] **Step 7: Run the tests to make sure they pass.** `npx vitest run src/core/tokenize.test.ts`: PASS (6 tests). `npm run typecheck`: no errors.

- [ ] **Step 8: Commit.** `git add -A && git commit -m "chore: scaffold repo; feat(core): shared types and tokenizer"`

---

### Task 2: Float16 codec and hand-written vector math

**Files:**
- Create: `src/core/float16.ts`, `src/core/vector.ts`, `src/core/test-fixtures.ts` (RNG part)
- Test: `src/core/float16.test.ts`, `src/core/vector.test.ts`, `src/core/pgvector-oracle.test.ts`

**Interfaces:**
- Consumes: `Metric`, `Hit` (Task 1).
- Produces:
```ts
export function encodeF16(values: Float32Array): Uint8Array;                       // LE, round-to-nearest-even
export function decodeF16(bytes: Uint8Array, out?: Float32Array): Float32Array;
export function distance(metric: Metric, a: Float32Array, b: Float32Array, dims?: number): number;
export function prepareQuery(q: Float32Array, dims: number, renormalize: boolean): Float32Array;
export interface VectorMatrix { data: Float32Array; count: number; width: 768 }
export function scan(m: VectorMatrix, q: Float32Array,
  o: { metric: Metric; dims: number; renormalize: boolean; k: number; allow: Uint8Array | null }): Hit[];
// Hit.score = distance; ascending; ties by id ascending. allow[i] === 1 means chunk i is eligible.
// test-fixtures.ts:
export function seededRandom(seed: number): () => number;                           // mulberry32
export function randomUnitVectors(n: number, dims: number, seed: number): Float32Array[]; // Box–Muller, normalized
```

- [ ] **Step 1: Write the failing tests**

`float16.test.ts`:
```ts
const bits = (x: number) => Array.from(encodeF16(new Float32Array([x])));
test('exact bit patterns', () => {
  expect(bits(1)).toEqual([0x00, 0x3c]); expect(bits(-2)).toEqual([0x00, 0xc0]);
  expect(bits(65504)).toEqual([0xff, 0x7b]); expect(bits(2 ** -14)).toEqual([0x00, 0x04]);
  expect(bits(2 ** -24)).toEqual([0x01, 0x00]); expect(bits(70000)).toEqual([0x00, 0x7c]); expect(bits(0)).toEqual([0, 0]);
});
test('rounds half to even', () => {
  expect(bits(1 + 2 ** -11)).toEqual([0x00, 0x3c]); expect(bits(1 + 3 * 2 ** -11)).toEqual([0x02, 0x3c]);
});
test('round-trips within 1e-3 relative', () => {
  const r = seededRandom(1), v = Float32Array.from({ length: 1000 }, () => r() * 2 - 1);
  decodeF16(encodeF16(v)).forEach((x, i) => { if (Math.abs(v[i]!) > 1e-3) expect(Math.abs(x - v[i]!) / Math.abs(v[i]!)).toBeLessThan(1e-3); });
});
```
`vector.test.ts`:
```ts
const f = (...x: number[]) => Float32Array.from(x);
test('distances follow pgvector semantics', () => {
  expect(distance('dot', f(1, 2, 3), f(4, 5, 6))).toBeCloseTo(-32, 12);
  expect(distance('l2', f(1, 2, 3), f(4, 5, 6))).toBeCloseTo(5.196152422706632, 12);
  expect(distance('cosine', f(1, 2, 3), f(4, 5, 6))).toBeCloseTo(0.025368153802923787, 12);
});
test('prepareQuery truncates and optionally renormalizes', () => {
  expect(Array.from(prepareQuery(f(3, 4, 12), 2, true))).toEqual([0.6000000238418579, 0.800000011920929]);
  expect(Array.from(prepareQuery(f(3, 4, 12), 2, false))).toEqual([3, 4]);
});
test('scan matches brute force and respects allow + k', () => { /* 300 random vectors, k=10, allow every 3rd id; compare to sorting all distances */ });
test('metrics agree on normalized vectors, diverge after truncation without renormalize', () => {
  const docs = randomUnitVectors(200, 768, 7), q = randomUnitVectors(1, 768, 8)[0]!;
  const m = { data: concat(docs), count: 200, width: 768 as const };
  const order = (metric: Metric, dims: number, renormalize: boolean) =>
    scan(m, q, { metric, dims, renormalize, k: 20, allow: null }).map(h => h.id).join();
  expect(order('l2', 768, true)).toBe(order('cosine', 768, true)); expect(order('dot', 768, true)).toBe(order('cosine', 768, true));
  expect(order('dot', 128, false)).not.toBe(order('cosine', 128, false));
  expect(order('dot', 128, true)).toBe(order('cosine', 128, true)); expect(order('l2', 128, true)).toBe(order('cosine', 128, true));
});
```
`pgvector-oracle.test.ts`:
- Create PGlite with `extensions: { vector }` (from `@electric-sql/pglite-pgvector`), then run `CREATE EXTENSION vector` and create a table with column `e vector(768)`.
- Insert 50 seeded random (non-normalized) vectors as `'[x,y,…]'` strings.
- For one query, compare SQL `e <-> $1`, `e <=> $1`, and `e <#> $1` to `distance('l2'|'cosine'|'dot', …)` for every row. Assert `|ours − pg| < 1e-4 · max(1, |pg|)`.

- [ ] **Step 2: Run the tests to make sure they fail.** `npx vitest run src/core/float16.test.ts src/core/vector.test.ts src/core/pgvector-oracle.test.ts` should FAIL on unresolved imports.

- [ ] **Step 3: Implement `float16.ts`, `vector.ts`, and the RNG helpers**
- **`scan`:**
  - It reads `m.data` at offset `i*768` and uses only the first `dims` components.
  - For `l2` and `dot` with `renormalize` on, divide by the truncated doc norm while accumulating. Compute the norm in the same loop.
  - `cosine` always normalizes.
  - Use a bounded max-heap of size `k`. Never fully sort `count` items.
  - Zero-norm vectors get cosine distance 1.
- **`distance`:** accumulates in float64.

- [ ] **Step 4: Run the tests to make sure they pass.** Same command: PASS.

- [ ] **Step 5: Commit.** `git commit -am "feat(core): float16 codec and hand-written vector distances with pgvector oracle tests"` (add new files first).

---

### Task 3: Schema, CSV writer, BM25 postings, `loadCorpus`

**Files:**
- Create: `src/core/schema.ts`, `src/core/csv.ts`, `src/core/postings.ts`, `src/core/load.ts`; extend `src/core/test-fixtures.ts`
- Test: `src/core/postings.test.ts`, `src/core/load.test.ts`

**Interfaces:**
- Consumes: `tokenize`, `encodeF16`, `CorpusFile` (Tasks 1–2).
- Produces:
```ts
export const SCHEMA_SQL: string;
export function csvRow(fields: Array<string | number | Uint8Array | number[]>): string; // RFC 4180 + '\n'; Uint8Array → \x<hex>; number[] → "{1,2}"
export interface PostingsTable { terms: Array<{ id: number; term: string; df: number; chunkIds: number[]; tfs: number[] }>; lengths: Int32Array; n: number; avgdl: number }
export function buildPostings(texts: string[]): PostingsTable;   // index = chunk id; lengths = tokenize(text).length
export type LoadStep = 'schema' | 'rows' | 'keyword-index' | 'analyze';
export async function openDb(): Promise<PGlite>;                 // PGlite.create('memory://')
export async function loadCorpus(db: PGlite, corpus: CorpusFile, vectors: Uint8Array, onStep?: (s: LoadStep) => void): Promise<void>;
// test-fixtures.ts:
export function fixtureCorpus(): CorpusFile;                     // the 6 chunks below
export function fixtureVectors(): Uint8Array;                    // f16 of unit basis vectors e_0..e_5 (width 768)
```
`SCHEMA_SQL`:
```sql
CREATE TABLE companies (id smallint PRIMARY KEY, ticker text NOT NULL UNIQUE, name text NOT NULL, cik text NOT NULL);
CREATE TABLE filings (id smallint PRIMARY KEY, company_id smallint NOT NULL REFERENCES companies(id), form text NOT NULL,
  fiscal_year smallint NOT NULL, period_end date NOT NULL, filed_at date NOT NULL, accession text NOT NULL UNIQUE, url text NOT NULL);
CREATE TABLE chunks (id integer PRIMARY KEY, key text NOT NULL UNIQUE, filing_id smallint NOT NULL REFERENCES filings(id),
  item text NOT NULL, item_title text NOT NULL, ordinal smallint NOT NULL, text text NOT NULL,
  token_count smallint NOT NULL, bm25_len smallint NOT NULL, embedding bytea NOT NULL);
CREATE TABLE terms (id integer PRIMARY KEY, term text NOT NULL UNIQUE, df integer NOT NULL, chunk_ids integer[] NOT NULL, tfs smallint[] NOT NULL);
CREATE TABLE corpus_stats (n integer NOT NULL, avgdl double precision NOT NULL);
CREATE INDEX chunks_filing_idx ON chunks (filing_id);
```
**Fixture corpus.** Companies: 0 NVDA "NVIDIA" and 1 AAPL "Apple". Filings: 0 NVDA FY2025, 1 NVDA FY2024, 2 AAPL FY2025. Chunks (id: filing, item, text):

| id | filing | item | text |
|----|--------|------|------|
| 0 | 0 | 1A | `Export controls restrict sales of data center products to China.` |
| 1 | 0 | 7 | `Data center revenue grew strongly in fiscal 2025.` |
| 2 | 1 | 1A | `New export restrictions may reduce demand in China.` |
| 3 | 2 | 1A | `Supply chain disruptions in China could affect iPhone production.` |
| 4 | 2 | 7 | `Services revenue reached a record.` |
| 5 | 2 | 8 | `Net sales by category are shown in the table below.` |

**`loadCorpus` steps:**
1. Run `exec(SCHEMA_SQL)`.
2. Load rows with `COPY companies|filings|chunks FROM '/dev/blob' WITH (FORMAT csv)` (blob option). Each chunk's embedding is `vectors.subarray(id*1536, (id+1)*1536)`.
3. Run `buildPostings` and COPY the results into `terms`.
4. `INSERT INTO corpus_stats`.
5. `ANALYZE`.

`loadCorpus` throws if chunk ids aren't exactly 0..N−1 or if `vectors.length !== N*1536`.

- [ ] **Step 1: Write the failing tests**

`postings.test.ts`:
```ts
const p = buildPostings(['risk risk export', 'export china']);
const t = (w: string) => p.terms.find(x => x.term === w)!;
expect(t('risk')).toMatchObject({ df: 1, chunkIds: [0], tfs: [2] });
expect(t('export')).toMatchObject({ df: 2, chunkIds: [0, 1], tfs: [1, 1] });
expect(Array.from(p.lengths)).toEqual([3, 2]); expect(p.n).toBe(2); expect(p.avgdl).toBe(2.5);
```
`load.test.ts`:
- Load the fixture.
- Expect row counts of 2 companies, 3 filings, 6 chunks, and `corpus_stats.n` = 6.
- `embedding` for id 2 equals `fixtureVectors().subarray(3072, 4608)` as a `Uint8Array` (bytea comes back as `Uint8Array`, verified).
- **Review Focus #5:** replace chunk 4's text with `He said "hi", then\nleft \\ ok; a,b` and reload. `SELECT text FROM chunks WHERE id=4` must equal it exactly.
- Throws when the vectors are too short.

- [ ] **Step 2: Run the tests to make sure they fail.** `npx vitest run src/core/postings.test.ts src/core/load.test.ts` should FAIL.
- [ ] **Step 3: Implement the four modules and the fixture helpers.**
- [ ] **Step 4: Run the tests to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(core): PGlite schema and corpus loader with BM25 postings`

---

### Task 4: BM25 search in SQL

**Files:** Create `src/core/bm25.ts`; Test `src/core/bm25.test.ts`

**Interfaces:**
- Consumes: `loadCorpus`, `buildPostings`, `fixtureCorpus` (Task 3), `SearchFilters`, `Hit`.
- Produces: `export const BM25_SQL: string;` and
  `export async function bm25Search(db: Pick<PGlite,'query'>, terms: string[], p: { k1: number; b: number; limit: number; filters: SearchFilters }): Promise<Hit[]>`.
  It returns score descending with ties broken by id ascending, and `[]` when `terms` is empty. It deduplicates terms.

`BM25_SQL` (exact; params `$1` terms, `$2` k1, `$3` b, `$4` tickers, `$5` years, `$6` items, `$7` limit):
```sql
WITH q AS (SELECT DISTINCT unnest($1::text[]) AS term),
hits AS (
  SELECT t.df, u.chunk_id, u.tf
  FROM q JOIN terms t ON t.term = q.term
  CROSS JOIN LATERAL unnest(t.chunk_ids, t.tfs) AS u(chunk_id, tf)
)
SELECT h.chunk_id AS id,
  SUM(ln(1 + (s.n - h.df + 0.5)::float8 / (h.df + 0.5)::float8)
      * (h.tf * ($2::float8 + 1))
      / (h.tf + $2::float8 * (1 - $3::float8 + $3::float8 * c.bm25_len / s.avgdl))) AS score
FROM hits h
JOIN chunks c ON c.id = h.chunk_id
JOIN filings f ON f.id = c.filing_id
JOIN companies co ON co.id = f.company_id
CROSS JOIN corpus_stats s
WHERE (cardinality($4::text[]) = 0 OR co.ticker = ANY($4::text[]))
  AND (cardinality($5::int[]) = 0 OR f.fiscal_year = ANY($5::int[]))
  AND (cardinality($6::text[]) = 0 OR c.item = ANY($6::text[]))
GROUP BY h.chunk_id
ORDER BY score DESC, h.chunk_id ASC
LIMIT $7::int
```

- [ ] **Step 1: Write the failing tests**
- **Formula check:** the test computes expected scores in JavaScript from `buildPostings(fixture texts)` with the textbook formula: `idf = ln(1 + (N − df + 0.5)/(df + 0.5))` and `score = Σ idf · tf·(k1+1) / (tf + k1·(1 − b + b·len/avgdl))`. It asserts SQL scores match within 1e-9 for three queries (`['export','china']`, `['revenu']`, `['data','center','china']`) × two parameter sets ({1.2, 0.75} and {2.0, 0.3}).
- **Filters:**
  - `tickers ['AAPL']` returns only ids in {3,4,5}.
  - `fiscalYears [2024]` returns only id 2.
  - `items ['7']` returns only ids in {1,4}.
- **Edge cases:** `[]` → `[]`; `['zzz']` → `[]`; `limit 1` → length 1.

- [ ] **Step 2: Run the tests to make sure they fail.** `npx vitest run src/core/bm25.test.ts` should FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests to make sure they pass.** Also log the time of one query on the fixture (no hard assertion). **Decision rule** (spec §6.3): BM25 stays in SQL unless typical queries measure over 100 ms on the real corpus. That gets measured in the browser in Plan 3, Task 10, Step 5. If it's over, move scoring to TypeScript with an in-memory inverted index behind the same `bm25Search` signature, and record which way it went and why in the README.
- [ ] **Step 5: Commit.** `feat(core): hand-written BM25 in SQL with filters`

---

### Task 5: Rank fusion and retrieval metrics

**Files:** Create `src/core/fusion.ts`, `src/core/metrics.ts`; Test `src/core/fusion.test.ts`, `src/core/metrics.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Fused { id: number; score: number; vectorRank?: number; keywordRank?: number }
export function fuseRrf(vector: Hit[], keyword: Hit[], o: { k: number; alpha: number }): Fused[];
// score = alpha/(k + rv) + (1 − alpha)/(k + rk); ranks = 1-based input positions; a missing list adds 0.
// Sort: score desc, then min(rv, rk) asc, then id asc. Single-list modes call it with alpha 1 (vector) or 0 (keyword).
export function recallAtK(ranked: number[], gold: ReadonlySet<number>, k: number): number;
export function mrrAtK(ranked: number[], gold: ReadonlySet<number>, k: number): number;
export function ndcgAtK(ranked: number[], gold: ReadonlySet<number>, k: number): number; // binary relevance, log2(i+1) discount
```

- [ ] **Step 1: Write the failing tests**
```ts
const h = (...ids: number[]) => ids.map((id, i) => ({ id, score: i }));
test('RRF', () => {
  const r = fuseRrf(h(1, 2, 3), h(3, 1), { k: 60, alpha: 0.5 });
  expect(r.map(x => x.id)).toEqual([1, 3, 2]);
  expect(r[0]!.score).toBeCloseTo(0.5 / 61 + 0.5 / 62, 15);
  expect(r[1]).toMatchObject({ vectorRank: 3, keywordRank: 1 });
  expect(fuseRrf(h(1, 2, 3), h(3, 1), { k: 60, alpha: 1 }).map(x => x.id)).toEqual([1, 2, 3]);
});
test('metrics', () => {
  const ranked = [5, 3, 9, 1], gold = new Set([3, 1]);
  expect(recallAtK(ranked, gold, 2)).toBe(0.5); expect(recallAtK(ranked, gold, 4)).toBe(1);
  expect(mrrAtK(ranked, gold, 4)).toBe(0.5); expect(mrrAtK(ranked, gold, 1)).toBe(0);
  expect(ndcgAtK(ranked, gold, 4)).toBeCloseTo((1 / Math.log2(3) + 1 / Math.log2(5)) / (1 + 1 / Math.log2(3)), 12);
});
```
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(core): reciprocal rank fusion and retrieval metrics`

---

### Task 6: `SearchEngine`

**Files:** Create `src/core/engine.ts`; Test `src/core/engine.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
```ts
export class SearchEngine {
  static async open(db: PGlite): Promise<SearchEngine>;   // reads all embeddings (ORDER BY id) into one Float32Array via decodeF16
  readonly count: number;
  search(q: { text: string; vector: Float32Array | null }, s: SearchSettings, rerank?: RerankFn): Promise<SearchResponse>;
  getChunks(ids: number[]): Promise<ChunkView[]>;         // same order as ids; unknown ids omitted
  facets(): Promise<Facets>;                              // tickers by company id; years desc; items sorted with compareItems
}
```
**Rules for `search`:**
1. **Eligibility:** compute the eligible-id bitmap with the same three filter predicates as `BM25_SQL` (one SQL query, cached per filters JSON). `null` when there are no filters.
2. **Mode:** `usedMode = s.mode`, except when the mode isn't `keyword` and the vector is `null`. Then add note `no-query-vector` and set `usedMode = 'keyword'`.
3. **Vector search** (`usedMode !== 'keyword'`): `scan(matrix, prepareQuery(vector, s.dims, s.renormalize), { k: s.candidates, … })`.
4. **Keyword search** (`usedMode !== 'vector'`): `terms = tokenize(q.text)`. If `[]`, add note `no-keyword-terms`; otherwise call `bm25Search(…, { limit: s.candidates })`.
5. **Fusion:** `fuseRrf` with alpha `s.alpha` (hybrid), `1` (vector), or `0` (keyword). If there are no results, add note `no-matches` and return `[]`.
6. **Rerank:**
   - If `s.rerank` is on but no `rerank` function is given, add note `reranker-unavailable`.
   - Otherwise, rerank the head of `min(s.rerankTop, fused.length)` results: pass the chunk texts to `rerank` and reorder that head by score, descending (ties go to the better fused rank). The tail keeps its fused order.
   - `rerank.rank` is the position within the reranked head.
7. **Output:** return at most `s.candidates` results. Set `finalRank` 1..n and the per-stage fields. Time each stage with `performance.now()`.

- [ ] **Step 1: Write the failing tests** (fixture database; the vectors are basis vectors, so query `e_i` puts chunk i first)
1. `search({text:'export controls china', vector:e(0)}, DEFAULT_SETTINGS minus rerank)`: results[0] is chunk 0 with `vector.rank 1` and `keyword.rank 1`.
2. `vector: null` gives `usedMode 'keyword'`, and `notes` contains `'no-query-vector'`.
3. **Review Focus #1:** `text: '???'` with `vector: e(3)`, hybrid: notes contain `'no-keyword-terms'`, and results[0] is chunk 3.
4. **Review Focus #2:** `filters.tickers ['AAPL']` returns only ids in {3,4,5}. `filters.fiscalYears [2023]` returns `results []`, and notes contain `'no-matches'`.
5. `rerank` with a fake that scores each passage by its text length reorders the head. `finalRank` follows the rerank scores, and `rerank.rank` is set.
6. `rerank: true` with no function gives the note `'reranker-unavailable'`, and results are still returned.
7. `getChunks([4, 0])` returns `[4, 0]` with `ticker` `AAPL`/`NVDA` and `fiscalYear` 2025.
8. `facets()` equals `{ tickers: ['NVDA','AAPL'], fiscalYears: [2025, 2024], items: [{item:'1A',…},{item:'7',…},{item:'8',…}] }`.

- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(core): SearchEngine with filters, hybrid fusion and pluggable rerank`

---

### Task 7: Gemini REST client (embeddings + non-streaming generation)

**Files:** Create `src/core/gemini.ts`; Test `src/core/gemini.test.ts`

**Interfaces:**
- Produces (Plan 2 adds streaming to this same file):
```ts
export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const EMBED_MODEL = 'gemini-embedding-2';
export const EMBED_DIMS = 768;
export const EMBED_BATCH_MAX = 100;
export type GeminiReason = 'quota' | 'auth' | 'bad_request' | 'server' | 'network';
export class GeminiError extends Error { constructor(readonly status: number, readonly reason: GeminiReason, message: string, readonly retryAfterMs?: number) }
export function queryText(q: string): string;                       // `task: search result | query: ${q}`
export function documentText(title: string, text: string): string;  // `title: ${title} | text: ${text}`
export async function toGeminiError(res: Response): Promise<GeminiError>;
export async function embedBatch(apiKey: string, texts: string[], o?: { fetch?: typeof fetch; signal?: AbortSignal }): Promise<Float32Array[]>;
export async function generateText(apiKey: string, r: { model: string; system: string; user: string }, o?: { fetch?: typeof fetch }): Promise<string>;
```
**REST calls** (all send header `x-goog-api-key`):
- **Embeddings:** `POST {BASE}/models/gemini-embedding-2:batchEmbedContents` with body `{ requests: texts.map(t => ({ model: 'models/gemini-embedding-2', content: { parts: [{ text: t }] }, outputDimensionality: 768 })) }`. The response is `{ embeddings: [{ values }] }` (verified live: 3 texts give 3×768).
  - Throws `RangeError` if there are more than 100 texts.
- **Generation:** `POST {BASE}/models/{model}:generateContent` with body `{ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }] }`.
  - The result is the concatenated `candidates[0].content.parts[].text` for parts where `thought !== true`. Gemma 4 always returns thought parts; this was verified.

**Error mapping (`toGeminiError`):**
- 429 → `quota`. `retryAfterMs` comes from the first `error.details[].retryDelay`, e.g. `"41s"` → 41000.
- 401/403 → `auth`.
- 400 → `bad_request`.
- ≥500 → `server`.
- A rejected `fetch` → `network`, status 0.

- [ ] **Step 1: Write the failing tests** (fake `fetch`)
- The URL, header, and body shape are exact.
- 2 texts give 2 `Float32Array`s of length 768, in order.
- 101 texts throw.
- 429 with `{"error":{"code":429,"details":[{"retryDelay":"41s"}]}}` gives `GeminiError{reason:'quota', retryAfterMs:41000}`.
- 403 → `auth`.
- A thrown fetch → `network`.
- `generateText` skips parts with `thought: true`.
- `queryText('x')` equals `'task: search result | query: x'`, and `documentText('T','b')` equals `'title: T | text: b'`.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(core): Gemini REST client for embeddings and generation`

---

### Task 8: EDGAR client and company list

**Files:** Create `pipeline/companies.ts`, `pipeline/edgar.ts`, `pipeline/fixtures/submissions-nvda.json`; Test `pipeline/edgar.test.ts`

**Interfaces:**
- Produces:
```ts
export const COMPANIES: ReadonlyArray<{ ticker: string; name: string; edgarName: string; cik: string }> = [
  { ticker: 'AAPL', name: 'Apple', edgarName: 'APPLE', cik: '0000320193' },
  { ticker: 'MSFT', name: 'Microsoft', edgarName: 'MICROSOFT', cik: '0000789019' },
  { ticker: 'NVDA', name: 'NVIDIA', edgarName: 'NVIDIA', cik: '0001045810' },
  { ticker: 'GOOGL', name: 'Alphabet', edgarName: 'ALPHABET', cik: '0001652044' },
  { ticker: 'AMZN', name: 'Amazon', edgarName: 'AMAZON', cik: '0001018724' },
  { ticker: 'META', name: 'Meta', edgarName: 'META PLATFORMS', cik: '0001326801' },
  { ticker: 'TSLA', name: 'Tesla', edgarName: 'TESLA', cik: '0001318605' },
];
export interface SubmissionsJson { cik: string; name: string; filings: { recent: { accessionNumber: string[]; filingDate: string[]; reportDate: string[]; form: string[]; primaryDocument: string[] } } }
export interface FilingRef { ticker: string; cik: string; accession: string; filedAt: string; periodEnd: string; fiscalYear: number; primaryDocument: string; url: string }
export function fiscalYearOf(periodEnd: string): number;            // calendar year of the period end (true for all 7 companies)
export function archiveUrl(cik: string, accession: string, doc: string): string;
// https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession without dashes}/${doc}
export function latest10Ks(sub: SubmissionsJson, ticker: string, count: number): FilingRef[]; // form === '10-K' only, filingDate desc
export class EdgarClient {
  constructor(o: { userAgent: string; cacheDir: string; minIntervalMs?: number /* default 150 */; fetch?: typeof fetch });
  submissions(cik: string): Promise<SubmissionsJson>;   // https://data.sec.gov/submissions/CIK${cik}.json; cache file `${cacheDir}/CIK${cik}.json`
  document(ref: FilingRef): Promise<string>;            // cache file `${cacheDir}/${accession}.htm`
}
```

- [ ] **Step 1: Write the failing tests**
- The fixture's `recent` arrays have forms `['10-Q','10-K','10-K/A','8-K','10-K','10-K','10-K']`, with descending filing dates.
- `latest10Ks(…, 'NVDA', 3)` returns the first three `10-K`s only. Their fields are mapped, and the URL equals `https://www.sec.gov/Archives/edgar/data/1045810/000104581025000023/nvda-20250126.htm` for accession `0001045810-25-000023` and document `nvda-20250126.htm`.
- `fiscalYearOf('2025-01-26')` is 2025.
- **Client tests** (fake fetch, temp dir):
  - The `User-Agent` header is passed exactly.
  - A second call is served from the cache without calling fetch.
  - Two uncached requests start ≥ `minIntervalMs` apart (use 50 and assert ≥45 ms).
  - The constructor throws if `userAgent` has no `@`.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(pipeline): EDGAR client with fair-access spacing and disk cache`

---

### Task 9: HTML → blocks and 10-K Item splitter

**Files:** Create `pipeline/html-blocks.ts`, `pipeline/parse10k.ts`, `pipeline/fixtures/10k-mini.html`; Test `pipeline/html-blocks.test.ts`, `pipeline/parse10k.test.ts`

**Interfaces:**
- Produces:
```ts
export type Block = { kind: 'para'; text: string } | { kind: 'table'; rows: string[][] };
export function htmlToBlocks(html: string): Block[];
export const ITEM_TITLES: Readonly<Record<string, string>>; // '1':'Business','1A':'Risk Factors','1B':'Unresolved Staff Comments','1C':'Cybersecurity','2':'Properties','3':'Legal Proceedings','4':'Mine Safety Disclosures','5':"Market for Registrant's Common Equity, Related Stockholder Matters and Issuer Purchases of Equity Securities",'6':'[Reserved]','7':"Management's Discussion and Analysis of Financial Condition and Results of Operations",'7A':'Quantitative and Qualitative Disclosures About Market Risk','8':'Financial Statements and Supplementary Data','9':'Changes in and Disagreements with Accountants on Accounting and Financial Disclosure','9A':'Controls and Procedures','9B':'Other Information','9C':'Disclosure Regarding Foreign Jurisdictions that Prevent Inspections','10':'Directors, Executive Officers and Corporate Governance','11':'Executive Compensation','12':'Security Ownership of Certain Beneficial Owners and Management and Related Stockholder Matters','13':'Certain Relationships and Related Transactions, and Director Independence','14':'Principal Accountant Fees and Services','15':'Exhibits and Financial Statement Schedules','16':'Form 10-K Summary'
export const REQUIRED_ITEMS: readonly string[];             // ['1','1A','7','8']
export interface Section { item: string; title: string; blocks: Block[]; chars: number }
export function splitItems(blocks: Block[]): { sections: Section[]; missingRequired: string[] };
```
**`htmlToBlocks` rules (cheerio):**
- Remove `script, style, head, ix\:header` and elements whose inline style contains `display:none` or `display: none`.
- **Tables:** each `tr` becomes its `td,th` texts, whitespace-collapsed, with empty cells dropped.
  - Merge a cell that is exactly `$` or `(` into the next cell.
  - Merge a cell that is exactly `)`, `%`, or `)%` into the previous cell.
  - Drop empty rows.
  - A table with ≤1 non-empty cell becomes a `para`.
- **Other text:** break at `p, div, li, h1–h6, br` boundaries, emitting leaf text once (no duplication from nested divs) and whitespace-collapsed.
- Drop empty lines and lines matching `/^(table of contents|page \d+|\d{1,3})$/i`.

**`splitItems` rules:**
- **Heading candidates:** `para` blocks matching `/^item\s+(\d{1,2}[a-c]?)\s*[.:\-–—]?\s*(.{0,200})$/i` whose uppercased code is in `ITEM_TITLES`.
- **Choosing headings:** for each code, keep the candidate with the most characters before the next candidate of any code. This skips table-of-contents lines.
- **Sections:** order the kept headings by position. A section is the blocks after its heading, up to the next kept heading.
- **Dropping:**
  - Drop Items `15` and `16` and everything after them (exhibits, signatures).
  - Drop everything before the first heading (cover page).
  - Drop sections under 200 characters.
- `title = ITEM_TITLES[code]`.

- [ ] **Step 1: Write the fixture and the failing tests**

`10k-mini.html` contains, in order:
- a cover paragraph
- a TOC of `<p>` lines `Item 1. Business 4`, `Item 1A. Risk Factors 12`, `Item 7. Management's Discussion… 30`, `Item 8. Financial Statements… 50`
- body headings `Item 1. Business`, `Item 1A. Risk Factors`, `Item 7. …`, `Item 8. …`, each followed by ≥300 characters of text
- a hidden `<div style="display:none">SECRET</div>`
- a financial table with cells `Net sales`, `$`, `60,922`, `$`, `26,974` and a row `Loss`, `(1,234`, `)`
- `Item 15. Exhibits` followed by `SIGNATURES`

Tests:
- `splitItems(htmlToBlocks(html)).sections.map(s => s.item)` equals `['1','1A','7','8']`.
- The 1A section's first block is the body sentence, not a TOC line (**Review Focus #3**).
- The table rows include `['Net sales','$60,922','$26,974']` and `['Loss','(1,234)']`.
- No block contains `SECRET`.
- `missingRequired` is `[]`. Removing the Item 7 body gives `['7']`.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(pipeline): 10-K HTML to blocks and Item splitting`

---

### Task 10: Section-bounded chunker

**Files:** Create `pipeline/chunk.ts`; Test `pipeline/chunk.test.ts`

**Interfaces:**
- Consumes: `Block` (Task 9).
- Produces:
```ts
export const CHUNK = { targetTokens: 500, maxTokens: 600, overlapTokens: 75 } as const;
export function estimateTokens(text: string): number;   // Math.ceil(text.length / 4)
export interface ChunkOut { ordinal: number; text: string; tokenCount: number }
export function chunkSection(blocks: Block[], o?: { targetTokens: number; maxTokens: number; overlapTokens: number }): ChunkOut[];
```
**Algorithm:**
1. **Units:**
   - Each `para` is one unit. If it's over `maxTokens`, split it into sentences, breaking after `.!?` followed by a space and an uppercase letter or digit. If a sentence is still too long, split it on words.
   - Each table row is one unit, rendered as `cells.join(' | ')`, and remembers its table index and whether it is row 0 (the header).
2. **Packing:** add units while the total is ≤ `targetTokens`. Close the chunk before a unit would push it past `maxTokens`. A unit is never split.
3. **Overlap:** the next chunk starts with the previous chunk's trailing units totaling ≥ `overlapTokens`. That's at least one unit, and never all of them.
4. **Table continuity:** if a chunk's first non-overlap unit is a non-header row of table t, prepend t's header row once.
5. **Joining:** units from the same paragraph or table join with `'\n'`; separate blocks join with `'\n\n'`.
6. **Output:** ordinals run 0..n−1. `tokenCount = estimateTokens(text)`.

- [ ] **Step 1: Write the failing tests**
- A 300-character section gives 1 chunk with ordinal 0.
- For a 20-paragraph section of 400 characters each, every chunk's `tokenCount` is ≤ 600, and each chunk i>0 starts with the last paragraph of chunk i−1.
- For a 200-row table (`['Row k','$k']`, header `['Metric','FY2025']`):
  - No row text is split across chunks.
  - Every chunk after the first starts with `Metric | FY2025`.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(pipeline): section-bounded chunker with overlap and table headers`

---

### Task 11: Resumable, quota-aware embedding runner

**Files:** Create `pipeline/embed-runner.ts`; Test `pipeline/embed-runner.test.ts`

**Interfaces:**
- Consumes: `embedBatch`, `GeminiError`, `EMBED_MODEL`, `EMBED_DIMS` (Task 7).
- Produces:
```ts
export class QuotaExhaustedError extends Error {}
export async function embedWithCache(items: Array<{ key: string; text: string }>, o: {
  apiKey: string; cacheDir: string; batchSize?: number /* 100 */; embed?: typeof embedBatch;
  sleep?: (ms: number) => Promise<void>; onProgress?: (done: number, total: number) => void; maxConsecutiveQuota?: number /* 6 */;
}): Promise<Map<string, Float32Array>>;   // keyed by item.key
```
**Behavior:**
- **Cache:** one file per text at `${cacheDir}/${sha256hex(`${EMBED_MODEL}|${EMBED_DIMS}|${text}`)}.f32` (raw float32 LE). Writes go to a temp file, then rename.
- **Batches:** only uncached items are batched.
- **Quota errors:** sleep `retryAfterMs ?? 60_000`, doubling on each consecutive quota error up to 900_000. After `maxConsecutiveQuota` consecutive quota errors, throw `QuotaExhaustedError` with the message "Free-tier quota exhausted; progress is cached — rerun later".
- **`server`/`network` errors:** retry 3× after 5 s, 10 s, and 20 s.
- **Other errors:** rethrow.

- [ ] **Step 1: Write the failing tests** (fake `embed`, fake `sleep`, temp dir)
1. Every item cached → `embed` is never called.
2. 250 items with `batchSize 100` → embed calls of 100, 100, and 50.
3. Two quota errors (`retryAfterMs 41000`) then success → sleeps `[41000, 82000]`.
4. **Review Focus #4:** batch 1 succeeds, then six quota errors → `QuotaExhaustedError`, and batch 1's files exist. A rerun with a healthy fake embeds only the remaining items.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(pipeline): resumable quota-aware embedding runner`

---

### Task 12: Data file writer with first-visit budget guard

**Files:** Create `pipeline/write-data.ts`, `pipeline/node-data.ts`; Test `pipeline/write-data.test.ts`

**Interfaces:**
- Consumes: `encodeF16`, `loadCorpus`, `openDb`, `SearchEngine`, `Manifest`.
- Produces:
```ts
export const FIRST_VISIT_BUDGET_BYTES = 15_000_000;
export const RUNTIME_ALLOWANCE_BYTES = 6_000_000;
export class BudgetError extends Error {}
export async function writeDataFiles(corpus: CorpusFile, vectorsByKey: Map<string, Float32Array>,
  o: { publicDir: string; budgetBytes?: number }): Promise<Manifest>;
export async function readDataFiles(publicDir: string): Promise<{ manifest: Manifest; corpus: CorpusFile; vectors: Uint8Array }>;
export async function loadEngineFromDisk(publicDir: string): Promise<{ engine: SearchEngine; manifest: Manifest; corpus: CorpusFile }>;
```
**Behavior:**
- **Vectors file:** `N×768` float16 in chunk-id order (`encodeF16`). Throw, naming the key, if a chunk has no vector or its length isn't 768.
- **File names:** `v/corpus.<sha8>.json` and `v/vectors.<sha8>.f16`, where sha8 is the first 8 hex characters of the content's sha256. Delete stale `v/corpus.*.json` and `v/vectors.*.f16`.
- **Manifest:** write `manifest.json` pretty-printed. `gzipBytes` is `zlib.gzipSync(level 9)` of the corpus JSON. Keep any existing `eval`/`samples` entries.
- **Budget:** throw `BudgetError` with all three numbers if `vectors.bytes + corpus.gzipBytes + RUNTIME_ALLOWANCE_BYTES > budgetBytes`.

- [ ] **Step 1: Write the failing tests** (temp dir; fixture corpus with basis vectors as float32)
- **Round trip:** `writeDataFiles` → `loadEngineFromDisk` → search with vector `e(4)` returns chunk 4 first.
- A stale `v/corpus.deadbeef.json` is removed.
- `budgetBytes: 1000` → `BudgetError`.
- A missing vector → an error whose message contains that chunk's key.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(pipeline): hashed data files, manifest, and first-visit budget guard`

---

### Task 13: Ingest and search CLIs, real data run

**Files:** Create `pipeline/env.ts`, `pipeline/cli/ingest.ts`, `pipeline/cli/search.ts`; generated `public/data/**`, `data/parse-report.json`

**Interfaces:**
- Consumes: Tasks 6–12.
- Produces:
  - `requireEnv(name: 'GEMINI_API_KEY' | 'SEC_USER_AGENT'): string`. It calls `process.loadEnvFile('.env.local')` once and exits with a clear message if the variable is missing.
  - The committed data files that Plans 2–3 read.

**ingest flow:**
1. For each company in `COMPANIES`, fetch `submissions`. Assert that `name.toUpperCase()` includes `edgarName`.
2. Take `latest10Ks(…, 3)`. Then for each filing: `document` → `htmlToBlocks` → `splitItems`.
3. Record the parse report: `{ ticker, fiscalYear, accession, items: {code: chars}, chunks }`. If any filing has `missingRequired`, write `data/parse-report.json`, print the report table, and exit 1. Never continue silently.
4. Run `chunkSection` per section. Build `ChunkRow`s with dense ids in the order company → filing (newest first) → section → ordinal, and key `${accession}:${item}:${ordinal}`.
5. **Embedding title:** `${name} 10-K FY${fiscalYear} — Item ${item} ${title}`. Embed each chunk with `embedWithCache(documentText(title, text))` and `cacheDir: data/.cache/embeddings`.
6. Run `writeDataFiles(…, { publicDir: 'public/data' })` and print the manifest sizes and the budget headroom.

**search CLI:** `npm run search -- "<question>" [--mode hybrid|vector|keyword] [--metric cosine|l2|dot] [--dims 128|256|512|768] [--no-renormalize] [--no-embed]`
- Load with `loadEngineFromDisk('public/data')`.
- Embed `queryText(question)` with `embedBatch` unless `--no-embed`.
- Search with rerank off.
- Print the top 10 as: `rank  TICKER FYyyyy Item  | vec #r d=… | bm25 #r s=… | rrf … | first 100 chars`.

- [ ] **Step 1 (owner action, before running anything)**
  - In Google AI Studio, create a **new** API key in a **new, dedicated** Google Cloud project, restricted to the Gemini API.
  - Delete the key that was pasted into the design chat.
  - Copy `.env.example` to `.env.local` and fill in `GEMINI_API_KEY` and `SEC_USER_AGENT`. The owner types these; the executor never sees or prints them.
- [ ] **Step 2: Implement `env.ts`, `ingest.ts`, and `search.ts`.** These are thin orchestration only. All logic stays in the tested modules.
- [ ] **Step 3: Run the ingest.** `npm run ingest`
  - Expected: the parse report lists 21 filings, each with Items 1, 1A, 7, and 8, and a chunk count (estimate 3–4K).
  - The free-tier quota may stop embedding with `QuotaExhaustedError`. If so, rerun `npm run ingest` later (after midnight Pacific if the daily quota is exhausted) until it completes.
  - Final line: `Budget OK: … bytes ≤ 15000000`.
  - If parsing fails for a filing, fix it in `parse10k.ts` with a new failing test built from that filing's heading pattern, then rerun.
- [ ] **Step 4: Verify search end to end**
  - `npm run search -- "How does NVIDIA describe export-control risk related to China?"`: the top 5 include ≥2 `NVDA … Item 1A` rows.
  - `npm run search -- --no-embed "goodwill impairment"`: keyword-only rows print with `vec —`.
  - `npm run search -- --metric dot "data center revenue"` and `--metric l2`: the same order as cosine (normalized vectors).
- [ ] **Step 5: Commit the data.** `git add public/data data/parse-report.json pipeline && git commit -m "feat(pipeline): ingest and search CLIs; Magnificent 7 10-K data files"` (`data/.cache` stays ignored).

---

### Task 14: Scorecard runner and evaluation data

**Files:** Create `src/core/scorecard.ts`, `pipeline/eval.ts`, `pipeline/cli/eval-draft.ts`, `pipeline/cli/eval-finalize.ts`, `data/eval/samples.jsonl`; owner creates `data/eval/questions.jsonl`; Test `src/core/scorecard.test.ts`, `pipeline/eval.test.ts`

**Interfaces:**
- Consumes: `SearchEngine`, the metrics, `generateText`, `embedWithCache`, `queryText`, `writeDataFiles`'s manifest.
- Produces:
```ts
// src/core/scorecard.ts
export type BaselineName = 'current' | 'vector' | 'keyword' | 'hybrid' | 'hybrid+rerank';
export const BASELINES: ReadonlyArray<{ name: Exclude<BaselineName, 'current'>; patch: Partial<SearchSettings> }> = [
  { name: 'vector', patch: { mode: 'vector', rerank: false } }, { name: 'keyword', patch: { mode: 'keyword', rerank: false } },
  { name: 'hybrid', patch: { mode: 'hybrid', rerank: false } }, { name: 'hybrid+rerank', patch: { mode: 'hybrid', rerank: true } },
];
export interface ScoreRow { name: BaselineName; recall5: number; recall10: number; mrr10: number; ndcg10: number }
export interface EvalItem { id: string; question: string; goldIds: number[]; vector: Float32Array }
export interface ScorecardResult { rows: ScoreRow[]; perQuestion: Array<{ id: string; question: string; firstGoldRank: Partial<Record<BaselineName, number | null>> }> }
export async function runScorecard(engine: SearchEngine, items: EvalItem[], current: SearchSettings,
  rerank: RerankFn | undefined, onProgress?: (done: number, total: number) => void): Promise<ScorecardResult>;
// every run uses filters = none and candidates ≥ 10; baselines = current settings + patch; 'hybrid+rerank' omitted when rerank is undefined
export function encodeVectorB64(v: Float32Array): string;   // f16le → base64
export function decodeVectorB64(b64: string): Float32Array;
export interface EvalFile { schemaVersion: 1; questions: Array<{ id: string; question: string; goldKeys: string[]; ticker: string; item: string; style: EvalStyle; vector: string }> }
export interface SamplesFile { schemaVersion: 1; samples: Array<{ question: string; vector: string }> }
export type EvalStyle = 'number' | 'risk' | 'strategy' | 'comparison' | 'other';
// pipeline/eval.ts
export function validateEval(lines: unknown[], knownKeys: ReadonlySet<string>): { items: Array<Omit<EvalFile['questions'][number], 'vector'>>; errors: string[] };
```
**eval-draft:**
- Pick 84 chunks, 3 per (company × item ∈ {1, 1A, 7, 8}) cell, from chunks with `tokenCount ≥ 300`, using seed 2026.
- For each chunk, call `generateText` with model `gemma-4-26b-a4b-it`.
  - System prompt: `You write evaluation questions for a search engine over SEC Form 10-K filings.`
  - User prompt: `Passage (from {TICKER} 10-K FY{year}, Item {item} {title}):\n{text}\n\nWrite one specific question an analyst might ask that this passage answers. Do not copy long phrases verbatim. Reply only with JSON: {"question": "...", "answer": "...", "style": "number|risk|strategy|comparison|other"}`
- Strip code fences, parse, and append `{ id: 'q'+nn, question, answer, style, ticker, item, goldKeys: [chunk.key] }` to `data/eval/candidates.jsonl`. Skip chunks with unparseable replies and report the count.

**eval-finalize:**
- Read `questions.jsonl` and `samples.jsonl`, then run `validateEval` against the current corpus keys. Exit 1 on any error.
- Embed `queryText(question)` with `embedWithCache` and write `public/data/v/eval.<sha8>.json` and `v/samples.<sha8>.json`.
- Set `manifest.eval` and `manifest.samples`.

**`data/eval/samples.jsonl`** (start list; the owner may edit):
```
{"question":"How does NVIDIA describe export-control risk related to China?"}
{"question":"What does Apple say about its reliance on outsourcing partners in Asia?"}
{"question":"How did Microsoft's cloud revenue change in its latest fiscal year?"}
{"question":"What does Tesla say about its dependence on Elon Musk?"}
{"question":"How does Meta describe regulatory risk in the European Union?"}
{"question":"How much did Amazon spend on capital expenditures in its most recent fiscal year?"}
```

- [ ] **Step 1: Write the failing tests**
- **`scorecard.test.ts`** (fixture engine; items are `{id:'a', goldIds:[0], vector:e(0)}`, `{id:'b', goldIds:[4], vector:e(4)}`, and `{id:'c', question:'???', goldIds:[1], vector:e(1)}`):
  - The `vector` row has `recall5 = 1`.
  - The `keyword` row has `recall5 < 1`, because 'c' has no terms.
  - There's no `hybrid+rerank` row when `rerank` is undefined. With a fake rerank there are 5 rows.
  - `perQuestion[0].firstGoldRank.vector` is 1.
  - The base64 codec round-trips within 1e-3.
- **`eval.test.ts`:** `validateEval` reports an unknown gold key, a duplicate `id`, an empty question, and an invalid `style`, and accepts a valid line.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Draft candidates.** Run `npm run eval:draft` and expect ~80 lines in `data/eval/candidates.jsonl`. It's resumable: rerun after a quota stop and it skips ids already present.
- [ ] **Step 6 (owner checkpoint): review the questions.**
  - The owner keeps about 40 questions, covering every company and Items 1A, 7, and 8, and edits their wording.
  - They add extra `goldKeys` when other chunks also answer a question (`npm run search -- "<question>"` helps find them).
  - The kept lines are saved to `data/eval/questions.jsonl`, with `answer` removed.
- [ ] **Step 7: Finalize the eval data.** Run `npm run eval:finalize` and expect `eval: 40 questions, samples: 6`.
- [ ] **Step 8: Commit.** `git add -A && git commit -m "feat: scorecard runner and reviewed evaluation set"`

---

## Plan 1 done when

- `npm test` and `npm run typecheck` are green.
- `public/data/manifest.json` lists the corpus, vectors, eval, and samples files, all within the budget.
- `npm run search` answers the NVIDIA sample with NVDA Item 1A passages.
