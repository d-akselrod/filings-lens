import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SearchEngine } from '../src/core/engine';
import { loadCorpus, openDb } from '../src/core/load';
import type { CorpusFile, Manifest } from '../src/core/types';

export async function readDataFiles(publicDir: string): Promise<{ manifest: Manifest; corpus: CorpusFile; vectors: Uint8Array }> {
  const manifest = JSON.parse(await readFile(join(publicDir, 'manifest.json'), 'utf8')) as Manifest;
  const corpus = JSON.parse(await readFile(join(publicDir, manifest.corpus.file), 'utf8')) as CorpusFile;
  const vectors = new Uint8Array(await readFile(join(publicDir, manifest.vectors.file)));
  return { manifest, corpus, vectors };
}

/** Node equivalent of the browser worker's load path, for the CLIs and tests. */
export async function loadEngineFromDisk(publicDir: string): Promise<{ engine: SearchEngine; manifest: Manifest; corpus: CorpusFile }> {
  const { manifest, corpus, vectors } = await readDataFiles(publicDir);
  const db = await openDb();
  await loadCorpus(db, corpus, vectors);
  return { engine: await SearchEngine.open(db), manifest, corpus };
}
