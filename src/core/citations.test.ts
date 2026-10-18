import { expect, test } from 'vitest';
import { checkSentence, extractCitations, extractNumbers, splitSentences } from './citations';

const P = new Map([
  [1, 'Total net sales | $60,922 | $26,974\nOperating loss | (1,234)'],
  [2, 'gross margin of 12.5 %'],
  [3, 'Mac | $29,984 | (27)% |\niPhone | $201,183 | (2)% |'],
]);

test.each([
  ['Total net sales were $60.9 billion [1].', []],
  ['Operating loss was $1.2 billion [1].', []],
  ['Gross margin was 12.5% [2].', []],
  ['Revenue was $70 billion [1].', ['$70 billion']],
  ['In fiscal 2025, revenue grew [1].', []],
  ['Revenue grew in 2024 [1].', []],
  ['Item 1A lists the main risks [1].', []],
  ['The 10-K reports net sales of $60,922 million [1].', []],
  ['Margin reached 12,500 percent [2].', ['12,500 percent']],
  ['Mac net sales decreased 27% [3].', []],
  ['iPhone net sales decreased 2% [3].', []],
  ['Mac net sales fell 27 percent [3].', []],
  ['Mac net sales changed -27% [3].', []],
  ['Mac net sales decreased 31% [3].', ['31%']],
])('%s', (s, unsupported) => expect(checkSentence(s, P).unsupportedNumbers).toEqual(unsupported));

test('citations', () => {
  expect(checkSentence('NVIDIA faces export limits.', P).missingCitation).toBe(true);
  expect(checkSentence("The provided filings don't answer this.", P).missingCitation).toBe(false);
  expect(checkSentence('Sales rose [9].', P)).toMatchObject({ invalidCitations: [9], missingCitation: true });
  expect(checkSentence('Sales rose [2][1].', P)).toMatchObject({ citations: [1, 2], invalidCitations: [], missingCitation: false });
  expect(extractCitations('a [1][3] b [2, 1]')).toEqual([1, 2, 3]);
});

test('streaming sentence split', () => {
  expect(splitSentences('Revenue was $10.2 billion [1]. It gre')).toEqual({ complete: ['Revenue was $10.2 billion [1].'], rest: 'It gre' });
  expect(splitSentences('U.S. export rules apply [1]. Next')).toEqual({ complete: ['U.S. export rules apply [1].'], rest: 'Next' });
  expect(splitSentences('Sales rose. [2] Costs fell [3].', true).complete).toEqual(['Sales rose. [2]', 'Costs fell [3].']);
  expect(splitSentences('Apple Inc. reported growth [1]. ')).toEqual({ complete: [], rest: 'Apple Inc. reported growth [1]. ' });
  expect(splitSentences('Apple Inc. reported growth [1].', true)).toEqual({ complete: ['Apple Inc. reported growth [1].'], rest: '' });
});

test('extractNumbers scales units and skips years, small counts and labels', () => {
  expect(extractNumbers('$60.9 billion and 12.5% and (1,234) in FY 2024 with 3 segments per Note 7')).toEqual([
    { raw: '$60.9 billion', value: 60.9e9, percent: false, halfUnit: 0.05e9 },
    { raw: '12.5%', value: 12.5, percent: true, halfUnit: 0.05 },
    { raw: '1,234', value: 1234, percent: false, halfUnit: 0.5 },
  ]);
});
