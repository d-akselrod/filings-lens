import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { EMBED_MODEL } from '../src/core/embeddings';
import { encodeF16 } from '../src/core/float16';
import type { CorpusFile, Manifest } from '../src/core/types';

export const FIRST_VISIT_BUDGET_BYTES = 15_000_000;
/** PGlite runtime (~5.6 MB gzipped, measured) plus the app bundle. */
export const RUNTIME_ALLOWANCE_BYTES = 6_000_000;
const DIMS = 768;

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetError';
  }
}

const sha8 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex').slice(0, 8);
const STALE = /^(corpus\.[0-9a-f]{8}\.json|vectors\.[0-9a-f]{8}\.f16)$/;

async function readManifest(publicDir: string): Promise<Partial<Manifest>> {
  try {
    return JSON.parse(await readFile(join(publicDir, 'manifest.json'), 'utf8')) as Partial<Manifest>;
  } catch {
    return {};
  }
}

/** Writes hash-named corpus + float16 vector files and the manifest that points at them. */
export async function writeDataFiles(corpus: CorpusFile, vectorsByKey: Map<string, Float32Array>,
  o: { publicDir: string; budgetBytes?: number }): Promise<Manifest> {
  const all = new Float32Array(corpus.chunks.length * DIMS);
  corpus.chunks.forEach((chunk, i) => {
    if (chunk.id !== i) throw new Error(`chunk ids must be 0..N-1 in order; found ${chunk.id} at ${i}`);
    const v = vectorsByKey.get(chunk.key);
    if (!v || v.length !== DIMS) throw new Error(`chunk ${chunk.key} has ${v ? `a ${v.length}-dim` : 'no'} vector; expected ${DIMS}`);
    all.set(v, i * DIMS);
  });
  const vectors = encodeF16(all);
  const corpusJson = JSON.stringify(corpus);
  const gzipBytes = gzipSync(corpusJson, { level: 9 }).byteLength;

  const budget = o.budgetBytes ?? FIRST_VISIT_BUDGET_BYTES;
  const firstVisit = vectors.byteLength + gzipBytes + RUNTIME_ALLOWANCE_BYTES;
  if (firstVisit > budget) {
    throw new BudgetError(`first visit would be ${firstVisit} bytes (vectors ${vectors.byteLength} + gzipped corpus ${gzipBytes} + runtime ${RUNTIME_ALLOWANCE_BYTES}) > budget ${budget}`);
  }

  const corpusFile = `corpus.${sha8(corpusJson)}.json`;
  const vectorsFile = `vectors.${sha8(vectors)}.f16`;
  const versioned = join(o.publicDir, 'v');
  await mkdir(versioned, { recursive: true });
  for (const name of await readdir(versioned)) {
    if (STALE.test(name) && name !== corpusFile && name !== vectorsFile) await rm(join(versioned, name));
  }
  await writeFile(join(versioned, corpusFile), corpusJson);
  await writeFile(join(versioned, vectorsFile), vectors);

  const previous = await readManifest(o.publicDir);
  const manifest: Manifest = {
    schemaVersion: 1, builtAt: new Date().toISOString(), embeddingModel: EMBED_MODEL, dims: 768, vectorEncoding: 'f16le',
    chunkCount: corpus.chunks.length,
    corpus: { file: `v/${corpusFile}`, bytes: Buffer.byteLength(corpusJson), gzipBytes },
    vectors: { file: `v/${vectorsFile}`, bytes: vectors.byteLength },
    ...(previous.eval ? { eval: previous.eval } : {}),
    ...(previous.samples ? { samples: previous.samples } : {}),
  };
  await writeFile(join(o.publicDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
