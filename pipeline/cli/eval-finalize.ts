/**
 * npm run eval:finalize — validates the owner-reviewed questions against the current corpus, embeds them and the
 * sample questions once, and publishes public/data/v/eval.*.json + samples.*.json via the manifest.
 */
import { queryText } from '../../src/core/embeddings';
import { encodeVectorB64, type EvalFile, type SamplesFile } from '../../src/core/scorecard';
import { embedWithCache } from '../embed-runner';
import { requireEnv } from '../env';
import { readJsonl, validateEval, writeEvalFiles } from '../eval';
import { readDataFiles } from '../node-data';

const { corpus } = await readDataFiles('public/data');
// Until the owner has reviewed questions.jsonl, publish the sample questions alone.
const reviewed = await readJsonl('data/eval/questions.jsonl').catch((e: NodeJS.ErrnoException) => (e.code === 'ENOENT' ? null : Promise.reject(e)));
const { items, errors } = reviewed ? validateEval(reviewed, new Set(corpus.chunks.map(c => c.key))) : { items: [], errors: [] as string[] };
const samples = (await readJsonl('data/eval/samples.jsonl')) as Array<{ question?: unknown }>;
samples.forEach((s, i) => {
  if (typeof s.question !== 'string' || !s.question.trim()) errors.push(`samples.jsonl line ${i + 1}: empty question`);
});
if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

const sampleQuestions = samples.map(s => (s.question as string).trim());
const vectors = await embedWithCache([
  ...items.map(q => ({ key: `eval:${q.id}`, text: queryText(q.question) })),
  ...sampleQuestions.map((question, i) => ({ key: `sample:${i}`, text: queryText(question) })),
], { apiKey: requireEnv('OPENROUTER_API_KEY'), cacheDir: 'data/.cache/embeddings' });

const evalFile: EvalFile | null = reviewed
  ? { schemaVersion: 1, questions: items.map(q => ({ ...q, vector: encodeVectorB64(vectors.get(`eval:${q.id}`)!) })) }
  : null;
const samplesFile: SamplesFile = {
  schemaVersion: 1,
  samples: sampleQuestions.map((question, i) => ({ question, vector: encodeVectorB64(vectors.get(`sample:${i}`)!) })),
};
await writeEvalFiles('public/data', evalFile, samplesFile);
console.log(`eval: ${evalFile ? `${items.length} questions` : 'not reviewed yet (samples only)'}, samples: ${sampleQuestions.length}`);
