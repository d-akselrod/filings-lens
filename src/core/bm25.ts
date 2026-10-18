import type { PGlite } from '@electric-sql/pglite';
import type { Hit, SearchFilters } from './types';

/** Params: $1 terms, $2 k1, $3 b, $4 tickers, $5 fiscal years, $6 items, $7 limit. Empty filter arrays mean "all". */
export const BM25_SQL = `
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
`;

export async function bm25Search(db: Pick<PGlite, 'query'>, terms: string[],
  p: { k1: number; b: number; limit: number; filters: SearchFilters }): Promise<Hit[]> {
  const unique = [...new Set(terms)];
  if (unique.length === 0) return [];
  const { rows } = await db.query<{ id: number; score: number }>(BM25_SQL,
    [unique, p.k1, p.b, p.filters.tickers, p.filters.fiscalYears, p.filters.items, p.limit]);
  return rows.map(r => ({ id: r.id, score: r.score }));
}
