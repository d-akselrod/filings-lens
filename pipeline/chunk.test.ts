import { expect, test } from 'vitest';
import { chunkSection, estimateTokens } from './chunk';
import type { Block } from './html-blocks';

const para = (text: string): Block => ({ kind: 'para', text });

test('a short section is one chunk', () => {
  const text = 'A'.repeat(299) + '.';
  expect(chunkSection([para(text)])).toEqual([{ ordinal: 0, text, tokenCount: 75 }]);
});

test('paragraphs pack up to the target, stay under the max, and overlap by whole paragraphs', () => {
  const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph ${String(i).padStart(2, '0')}. `.padEnd(400, 'x'));
  const chunks = chunkSection(paragraphs.map(para));
  expect(chunks.length).toBeGreaterThan(3);
  expect(chunks.map(c => c.ordinal)).toEqual(chunks.map((_, i) => i));
  for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(600);
  for (let i = 1; i < chunks.length; i++) {
    const previousLast = chunks[i - 1]!.text.split('\n\n').at(-1)!;
    expect(chunks[i]!.text.startsWith(previousLast)).toBe(true);
  }
  const covered = new Set(chunks.flatMap(c => c.text.split('\n\n')));
  expect(paragraphs.every(p => covered.has(p))).toBe(true);
});

test('table rows are never split and continuation chunks repeat the header row', () => {
  const rows = [['Metric', 'FY2025'], ...Array.from({ length: 200 }, (_, k) => [`Row ${k}`, `$${k}`])];
  const chunks = chunkSection([{ kind: 'table', rows }]);
  expect(chunks.length).toBeGreaterThan(1);
  chunks.forEach((c, i) => {
    for (const line of c.text.split('\n')) expect(line).toMatch(/^(Metric \| FY2025|Row \d+ \| \$\d+)$/);
    if (i > 0) expect(c.text.startsWith('Metric | FY2025\n')).toBe(true);
    expect(c.tokenCount).toBeLessThanOrEqual(600);
  });
  const seen = new Set(chunks.flatMap(c => c.text.split('\n')));
  expect(rows.slice(1).every(r => seen.has(r.join(' | ')))).toBe(true);
});

test('an over-long paragraph splits at sentence boundaries', () => {
  const sentences = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} talks about export controls and data center demand in China today.`);
  const chunks = chunkSection([para(sentences.join(' '))]);
  expect(chunks.length).toBeGreaterThan(1);
  for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(600);
  const lines = new Set(chunks.flatMap(c => c.text.split('\n')));
  expect(sentences.every(s => lines.has(s))).toBe(true);
});

test('estimateTokens is chars / 4 rounded up', () => {
  expect(estimateTokens('abcde')).toBe(2);
  expect(estimateTokens('')).toBe(0);
});
