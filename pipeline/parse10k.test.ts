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

test('an Item 8 that only cross-references takes the audited statements filed under Item 15', async () => {
  const xref = await readFile(new URL('./fixtures/10k-xref.html', import.meta.url), 'utf8');
  const { sections, missingRequired } = splitItems(htmlToBlocks(xref));
  expect(missingRequired).toEqual([]);
  expect(sections.map(s => s.item)).toEqual(['1', '1A', '7', '8']);
  const item8 = sections[3]!;
  expect(item8.title).toBe('Financial Statements and Supplementary Data');
  expect(firstText(item8.blocks[0])).toBe('Report of Independent Registered Public Accounting Firm');
  expect(item8.blocks).toContainEqual({ kind: 'table', rows: [['Year Ended'], ['Revenue', '$130,497'], ['Net income', '$72,880']] });
  const text = JSON.stringify(item8);
  expect(text).not.toContain('Exhibit Index');
  expect(text).not.toContain('Certification of Chief Executive Officer');
  expect(text).not.toContain('Not Applicable');
});

test('running page headers repeating an Item do not split or shorten that Item', () => {
  const mdna1 = 'The following Management’s Discussion and Analysis is intended to help the reader understand results. '.repeat(4);
  const mdna2 = 'Revenue increased driven by growth in Intelligent Cloud and Productivity and Business Processes segments. '.repeat(4);
  const html = `
    <p>Item 6. [Reserved] 34</p><p>Item 7. Management’s Discussion and Analysis 35</p><p>Item 7A. Quantitative and Qualitative Disclosures 60</p>
    <div>Item 6. [Reserved]</div>
    <div>PART II</div><div>Item 7</div>
    <div>ITEM 7. MANAGEMENT’S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS</div>
    <div>${mdna1}</div>
    <div>PART II</div><div>Item 7</div>
    <div>${mdna2}</div>
    <div>Item 7A. Quantitative and Qualitative Disclosures About Market Risk</div>
    <div>${'We are exposed to economic risk from foreign exchange rates, interest rates, credit risk, and equity prices. '.repeat(3)}</div>`;
  const { sections } = splitItems(htmlToBlocks(html));
  expect(sections.map(s => s.item)).toEqual(['7', '7A']);
  const item7 = sections[0]!.blocks.map(b => (b.kind === 'para' ? b.text : ''));
  expect(item7).toContain(mdna1.trim());
  expect(item7).toContain(mdna2.trim());
  expect(item7).not.toContain('Item 7');
  expect(item7).not.toContain('PART II');
});

test('section chars count the text it holds', () => {
  const { sections } = splitItems(htmlToBlocks(html));
  expect(sections[0]!.chars).toBeGreaterThanOrEqual(300);
});
