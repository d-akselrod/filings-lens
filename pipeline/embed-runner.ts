import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EMBED_DIMS, EMBED_MODEL, embedBatch, GeminiError } from '../src/core/gemini';

export class QuotaExhaustedError extends Error {
  constructor() {
    super('Free-tier quota exhausted; progress is cached — rerun later');
    this.name = 'QuotaExhaustedError';
  }
}

const SERVER_RETRY_DELAYS = [5_000, 10_000, 20_000];
const DEFAULT_QUOTA_DELAY = 60_000;
const MAX_QUOTA_DELAY = 900_000;

const hashOf = (text: string) => createHash('sha256').update(`${EMBED_MODEL}|${EMBED_DIMS}|${text}`).digest('hex');

async function readCached(path: string): Promise<Float32Array | null> {
  try {
    const buf = await readFile(path);
    return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  } catch {
    return null;
  }
}

async function writeCached(path: string, v: Float32Array): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  await rename(tmp, path);
}

/** Embeds item texts with a per-text disk cache, so an interrupted run resumes where it stopped. */
export async function embedWithCache(items: Array<{ key: string; text: string }>, o: {
  apiKey: string; cacheDir: string; batchSize?: number; embed?: typeof embedBatch;
  sleep?: (ms: number) => Promise<void>; onProgress?: (done: number, total: number) => void; maxConsecutiveQuota?: number;
  onRetry?: (reason: 'quota' | 'server' | 'network', waitMs: number, message: string) => void;
  /** Minimum ms between the starts of consecutive API calls, to stay under per-minute limits. */
  paceMs?: number; now?: () => number;
}): Promise<Map<string, Float32Array>> {
  const embed = o.embed ?? embedBatch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const batchSize = o.batchSize ?? 100;
  const maxQuota = o.maxConsecutiveQuota ?? 6;
  await mkdir(o.cacheDir, { recursive: true });

  const byHash = new Map<string, Float32Array>();
  const pending = new Map<string, string>(); // hash → text
  for (const item of items) {
    const hash = hashOf(item.text);
    if (byHash.has(hash) || pending.has(hash)) continue;
    const cached = await readCached(join(o.cacheDir, `${hash}.f32`));
    if (cached) byHash.set(hash, cached);
    else pending.set(hash, item.text);
  }

  const total = new Set(items.map(i => hashOf(i.text))).size;
  o.onProgress?.(byHash.size, total);
  const queue = [...pending.entries()];
  let consecutiveQuota = 0;
  let serverRetries = 0;
  const now = o.now ?? Date.now;
  let lastCall = -Infinity;
  for (let start = 0; start < queue.length;) {
    const batch = queue.slice(start, start + batchSize);
    let vectors: Float32Array[];
    const paceWait = lastCall + (o.paceMs ?? 0) - now();
    if (paceWait > 0) await sleep(paceWait);
    lastCall = now();
    try {
      vectors = await embed(o.apiKey, batch.map(([, text]) => text));
    } catch (e) {
      if (e instanceof GeminiError && e.reason === 'quota') {
        consecutiveQuota++;
        if (consecutiveQuota >= maxQuota) throw new QuotaExhaustedError();
        const waitMs = Math.min((e.retryAfterMs ?? DEFAULT_QUOTA_DELAY) * 2 ** (consecutiveQuota - 1), MAX_QUOTA_DELAY);
        o.onRetry?.('quota', waitMs, e.message);
        await sleep(waitMs);
        continue;
      }
      if (e instanceof GeminiError && (e.reason === 'server' || e.reason === 'network') && serverRetries < SERVER_RETRY_DELAYS.length) {
        const waitMs = SERVER_RETRY_DELAYS[serverRetries++]!;
        o.onRetry?.(e.reason, waitMs, e.message);
        await sleep(waitMs);
        continue;
      }
      throw e;
    }
    consecutiveQuota = 0;
    serverRetries = 0;
    for (const [i, [hash]] of batch.entries()) {
      const v = vectors[i];
      if (!v || v.length !== EMBED_DIMS) throw new Error(`embedding ${i} of batch has length ${v?.length}; expected ${EMBED_DIMS}`);
      await writeCached(join(o.cacheDir, `${hash}.f32`), v);
      byHash.set(hash, v);
    }
    start += batch.length;
    o.onProgress?.(byHash.size, total);
  }

  return new Map(items.map(item => [item.key, byHash.get(hashOf(item.text))!]));
}
