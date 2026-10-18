/**
 * npm run search -- "<question>" [--mode hybrid|vector|keyword] [--metric cosine|l2|dot]
 *                                [--dims 128|256|512|768] [--no-renormalize] [--no-embed]
 */
import { embedBatch, queryText } from '../../src/core/gemini';
import { DEFAULT_SETTINGS, type Dims, type Metric, type SearchMode, type SearchSettings } from '../../src/core/types';
import { requireEnv } from '../env';
import { loadEngineFromDisk } from '../node-data';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const toggle = (name: string) => {
  const i = args.indexOf(name);
  if (i !== -1) args.splice(i, 1);
  return i !== -1;
};

const settings: SearchSettings = {
  ...DEFAULT_SETTINGS,
  rerank: false,
  mode: (flag('--mode') as SearchMode | undefined) ?? DEFAULT_SETTINGS.mode,
  metric: (flag('--metric') as Metric | undefined) ?? DEFAULT_SETTINGS.metric,
  dims: Number(flag('--dims') ?? DEFAULT_SETTINGS.dims) as Dims,
  renormalize: !toggle('--no-renormalize'),
};
const noEmbed = toggle('--no-embed');
const question = args.join(' ').trim();
if (!question) {
  console.error('Usage: npm run search -- "<question>" [--mode …] [--metric …] [--dims …] [--no-renormalize] [--no-embed]');
  process.exit(1);
}

const { engine } = await loadEngineFromDisk('public/data');
const vector = noEmbed ? null : (await embedBatch(requireEnv('GEMINI_API_KEY'), [queryText(question)]))[0]!;
const r = await engine.search({ text: question, vector }, settings);
const views = new Map((await engine.getChunks(r.results.slice(0, 10).map(x => x.chunkId))).map(v => [v.id, v]));

console.log(`mode ${r.usedMode} · ${settings.metric} · ${settings.dims}d · notes: ${r.notes.join(', ') || '—'} · ` +
  `vector ${r.timings.vectorMs.toFixed(1)}ms keyword ${r.timings.keywordMs.toFixed(1)}ms`);
for (const res of r.results.slice(0, 10)) {
  const v = views.get(res.chunkId)!;
  const vec = res.vector ? `vec #${res.vector.rank} d=${res.vector.distance.toFixed(4)}` : 'vec —';
  const kw = res.keyword ? `bm25 #${res.keyword.rank} s=${res.keyword.score.toFixed(2)}` : 'bm25 —';
  console.log(`${String(res.finalRank).padStart(2)}  #${res.chunkId} ${v.ticker} FY${v.fiscalYear} Item ${v.item} | ${vec} | ${kw} | ` +
    `rrf ${res.fused.score.toFixed(4)} | ${v.text.replace(/\s+/g, ' ').slice(0, 100)}`);
}
