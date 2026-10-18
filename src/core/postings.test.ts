import { expect, test } from 'vitest';
import { buildPostings } from './postings';

test('builds term postings, document lengths and average length', () => {
  const p = buildPostings(['risk risk export', 'export china']);
  const t = (w: string) => p.terms.find(x => x.term === w)!;
  expect(t('risk')).toMatchObject({ df: 1, chunkIds: [0], tfs: [2] });
  expect(t('export')).toMatchObject({ df: 2, chunkIds: [0, 1], tfs: [1, 1] });
  expect(t('china')).toMatchObject({ df: 1, chunkIds: [1], tfs: [1] });
  expect(Array.from(p.lengths)).toEqual([3, 2]);
  expect(p.n).toBe(2);
  expect(p.avgdl).toBe(2.5);
});

test('assigns dense term ids', () => {
  const p = buildPostings(['alpha beta', 'beta gamma']);
  expect(p.terms.map(t => t.id).sort((a, b) => a - b)).toEqual([0, 1, 2]);
});
