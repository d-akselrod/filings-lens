import { expect, test } from 'vitest';
import { htmlToBlocks } from './html-blocks';

const paras = (html: string) => htmlToBlocks(html).filter(b => b.kind === 'para').map(b => (b as { text: string }).text);

test('emits nested text once, at block boundaries, whitespace-collapsed', () => {
  expect(paras('<div><div><p>Hello&#160;  there</p></div><span>world</span><br>again</div>'))
    .toEqual(['Hello there', 'world', 'again']);
});

test('drops scripts, styles, hidden elements, XBRL headers and page furniture', () => {
  const html = `<head><style>p{}</style></head><script>x()</script>
    <ix:header>hidden header</ix:header><div style="display: none">SECRET</div><div style="DISPLAY:NONE">SECRET2</div>
    <p>Table of Contents</p><p>12</p><p>Page 3</p><p>Real text</p>`;
  expect(paras(html)).toEqual(['Real text']);
});

test('tables become rows with currency, parenthesis and percent cells merged', () => {
  const html = `<table>
    <tr><td></td><td>2025</td><td></td><td>2024</td></tr>
    <tr><td>Net sales</td><td>$</td><td>60,922</td><td>$</td><td>26,974</td></tr>
    <tr><td>Loss</td><td>(1,234</td><td>)</td></tr>
    <tr><td>Gross margin</td><td>75.0</td><td>%</td><td>(2.1</td><td>)%</td></tr>
    <tr><td></td><td> </td></tr></table>`;
  expect(htmlToBlocks(html)).toEqual([{ kind: 'table', rows: [
    ['2025', '2024'], ['Net sales', '$60,922', '$26,974'], ['Loss', '(1,234)'], ['Gross margin', '75.0%', '(2.1)%'],
  ] }]);
});

test('single-row and single-cell tables become paragraphs', () => {
  expect(htmlToBlocks('<table><tr><td>Item 1A.</td><td>Risk Factors</td></tr></table>'))
    .toEqual([{ kind: 'para', text: 'Item 1A. Risk Factors' }]);
  expect(htmlToBlocks('<table><tr><td>Only cell</td></tr><tr><td></td></tr></table>'))
    .toEqual([{ kind: 'para', text: 'Only cell' }]);
});
