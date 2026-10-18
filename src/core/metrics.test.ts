import { expect, test } from 'vitest';
import { mrrAtK, ndcgAtK, recallAtK } from './metrics';

const ranked = [5, 3, 9, 1];
const gold = new Set([3, 1]);

test('recall@k', () => {
  expect(recallAtK(ranked, gold, 2)).toBe(0.5);
  expect(recallAtK(ranked, gold, 4)).toBe(1);
  expect(recallAtK(ranked, gold, 1)).toBe(0);
});

test('mrr@k', () => {
  expect(mrrAtK(ranked, gold, 4)).toBe(0.5);
  expect(mrrAtK(ranked, gold, 1)).toBe(0);
  expect(mrrAtK([1, 3], gold, 2)).toBe(1);
});

test('ndcg@k with binary relevance', () => {
  expect(ndcgAtK(ranked, gold, 4)).toBeCloseTo((1 / Math.log2(3) + 1 / Math.log2(5)) / (1 + 1 / Math.log2(3)), 12);
  expect(ndcgAtK([3, 1, 5], gold, 2)).toBe(1);
  expect(ndcgAtK([5, 9], gold, 2)).toBe(0);
});

test('empty gold set scores 0 instead of NaN', () => {
  const none = new Set<number>();
  expect([recallAtK(ranked, none, 5), mrrAtK(ranked, none, 5), ndcgAtK(ranked, none, 5)]).toEqual([0, 0, 0]);
});
