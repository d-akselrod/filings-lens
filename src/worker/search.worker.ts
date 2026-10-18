import type { PGlite } from '@electric-sql/pglite';
import * as Comlink from 'comlink';
import { SearchEngine } from '../core/engine';
import { loadCorpus, openDb, type LoadStep } from '../core/load';
import { decodeVectorB64, runScorecard, type EvalItem } from '../core/scorecard';
import type { RerankFn } from '../core/types';
import { loadData } from './load-data';
import type { LoadPhase, Sample, WorkerApi } from './protocol';
import { loadReranker } from './reranker';

const PHASE_OF_STEP: Record<LoadStep, LoadPhase> = { schema: 'database', rows: 'database', 'keyword-index': 'keyword-index', analyze: 'keyword-index' };

export function createWorkerApi(d: {
  baseUrl: string;
  fetch?: typeof fetch;
  loadReranker?: (onProgress: (loaded: number, total: number) => void) => Promise<RerankFn>;
  openDb?: () => Promise<PGlite>;
}): WorkerApi {
  let engine: SearchEngine | null = null;
  let evalItems: EvalItem[] | null = null;
  let samples: Sample[] = [];
  let rerank: RerankFn | undefined;
  let rerankLoading: Promise<void> | null = null;

  const loaded = (): SearchEngine => {
    if (!engine) throw new Error('The search engine is still loading');
    return engine;
  };

  return {
    async init(onProgress) {
      // PGlite's wasm download and compile overlap the data download instead of following it.
      const opening = (d.openDb ?? openDb)();
      let data: Awaited<ReturnType<typeof loadData>>;
      try {
        data = await loadData(d.baseUrl, onProgress, d.fetch);
      } catch (e) {
        void opening.then(db => db.close(), () => {});
        throw e;
      }
      const db = await opening;
      let last: LoadPhase | null = null;
      await loadCorpus(db, data.corpus, data.vectors, step => {
        const phase = PHASE_OF_STEP[step];
        if (phase !== last) onProgress({ phase });
        last = phase;
      });
      onProgress({ phase: 'vectors' });
      engine = await SearchEngine.open(db);
      const facets = await engine.facets();

      const idByKey = new Map(data.corpus.chunks.map(c => [c.key, c.id]));
      evalItems = data.evalFile?.questions.map(q => ({
        id: q.id, question: q.question, vector: decodeVectorB64(q.vector),
        goldIds: q.goldKeys.flatMap(key => idByKey.get(key) ?? []),
      })) ?? null;
      samples = data.samplesFile?.samples.map(s => ({ question: s.question, vector: decodeVectorB64(s.vector) })) ?? [];

      onProgress({ phase: 'ready' });
      return { manifest: data.manifest, chunkCount: engine.count, facets, hasEval: evalItems !== null };
    },
    async search(q, s) {
      return loaded().search(q, s, rerank);
    },
    async getChunks(ids) {
      return loaded().getChunks(ids);
    },
    async samples() {
      return samples;
    },
    async loadReranker(onProgress) {
      const load = d.loadReranker;
      if (!load) throw new Error('Reranker is not available');
      rerankLoading ??= load(onProgress).then(
        fn => { rerank = fn; },
        (e: unknown) => { rerankLoading = null; throw e; },
      );
      return rerankLoading;
    },
    async scorecard(s, onProgress) {
      if (!evalItems) throw new Error('No evaluation set');
      return runScorecard(loaded(), evalItems, s, rerank, onProgress);
    },
  };
}

if (typeof WorkerGlobalScope !== 'undefined') {
  Comlink.expose(createWorkerApi({ baseUrl: '/data', loadReranker }));
}
