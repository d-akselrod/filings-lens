import { expect, test } from 'vitest';
import { highlightSegments, rankDelta, snippet } from './highlight';

test('words whose first token is a query term are hits', () => {
  const segments = highlightSegments('Export controls restrict', new Set(['export', 'control']));
  expect(segments.filter(s => s.hit).map(s => s.text)).toEqual(['Export', 'controls']);
  expect(segments.map(s => s.text).join('')).toBe('Export controls restrict');
});

test('stopwords and punctuation are never hits', () => {
  const segments = highlightSegments('The export, of chips.', new Set(['export', 'the']));
  expect(segments.filter(s => s.hit).map(s => s.text)).toEqual(['export']);
});

test('snippet windows around the first hit and marks the cut sides', () => {
  const text = `${'Lorem ipsum dolor sit amet. '.repeat(10)}New export licensing rules apply to China. ${'More words follow here. '.repeat(20)}`;
  const s = snippet(text, new Set(['export']), 120);
  expect(s.startsWith('…')).toBe(true);
  expect(s.endsWith('…')).toBe(true);
  expect(s).toContain('export licensing');
  expect(s.length).toBeLessThanOrEqual(122);
  expect(s.indexOf('export')).toBeGreaterThan(30);
});

test('snippet falls back to the opening text when nothing matches, and keeps short text whole', () => {
  const text = `Opening sentence of the passage. ${'Filler text. '.repeat(40)}`;
  expect(snippet(text, new Set(['zebra']), 60)).toMatch(/^Opening sentence of the passage\..*…$/);
  expect(snippet('Short passage about export.', new Set(['export']))).toBe('Short passage about export.');
});

test('rankDelta is how far the final rank moved up from the fused rank', () => {
  expect(rankDelta({ chunkId: 1, fused: { rank: 2, score: 0.03 }, finalRank: 1 })).toBe(1);
  expect(rankDelta({ chunkId: 1, fused: { rank: 1, score: 0.03 }, finalRank: 3 })).toBe(-2);
  expect(rankDelta({ chunkId: 1, fused: { rank: 4, score: 0.03 }, finalRank: 4 })).toBe(0);
});
