/** Test-only: Plan 1 data files in a temp directory, served by a fake fetch that streams each body in 3 chunks. */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeEvalFiles } from '../../pipeline/eval';
import { writeDataFiles } from '../../pipeline/write-data';
import { encodeVectorB64 } from '../core/scorecard';
import { basisVector, fixtureCorpus } from '../core/test-fixtures';

/** The 6-chunk fixture corpus (chunk i has vector e_i); with eval, one question whose gold passage is chunk 0. */
export async function writeFixtureData(o: { withEval: boolean }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fl-data-'));
  const corpus = fixtureCorpus();
  await writeDataFiles(corpus, new Map(corpus.chunks.map(c => [c.key, basisVector(c.id)])), { publicDir: dir });
  if (o.withEval) {
    await writeEvalFiles(dir, {
      schemaVersion: 1,
      questions: [{
        id: 'q01', question: 'export controls China', goldKeys: [corpus.chunks[0]!.key], ticker: 'NVDA', item: '1A', style: 'risk',
        vector: encodeVectorB64(basisVector(0)),
      }],
    }, { schemaVersion: 1, samples: [{ question: 'How does NVIDIA describe export controls?', vector: encodeVectorB64(basisVector(0)) }] });
  }
  return dir;
}

/** Serves `<baseUrl>/<path>` from dir; anything else is a 404. */
export function dirFetch(dir: string, baseUrl: string) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    let bytes: Uint8Array;
    try {
      if (!url.startsWith(`${baseUrl}/`)) throw new Error('outside baseUrl');
      bytes = new Uint8Array(await readFile(join(dir, url.slice(baseUrl.length + 1))));
    } catch {
      return new Response('not found', { status: 404 });
    }
    const third = Math.max(1, Math.ceil(bytes.length / 3));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += third) controller.enqueue(bytes.slice(i, i + third));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return { fn, calls };
}
