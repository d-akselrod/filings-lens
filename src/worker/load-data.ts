import type { EvalFile, SamplesFile } from '../core/scorecard';
import type { CorpusFile, Manifest } from '../core/types';
import type { LoadProgress } from './protocol';

/** Reads a response body chunk by chunk; `loaded` counts decoded bytes, so it matches the manifest sizes under compression. */
export async function fetchWithProgress(url: string, onBytes: (loaded: number) => void, f: typeof fetch = fetch): Promise<Uint8Array> {
  const res = await f(url);
  if (!res.ok || !res.body) throw new Error(`Could not load ${url} (${res.status})`);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onBytes(loaded);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function fetchJson<T>(url: string, f: typeof fetch): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await fetchWithProgress(url, () => {}, f))) as T;
}

export async function loadData(baseUrl: string, onProgress: (p: LoadProgress) => void, f: typeof fetch = fetch): Promise<{
  manifest: Manifest; corpus: CorpusFile; vectors: Uint8Array; evalFile: EvalFile | null; samplesFile: SamplesFile | null;
}> {
  onProgress({ phase: 'manifest' });
  const res = await f(`${baseUrl}/manifest.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load manifest (${res.status})`);
  const manifest = (await res.json()) as Manifest;

  const totalBytes = manifest.corpus.bytes + manifest.vectors.bytes;
  let corpusBytes = 0;
  let vectorBytes = 0;
  let reportedPercent = -1;
  // Network chunks are tens of KB, so per-chunk updates would mean hundreds of UI renders; one per percent is enough.
  const report = () => {
    const loadedBytes = corpusBytes + vectorBytes;
    const percent = totalBytes > 0 ? Math.floor((loadedBytes / totalBytes) * 100) : 100;
    if (percent === reportedPercent) return;
    reportedPercent = percent;
    onProgress({ phase: 'download', loadedBytes, totalBytes });
  };
  report();
  const [corpusRaw, vectors] = await Promise.all([
    fetchWithProgress(`${baseUrl}/${manifest.corpus.file}`, n => { corpusBytes = n; report(); }, f),
    fetchWithProgress(`${baseUrl}/${manifest.vectors.file}`, n => { vectorBytes = n; report(); }, f),
  ]);
  const corpus = JSON.parse(new TextDecoder().decode(corpusRaw)) as CorpusFile;

  const [evalFile, samplesFile] = await Promise.all([
    manifest.eval ? fetchJson<EvalFile>(`${baseUrl}/${manifest.eval.file}`, f) : null,
    manifest.samples ? fetchJson<SamplesFile>(`${baseUrl}/${manifest.samples.file}`, f) : null,
  ]);
  return { manifest, corpus, vectors, evalFile, samplesFile };
}
