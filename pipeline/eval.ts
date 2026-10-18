import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { seededRandom } from '../src/core/random';
import type { EvalFile, EvalStyle, SamplesFile } from '../src/core/scorecard';
import type { Manifest } from '../src/core/types';

export type EvalQuestionLine = Omit<EvalFile['questions'][number], 'vector'>;

const STYLES: ReadonlySet<string> = new Set<EvalStyle>(['number', 'risk', 'strategy', 'comparison', 'other']);

/** Checks owner-reviewed questions against the current corpus; invalid lines are reported, never silently dropped. */
export function validateEval(lines: unknown[], knownKeys: ReadonlySet<string>): { items: EvalQuestionLine[]; errors: string[] } {
  const items: EvalQuestionLine[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  lines.forEach((raw, i) => {
    const q = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof EvalQuestionLine, unknown>>;
    const id = typeof q.id === 'string' ? q.id.trim() : '';
    const problems: string[] = [];
    if (!id) problems.push('missing id');
    else if (seen.has(id)) problems.push(`duplicate id "${id}"`);
    if (id) seen.add(id);
    const question = typeof q.question === 'string' ? q.question.trim() : '';
    if (!question) problems.push('empty question');
    const goldKeys = Array.isArray(q.goldKeys) ? q.goldKeys : [];
    if (goldKeys.length === 0) problems.push('goldKeys must be a non-empty array');
    for (const key of goldKeys) if (typeof key !== 'string' || !knownKeys.has(key)) problems.push(`unknown gold key "${String(key)}"`);
    if (typeof q.ticker !== 'string' || !q.ticker) problems.push('missing ticker');
    if (typeof q.item !== 'string' || !q.item) problems.push('missing item');
    if (typeof q.style !== 'string' || !STYLES.has(q.style)) problems.push(`invalid style "${String(q.style)}"`);
    if (problems.length > 0) {
      errors.push(`line ${i + 1} (${id || '?'}): ${problems.join('; ')}`);
      return;
    }
    items.push({ id, question, goldKeys: goldKeys as string[], ticker: q.ticker as string, item: q.item as string, style: q.style as EvalStyle });
  });
  return { items, errors };
}

/** perCell chunks for every (ticker, item) pair, from chunks of at least 300 tokens, in a seeded order. */
export function pickStratified<T extends { ticker: string; item: string; tokenCount: number }>(
  chunks: T[], tickers: string[], items: string[], perCell: number, seed: number): T[] {
  const random = seededRandom(seed);
  return tickers.flatMap(ticker => items.flatMap(item => {
    const pool = chunks.filter(c => c.ticker === ticker && c.item === item && c.tokenCount >= 300);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    return pool.slice(0, perCell);
  }));
}

/** Parses Gemma's JSON reply, tolerating code fences and surrounding prose. */
export function parseDraftReply(reply: string): { question: string; answer: string; style: EvalStyle } | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>;
    const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';
    if (!question) return null;
    const style = typeof parsed.style === 'string' && STYLES.has(parsed.style) ? parsed.style as EvalStyle : 'other';
    return { question, answer: typeof parsed.answer === 'string' ? parsed.answer.trim() : '', style };
  } catch {
    return null;
  }
}

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
const STALE = /^(eval|samples)\.[0-9a-f]{8}\.json$/;

/** Writes hash-named eval/sample files next to the corpus and points the manifest at them. */
export async function writeEvalFiles(publicDir: string, evalFile: EvalFile, samplesFile: SamplesFile): Promise<Manifest> {
  const evalJson = JSON.stringify(evalFile);
  const samplesJson = JSON.stringify(samplesFile);
  const evalName = `eval.${sha8(evalJson)}.json`;
  const samplesName = `samples.${sha8(samplesJson)}.json`;
  const versioned = join(publicDir, 'v');
  await mkdir(versioned, { recursive: true });
  for (const name of await readdir(versioned)) {
    if (STALE.test(name) && name !== evalName && name !== samplesName) await rm(join(versioned, name));
  }
  await writeFile(join(versioned, evalName), evalJson);
  await writeFile(join(versioned, samplesName), samplesJson);
  const manifest = JSON.parse(await readFile(join(publicDir, 'manifest.json'), 'utf8')) as Manifest;
  manifest.eval = { file: `v/${evalName}`, count: evalFile.questions.length };
  manifest.samples = { file: `v/${samplesName}`, count: samplesFile.samples.length };
  await writeFile(join(publicDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
