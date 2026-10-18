import type { RerankFn } from '../core/types';

export const RERANK_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';
const BATCH_SIZE = 8;

export interface RerankerBackend {
  /** Query/passage pairs with padding and truncation to 512 tokens. */
  tokenize(queries: string[], passages: string[]): unknown;
  /** One relevance logit per pair. */
  run(inputs: unknown): Promise<Float32Array | number[]>;
}

/** Folds transformers.js per-file progress events into one loaded/total pair across every file. */
export function progressAcrossFiles(onProgress?: (loaded: number, total: number) => void): (event: unknown) => void {
  const files = new Map<string, { loaded: number; total: number }>();
  return event => {
    const e = event as { status?: string; file?: string; loaded?: number; total?: number };
    if (e.status !== 'progress' || !e.file) return;
    files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    onProgress?.(loaded, total);
  };
}

/** 'wasm' in the browser; transformers.js's Node build only offers 'cpu' (used by the real-model test). */
export function transformersBackend(device: 'wasm' | 'cpu' = 'wasm') {
  return async (onProgress?: (loaded: number, total: number) => void): Promise<RerankerBackend> => {
    const { AutoModelForSequenceClassification, AutoTokenizer } = await import('@huggingface/transformers');
    const progress_callback = progressAcrossFiles(onProgress);
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(RERANK_MODEL, { progress_callback }),
      AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, { dtype: 'q8', device, progress_callback }),
    ]);
    return {
      tokenize: (queries, passages) => tokenizer(queries, { text_pair: passages, padding: true, truncation: true, max_length: 512 }),
      run: async inputs => ((await model(inputs)) as { logits: { data: Float32Array } }).logits.data,
    };
  };
}

export async function loadReranker(
  onProgress?: (loaded: number, total: number) => void,
  load: (onProgress?: (loaded: number, total: number) => void) => Promise<RerankerBackend> = transformersBackend(),
): Promise<RerankFn> {
  const backend = await load(onProgress);
  return async (query, passages) => {
    const scores: number[] = [];
    for (let i = 0; i < passages.length; i += BATCH_SIZE) {
      const batch = passages.slice(i, i + BATCH_SIZE);
      const logits = await backend.run(backend.tokenize(batch.map(() => query), batch));
      for (const logit of logits) scores.push(1 / (1 + Math.exp(-logit)));
    }
    return scores;
  };
}
