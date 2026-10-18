export type Metric = 'cosine' | 'l2' | 'dot';
export type Dims = 128 | 256 | 512 | 768;
export type SearchMode = 'hybrid' | 'vector' | 'keyword';

/** An empty array means "no filter" for that dimension. */
export interface SearchFilters { tickers: string[]; fiscalYears: number[]; items: string[] }

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
  chunkId: number;
  /** 1-based */
  finalRank: number;
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

/** Returns one score per passage; higher = more relevant. */
export type RerankFn = (query: string, passages: string[]) => Promise<number[]>;

export interface CompanyRow { id: number; ticker: string; name: string; cik: string }
export interface FilingRow { id: number; companyId: number; form: '10-K'; fiscalYear: number; periodEnd: string; filedAt: string; accession: string; url: string }
/** key format: `${accession}:${item}:${ordinal}` */
export interface ChunkRow { id: number; key: string; filingId: number; item: string; itemTitle: string; ordinal: number; text: string; tokenCount: number }
export interface CorpusFile { schemaVersion: 1; companies: CompanyRow[]; filings: FilingRow[]; chunks: ChunkRow[] }
export interface ChunkView extends ChunkRow { ticker: string; companyName: string; fiscalYear: number; form: '10-K'; url: string; accession: string }
export interface Facets { tickers: string[]; fiscalYears: number[]; items: Array<{ item: string; title: string }> }

export interface Manifest {
  schemaVersion: 1; builtAt: string; embeddingModel: string; dims: 768; vectorEncoding: 'f16le';
  chunkCount: number;
  /** file is relative to /data/, e.g. "v/corpus.1a2b3c4d.json" */
  corpus: { file: string; bytes: number; gzipBytes: number };
  vectors: { file: string; bytes: number };
  samples?: { file: string; count: number };
}

/** Sample questions with precomputed query vectors (base64 float16), so they search without an embedding call. */
export interface SamplesFile { schemaVersion: 1; samples: Array<{ question: string; vector: string }> }

/** Orders 10-K item codes: 1 < 1A < 1B < 1C < 2 < … < 7 < 7A < 8 < 9 < 9A … */
export function compareItems(a: string, b: string): number {
  const [na, la] = splitItem(a);
  const [nb, lb] = splitItem(b);
  return na - nb || la.localeCompare(lb);
}

function splitItem(item: string): [number, string] {
  const match = /^(\d+)([a-z]?)$/i.exec(item.trim());
  return match ? [Number(match[1]), (match[2] ?? '').toUpperCase()] : [Number.MAX_SAFE_INTEGER, item];
}
