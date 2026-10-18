import { expect, test } from 'vitest';
import { randomUnitVectors } from './test-fixtures';
import type { Metric } from './types';
import { distance, prepareQuery, scan } from './vector';

const f = (...x: number[]) => Float32Array.from(x);
const concat = (vs: Float32Array[]) => {
  const out = new Float32Array(vs.length * 768);
  vs.forEach((v, i) => out.set(v, i * 768));
  return out;
};

test('distances follow pgvector semantics', () => {
  expect(distance('dot', f(1, 2, 3), f(4, 5, 6))).toBeCloseTo(-32, 12);
  expect(distance('l2', f(1, 2, 3), f(4, 5, 6))).toBeCloseTo(5.196152422706632, 12);
  expect(distance('cosine', f(1, 2, 3), f(4, 5, 6))).toBeCloseTo(0.025368153802923787, 12);
});

test('cosine distance of a zero vector is 1', () => {
  expect(distance('cosine', f(0, 0), f(1, 0))).toBe(1);
});

test('prepareQuery truncates and optionally renormalizes', () => {
  expect(Array.from(prepareQuery(f(3, 4, 12), 2, true))).toEqual([0.6000000238418579, 0.800000011920929]);
  expect(Array.from(prepareQuery(f(3, 4, 12), 2, false))).toEqual([3, 4]);
});

test('scan matches brute force and respects allow + k', () => {
  const docs = randomUnitVectors(300, 768, 3).map((v, i) => v.map(x => x * (1 + (i % 5))));
  const q = randomUnitVectors(1, 768, 4)[0]!;
  const m = { data: concat(docs), count: 300, width: 768 as const };
  const allow = new Uint8Array(300).map((_, i) => (i % 3 === 0 ? 1 : 0));
  for (const metric of ['l2', 'cosine', 'dot'] as const) {
    const got = scan(m, q, { metric, dims: 768, renormalize: false, k: 10, allow });
    const want = docs
      .map((d, id) => ({ id, score: distance(metric, d, q) }))
      .filter(h => h.id % 3 === 0)
      .sort((a, b) => a.score - b.score || a.id - b.id)
      .slice(0, 10);
    expect(got.map(h => h.id)).toEqual(want.map(h => h.id));
    got.forEach((h, i) => expect(h.score).toBeCloseTo(want[i]!.score, 5));
  }
});

test('metrics agree on normalized vectors, diverge after truncation without renormalize', () => {
  const docs = randomUnitVectors(200, 768, 7);
  const q = randomUnitVectors(1, 768, 8)[0]!;
  const m = { data: concat(docs), count: 200, width: 768 as const };
  const order = (metric: Metric, dims: number, renormalize: boolean) =>
    scan(m, q, { metric, dims, renormalize, k: 20, allow: null }).map(h => h.id).join();
  expect(order('l2', 768, true)).toBe(order('cosine', 768, true));
  expect(order('dot', 768, true)).toBe(order('cosine', 768, true));
  expect(order('dot', 128, false)).not.toBe(order('cosine', 128, false));
  expect(order('dot', 128, true)).toBe(order('cosine', 128, true));
  expect(order('l2', 128, true)).toBe(order('cosine', 128, true));
});
