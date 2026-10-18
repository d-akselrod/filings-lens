import { embedBatch, streamGenerate } from '../src/core/gemini';
import { loadCorpusLookup, type CorpusLookup } from './corpus';
import { readEnv } from './env';
import type { Deps } from './handlers';
import { memoryStore, upstashStore } from './limits';

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
