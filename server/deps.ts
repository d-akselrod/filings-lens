import { embedBatch } from '../src/core/embeddings.js';
import { streamGenerate } from '../src/core/gemini.js';
import { loadCorpusLookup, type CorpusLookup } from './corpus.js';
import { readEnv } from './env.js';
import type { Deps } from './handlers.js';
import { memoryStore, upstashStore } from './limits.js';

let deps: Deps | null = null;

/** Production dependencies, built once per function instance. */
export function getDeps(): Deps {
  if (deps) return deps;
  const env = readEnv(process.env);
  if (!env.upstash) console.warn('No Upstash Redis configured: daily limits are per function instance.');
  let corpus: Promise<CorpusLookup> | null = null;
  deps = {
    env,
    store: env.upstash ? upstashStore(env.upstash.url, env.upstash.token) : memoryStore(),
    corpus: () => (corpus ??= loadCorpusLookup(process.cwd())),
    now: () => new Date(),
    embed: (apiKey, texts) => embedBatch(apiKey, texts),
    stream: (apiKey, r) => streamGenerate(apiKey, r),
  };
  return deps;
}
