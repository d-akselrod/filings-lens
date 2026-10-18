import type { PGlite } from '@electric-sql/pglite';
import { bm25Search } from './bm25';
import { decodeF16 } from './float16';
import { fuseRrf } from './fusion';
import { tokenize } from './tokenize';
import {
  compareItems, type ChunkView, type Facets, type Hit, type RankedResult, type RerankFn,
  type SearchFilters, type SearchNote, type SearchResponse, type SearchSettings,
} from './types';
import { scan, type VectorMatrix } from './vector';

const WIDTH = 768;

const FILTER_SQL = `
SELECT c.id FROM chunks c
JOIN filings f ON f.id = c.filing_id
JOIN companies co ON co.id = f.company_id
WHERE (cardinality($1::text[]) = 0 OR co.ticker = ANY($1::text[]))
  AND (cardinality($2::int[]) = 0 OR f.fiscal_year = ANY($2::int[]))
  AND (cardinality($3::text[]) = 0 OR c.item = ANY($3::text[]))`;

const CHUNK_VIEW_SQL = `
SELECT c.id, c.key, c.filing_id AS "filingId", c.item, c.item_title AS "itemTitle", c.ordinal, c.text,
  c.token_count AS "tokenCount", co.ticker, co.name AS "companyName", f.fiscal_year AS "fiscalYear",
  f.form, f.url, f.accession
FROM chunks c
JOIN filings f ON f.id = c.filing_id
JOIN companies co ON co.id = f.company_id
WHERE c.id = ANY($1::int[])`;

const hasFilters = (f: SearchFilters) => f.tickers.length > 0 || f.fiscalYears.length > 0 || f.items.length > 0;

export class SearchEngine {
  private readonly allowCache = new Map<string, Uint8Array>();

  private constructor(private readonly db: PGlite, private readonly matrix: VectorMatrix) {}

  /** Reads every embedding out of PGlite into one contiguous Float32Array for the hand-written scan. */
  static async open(db: PGlite): Promise<SearchEngine> {
    const { rows } = await db.query<{ id: number; embedding: Uint8Array }>('SELECT id, embedding FROM chunks ORDER BY id');
    const data = new Float32Array(rows.length * WIDTH);
    rows.forEach((row, i) => {
      if (row.id !== i) throw new Error(`chunk ids are not dense: expected ${i}, got ${row.id}`);
      decodeF16(row.embedding, data.subarray(i * WIDTH, (i + 1) * WIDTH));
    });
    return new SearchEngine(db, { data, count: rows.length, width: WIDTH });
  }

  get count(): number {
    return this.matrix.count;
  }

  async search(q: { text: string; vector: Float32Array | null }, s: SearchSettings, rerank?: RerankFn): Promise<SearchResponse> {
    const notes: SearchNote[] = [];
    const timings = { vectorMs: 0, keywordMs: 0, fuseMs: 0, rerankMs: 0 };
    let usedMode = s.mode;
    if (usedMode !== 'keyword' && !q.vector) {
      notes.push('no-query-vector');
      usedMode = 'keyword';
    }
    const allow = await this.allowed(s.filters);

    let vectorHits: Hit[] = [];
    if (usedMode !== 'keyword' && q.vector) {
      const t = performance.now();
      vectorHits = scan(this.matrix, q.vector, { metric: s.metric, dims: s.dims, renormalize: s.renormalize, k: s.candidates, allow });
      timings.vectorMs = performance.now() - t;
    }

    let keywordHits: Hit[] = [];
    if (usedMode !== 'vector') {
      const terms = tokenize(q.text);
      if (terms.length === 0) {
        notes.push('no-keyword-terms');
      } else {
        const t = performance.now();
        keywordHits = await bm25Search(this.db, terms, { k1: s.k1, b: s.b, limit: s.candidates, filters: s.filters });
        timings.keywordMs = performance.now() - t;
      }
    }

    const tFuse = performance.now();
    const alpha = usedMode === 'hybrid' ? s.alpha : usedMode === 'vector' ? 1 : 0;
    const fused = fuseRrf(vectorHits, keywordHits, { k: s.rrfK, alpha }).slice(0, s.candidates);
    timings.fuseMs = performance.now() - tFuse;
    if (fused.length === 0) {
      notes.push('no-matches');
      return { results: [], usedMode, notes, timings };
    }

    const vectorById = new Map(vectorHits.map((h, i) => [h.id, { rank: i + 1, distance: h.score }]));
    const keywordById = new Map(keywordHits.map((h, i) => [h.id, { rank: i + 1, score: h.score }]));
    let ordered: Array<Omit<RankedResult, 'finalRank'>> = fused.map((f, i) => {
      const r: Omit<RankedResult, 'finalRank'> = { chunkId: f.id, fused: { rank: i + 1, score: f.score } };
      const v = vectorById.get(f.id);
      const k = keywordById.get(f.id);
      if (v) r.vector = v;
      if (k) r.keyword = k;
      return r;
    });

    if (s.rerank && !rerank) {
      notes.push('reranker-unavailable');
    } else if (s.rerank && rerank) {
      const t = performance.now();
      const headSize = Math.min(s.rerankTop, ordered.length);
      const head = ordered.slice(0, headSize);
      const scores = await rerank(q.text, await this.texts(head.map(r => r.chunkId)));
      const rescored = head
        .map((r, i) => ({ r, score: scores[i]! }))
        .sort((a, b) => b.score - a.score || a.r.fused.rank - b.r.fused.rank)
        .map(({ r, score }, i) => ({ ...r, rerank: { rank: i + 1, score } }));
      ordered = [...rescored, ...ordered.slice(headSize)];
      timings.rerankMs = performance.now() - t;
    }

    return { results: ordered.map((r, i) => ({ ...r, finalRank: i + 1 })), usedMode, notes, timings };
  }

  async getChunks(ids: number[]): Promise<ChunkView[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.db.query<ChunkView>(CHUNK_VIEW_SQL, [ids]);
    const byId = new Map(rows.map(r => [r.id, r]));
    return ids.flatMap(id => byId.get(id) ?? []);
  }

  async facets(): Promise<Facets> {
    const tickers = await this.db.query<{ ticker: string }>('SELECT ticker FROM companies ORDER BY id');
    const years = await this.db.query<{ year: number }>('SELECT DISTINCT fiscal_year AS year FROM filings ORDER BY year DESC');
    const items = await this.db.query<{ item: string; title: string }>('SELECT DISTINCT item, item_title AS title FROM chunks');
    return {
      tickers: tickers.rows.map(r => r.ticker),
      fiscalYears: years.rows.map(r => r.year),
      items: items.rows.sort((a, b) => compareItems(a.item, b.item)),
    };
  }

  private async texts(ids: number[]): Promise<string[]> {
    const { rows } = await this.db.query<{ id: number; text: string }>('SELECT id, text FROM chunks WHERE id = ANY($1::int[])', [ids]);
    const byId = new Map(rows.map(r => [r.id, r.text]));
    return ids.map(id => byId.get(id) ?? '');
  }

  private async allowed(filters: SearchFilters): Promise<Uint8Array | null> {
    if (!hasFilters(filters)) return null;
    const key = JSON.stringify(filters);
    let allow = this.allowCache.get(key);
    if (!allow) {
      const { rows } = await this.db.query<{ id: number }>(FILTER_SQL, [filters.tickers, filters.fiscalYears, filters.items]);
      allow = new Uint8Array(this.matrix.count);
      for (const row of rows) allow[row.id] = 1;
      this.allowCache.set(key, allow);
    }
    return allow;
  }
}
