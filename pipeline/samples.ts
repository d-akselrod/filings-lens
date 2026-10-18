import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Manifest, SamplesFile } from '../src/core/types';

export async function readJsonl(path: string): Promise<unknown[]> {
  const text = await readFile(path, 'utf8');
  return text.split('\n').flatMap((line, i) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      throw new Error(`${path}:${i + 1} is not valid JSON`);
    }
  });
}

const sha8 = (data: string) => createHash('sha256').update(data).digest('hex').slice(0, 8);
const STALE = /^samples\.[0-9a-f]{8}\.json$/;

/** Writes the hash-named samples file next to the corpus and points the manifest at it. */
export async function writeSamplesFile(publicDir: string, samplesFile: SamplesFile): Promise<Manifest> {
  const json = JSON.stringify(samplesFile);
  const name = `samples.${sha8(json)}.json`;
  const versioned = join(publicDir, 'v');
  await mkdir(versioned, { recursive: true });
  for (const old of await readdir(versioned)) {
    if (STALE.test(old) && old !== name) await rm(join(versioned, old));
  }
  await writeFile(join(versioned, name), json);
  const manifest = JSON.parse(await readFile(join(publicDir, 'manifest.json'), 'utf8')) as Manifest;
  manifest.samples = { file: `v/${name}`, count: samplesFile.samples.length };
  await writeFile(join(publicDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
