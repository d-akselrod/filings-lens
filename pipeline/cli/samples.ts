/**
 * npm run samples — embeds the sample questions in data/samples.jsonl once and publishes
 * public/data/v/samples.*.json via the manifest, so sample questions search without an embedding call.
 */
import { queryText } from '../../src/core/embeddings';
import type { SamplesFile } from '../../src/core/types';
import { encodeVectorB64 } from '../../src/core/vector-b64';
import { embedWithCache } from '../embed-runner';
import { requireEnv } from '../env';
import { readJsonl, writeSamplesFile } from '../samples';

const samples = (await readJsonl('data/samples.jsonl')) as Array<{ question?: unknown }>;
const errors = samples.flatMap((s, i) => (typeof s.question === 'string' && s.question.trim() ? [] : [`samples.jsonl line ${i + 1}: empty question`]));
if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

const questions = samples.map(s => (s.question as string).trim());
const vectors = await embedWithCache(questions.map((question, i) => ({ key: `sample:${i}`, text: queryText(question) })),
  { apiKey: requireEnv('OPENROUTER_API_KEY'), cacheDir: 'data/.cache/embeddings' });

const samplesFile: SamplesFile = {
  schemaVersion: 1,
  samples: questions.map((question, i) => ({ question, vector: encodeVectorB64(vectors.get(`sample:${i}`)!) })),
};
await writeSamplesFile('public/data', samplesFile);
console.log(`samples: ${questions.length}`);
