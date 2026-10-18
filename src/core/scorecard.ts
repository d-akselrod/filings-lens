import type { SearchEngine } from './engine.js';
import { decodeF16, encodeF16 } from './float16.js';
import { mrrAtK, ndcgAtK, recallAtK } from './metrics.js';
import type { RerankFn, SearchFilters, SearchSettings } from './types.js';

export type BaselineName = 'current' | 'vector' | 'keyword' | 'hybrid' | 'hybrid+rerank';

export const BASELINES: ReadonlyArray<{ name: Exclude<BaselineName, 'current'>; patch: Partial<SearchSettings> }> = [
  { name: 'vector', patch: { mode: 'vector', rerank: false } },
  { name: 'keyword', patch: { mode: 'keyword', rerank: false } },
  { name: 'hybrid', patch: { mode: 'hybrid', rerank: false } },
  { name: 'hybrid+rerank', patch: { mode: 'hybrid', rerank: true } },
];

export interface ScoreRow { name: BaselineName; recall5: number; recall10: number; mrr10: number; ndcg10: number }
export interface EvalItem { id: string; question: string; goldIds: number[]; vector: Float32Array }
export interface ScorecardResult {
  rows: ScoreRow[];
  perQuestion: Array<{ id: string; question: string; firstGoldRank: Partial<Record<BaselineName, number | null>> }>;
}

export type EvalStyle = 'number' | 'risk' | 'strategy' | 'comparison' | 'other';
export interface EvalFile {
  schemaVersion: 1;
  questions: Array<{ id: string; question: string; goldKeys: string[]; ticker: string; item: string; style: EvalStyle; vector: string }>;
}
export interface SamplesFile { schemaVersion: 1; samples: Array<{ question: string; vector: string }> }

const NO_FILTERS: SearchFilters = { tickers: [], fiscalYears: [], items: [] };

/** Retrieval accuracy for the current settings and each baseline; filters are ignored, candidates ≥ 10. */
export async function runScorecard(engine: Pick<SearchEngine, 'search'>, items: EvalItem[], current: SearchSettings,
  rerank: RerankFn | undefined, onProgress?: (done: number, total: number) => void): Promise<ScorecardResult> {
  const base: SearchSettings = { ...current, filters: NO_FILTERS, candidates: Math.max(current.candidates, 10) };
  const runs: Array<{ name: BaselineName; settings: SearchSettings }> = [
    { name: 'current', settings: base },
    ...BASELINES.filter(b => b.name !== 'hybrid+rerank' || rerank).map(b => ({ name: b.name, settings: { ...base, ...b.patch } })),
  ];
  const perQuestion: ScorecardResult['perQuestion'] = items.map(i => ({ id: i.id, question: i.question, firstGoldRank: {} }));
  const total = items.length * runs.length;
  let done = 0;
  const rows: ScoreRow[] = [];
  for (const run of runs) {
    const sum = { recall5: 0, recall10: 0, mrr10: 0, ndcg10: 0 };
    for (const [qi, item] of items.entries()) {
      const r = await engine.search({ text: item.question, vector: item.vector }, run.settings, run.settings.rerank ? rerank : undefined);
      const ranked = r.results.map(x => x.chunkId);
      const gold = new Set(item.goldIds);
      sum.recall5 += recallAtK(ranked, gold, 5);
      sum.recall10 += recallAtK(ranked, gold, 10);
      sum.mrr10 += mrrAtK(ranked, gold, 10);
      sum.ndcg10 += ndcgAtK(ranked, gold, 10);
      const first = ranked.findIndex(id => gold.has(id));
      perQuestion[qi]!.firstGoldRank[run.name] = first === -1 ? null : first + 1;
      onProgress?.(++done, total);
    }
    const n = items.length || 1;
    rows.push({ name: run.name, recall5: sum.recall5 / n, recall10: sum.recall10 / n, mrr10: sum.mrr10 / n, ndcg10: sum.ndcg10 / n });
  }
  return { rows, perQuestion };
}

/** float16 little-endian bytes, base64-encoded (works in Node and browsers). */
export function encodeVectorB64(v: Float32Array): string {
  let binary = '';
  for (const byte of encodeF16(v)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeVectorB64(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return decodeF16(bytes);
}
