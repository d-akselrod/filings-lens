import { expect, test } from 'vitest';
import { loadReranker, progressAcrossFiles, transformersBackend, type RerankerBackend } from './reranker';

test('scores are the sigmoid of each logit, in input order', async () => {
  const backend: RerankerBackend = { tokenize: () => null, run: async () => [2, -1, 0] };
  const scores = await (await loadReranker(undefined, async () => backend))('q', ['a', 'b', 'c']);
  expect(scores).toHaveLength(3);
  expect(scores[0]).toBeCloseTo(0.880797, 6);
  expect(scores[1]).toBeCloseTo(0.268941, 6);
  expect(scores[2]).toBeCloseTo(0.5, 6);
});

test('passages go to the model in batches of 8, in order, with the query repeated per passage', async () => {
  const seen: Array<{ queries: string[]; passages: string[] }> = [];
  const backend: RerankerBackend = {
    tokenize: (queries, passages) => {
      seen.push({ queries, passages });
      return passages;
    },
    run: async inputs => new Float32Array((inputs as string[]).map(p => Number(p.slice(1)))),
  };
  const passages = Array.from({ length: 20 }, (_, i) => `p${i}`);
  const scores = await (await loadReranker(undefined, async () => backend))('q', passages);
  expect(seen.map(b => b.passages.length)).toEqual([8, 8, 4]);
  expect(seen.flatMap(b => b.passages)).toEqual(passages);
  expect(seen.every(b => b.queries.length === b.passages.length && b.queries.every(q => q === 'q'))).toBe(true);
  scores.forEach((s, i) => expect(s).toBeCloseTo(1 / (1 + Math.exp(-i)), 6));
});

test('download progress is summed across files', () => {
  const seen: Array<[number, number]> = [];
  const callback = progressAcrossFiles((loaded, total) => seen.push([loaded, total]));
  callback({ status: 'initiate', file: 'tokenizer.json' });
  callback({ status: 'progress', file: 'tokenizer.json', progress: 14, loaded: 100, total: 700 });
  callback({ status: 'progress', file: 'onnx/model_quantized.onnx', progress: 4, loaded: 1000, total: 23000 });
  callback({ status: 'progress', file: 'tokenizer.json', progress: 100, loaded: 700, total: 700 });
  callback({ status: 'done', file: 'tokenizer.json' });
  expect(seen).toEqual([[100, 700], [1100, 23700], [1700, 23700]]);
});

test.runIf(process.env.RUN_MODEL_TESTS === '1')('the real cross-encoder ranks the relevant passage first', async () => {
  const rerank = await loadReranker(undefined, transformersBackend('cpu'));
  const [berlin, museum] = await rerank('How many people live in Berlin?', [
    'Berlin has a population of 3,520,031 registered inhabitants in an area of 891.82 square kilometers.',
    'New York City is famous for the Metropolitan Museum of Art.',
  ]);
  expect(berlin).toBeGreaterThan(museum!);
}, 180_000);
