import { readFile } from 'node:fs/promises';
import { beforeAll, expect, test } from 'vitest';
import { htmlToBlocks, type Block } from './html-blocks';
import { splitItems } from './parse10k';

let html: string;
beforeAll(async () => {
  html = await readFile(new URL('./fixtures/10k-mini.html', import.meta.url), 'utf8');
});

const firstText = (b: Block | undefined) => (b?.kind === 'para' ? b.text : '');

test('splits the body into Items, skipping the table of contents, cover and exhibits', () => {
  const { sections, missingRequired } = splitItems(htmlToBlocks(html));
  expect(sections.map(s => s.item)).toEqual(['1', '1A', '7', '8']);
  expect(sections.map(s => s.title)).toEqual([
    'Business', 'Risk Factors', "Management's Discussion and Analysis of Financial Condition and Results of Operations",
    'Financial Statements and Supplementary Data',
  ]);
  expect(firstText(sections[1]!.blocks[0])).toMatch(/^The following risk factors should be considered/);
  expect(missingRequired).toEqual([]);
});

test('keeps financial tables with merged cells and drops hidden text and exhibits', () => {
  const { sections } = splitItems(htmlToBlocks(html));
  const table = sections[3]!.blocks.find(b => b.kind === 'table');
  expect(table).toEqual({ kind: 'table', rows: [['Year Ended'], ['Net sales', '$60,922', '$26,974'], ['Loss', '(1,234)']] });
  const all = JSON.stringify(sections);
  expect(all).not.toContain('SECRET');
  expect(all).not.toContain('Exhibit 31.1');
  expect(all).not.toContain('SIGNATURES');
  expect(all).not.toContain('UNITED STATES SECURITIES');
});

test('reports a required Item whose body is missing', () => {
  const withoutItem7 = html.replace(/<!-- item7 -->[\s\S]*<!-- \/item7 -->/, '');
  const { sections, missingRequired } = splitItems(htmlToBlocks(withoutItem7));
  expect(sections.map(s => s.item)).toEqual(['1', '1A', '8']);
  expect(missingRequired).toEqual(['7']);
});

test('section chars count the text it holds', () => {
  const { sections } = splitItems(htmlToBlocks(html));
  expect(sections[0]!.chars).toBeGreaterThanOrEqual(300);
});
