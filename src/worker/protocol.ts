import type { ScorecardResult } from '../core/scorecard';
import type { ChunkView, Facets, Manifest, SearchResponse, SearchSettings } from '../core/types';

export type LoadPhase = 'manifest' | 'download' | 'database' | 'keyword-index' | 'vectors' | 'ready';
export interface LoadProgress { phase: LoadPhase; loadedBytes?: number; totalBytes?: number }
export interface InitResult { manifest: Manifest; chunkCount: number; facets: Facets; hasEval: boolean }
export interface Sample { question: string; vector: Float32Array }

/** What the search worker exposes over Comlink; callbacks must be wrapped with Comlink.proxy by the caller. */
export interface WorkerApi {
  init(onProgress: (p: LoadProgress) => void): Promise<InitResult>;
  search(q: { text: string; vector: Float32Array | null }, s: SearchSettings): Promise<SearchResponse>;
  getChunks(ids: number[]): Promise<ChunkView[]>;
  samples(): Promise<Sample[]>;
  loadReranker(onProgress: (loaded: number, total: number) => void): Promise<void>;
  scorecard(s: SearchSettings, onProgress: (done: number, total: number) => void): Promise<ScorecardResult>;
}
