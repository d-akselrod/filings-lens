import { PGlite } from '@electric-sql/pglite';
import { csvRow } from './csv';
import { buildPostings } from './postings';
import { SCHEMA_SQL } from './schema';
import type { CorpusFile } from './types';

export type LoadStep = 'schema' | 'rows' | 'keyword-index' | 'analyze';

const VECTOR_BYTES = 768 * 2;

export async function openDb(): Promise<PGlite> {
  return PGlite.create('memory://');
}

async function copy(db: PGlite, table: string, columns: string[], rows: string[]): Promise<void> {
  await db.query(`COPY ${table} (${columns.join(', ')}) FROM '/dev/blob' WITH (FORMAT csv)`, [], { blob: new Blob(rows) });
}

/** Builds the search database (rows, float16 vectors, BM25 tables) from the shipped data files. */
export async function loadCorpus(db: PGlite, corpus: CorpusFile, vectors: Uint8Array, onStep?: (s: LoadStep) => void): Promise<void> {
  const { companies, filings, chunks } = corpus;
  if (!chunks.every((c, i) => c.id === i)) throw new Error('chunk ids must be exactly 0..N-1 in order');
  if (vectors.length !== chunks.length * VECTOR_BYTES) {
    throw new Error(`vectors has ${vectors.length} bytes; expected ${chunks.length * VECTOR_BYTES} for ${chunks.length} chunks`);
  }

  onStep?.('schema');
  await db.exec(SCHEMA_SQL);

  onStep?.('rows');
  const postings = buildPostings(chunks.map(c => c.text));
  await copy(db, 'companies', ['id', 'ticker', 'name', 'cik'], companies.map(c => csvRow([c.id, c.ticker, c.name, c.cik])));
  await copy(db, 'filings', ['id', 'company_id', 'form', 'fiscal_year', 'period_end', 'filed_at', 'accession', 'url'],
    filings.map(f => csvRow([f.id, f.companyId, f.form, f.fiscalYear, f.periodEnd, f.filedAt, f.accession, f.url])));
  await copy(db, 'chunks', ['id', 'key', 'filing_id', 'item', 'item_title', 'ordinal', 'text', 'token_count', 'bm25_len', 'embedding'],
    chunks.map(c => csvRow([c.id, c.key, c.filingId, c.item, c.itemTitle, c.ordinal, c.text, c.tokenCount,
      postings.lengths[c.id]!, vectors.subarray(c.id * VECTOR_BYTES, (c.id + 1) * VECTOR_BYTES)])));

  onStep?.('keyword-index');
  await copy(db, 'terms', ['id', 'term', 'df', 'chunk_ids', 'tfs'],
    postings.terms.map(t => csvRow([t.id, t.term, t.df, t.chunkIds, t.tfs])));
  await db.query('INSERT INTO corpus_stats (n, avgdl) VALUES ($1, $2)', [postings.n, postings.avgdl]);

  onStep?.('analyze');
  await db.exec('ANALYZE');
}
