import { expect, test } from 'vitest';
import { fuseRrf } from './fusion';

const h = (...ids: number[]) => ids.map((id, i) => ({ id, score: i }));

test('reciprocal rank fusion with weight alpha', () => {
  const r = fuseRrf(h(1, 2, 3), h(3, 1), { k: 60, alpha: 0.5 });
  expect(r.map(x => x.id)).toEqual([1, 3, 2]);
  expect(r[0]!.score).toBeCloseTo(0.5 / 61 + 0.5 / 62, 15);
  expect(r[1]).toMatchObject({ vectorRank: 3, keywordRank: 1 });
  expect(r[2]).toEqual({ id: 2, score: 0.5 / 62, vectorRank: 2 });
});

test('alpha 1 keeps the vector order and alpha 0 keeps the keyword order', () => {
  expect(fuseRrf(h(1, 2, 3), h(3, 1), { k: 60, alpha: 1 }).map(x => x.id)).toEqual([1, 2, 3]);
  expect(fuseRrf([], h(7, 4, 9), { k: 60, alpha: 0 }).map(x => x.id)).toEqual([7, 4, 9]);
});

test('ties break by best single-list rank, then id', () => {
  expect(fuseRrf(h(2, 1), h(1, 2), { k: 60, alpha: 0.5 }).map(x => x.id)).toEqual([1, 2]);
  expect(fuseRrf(h(5, 9), h(9, 5), { k: 10, alpha: 0.5 }).map(x => x.id)).toEqual([5, 9]);
});
