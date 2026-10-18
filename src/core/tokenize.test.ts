import { expect, test } from 'vitest';
import { tokenize } from './tokenize';
import { compareItems } from './types';

test('lowercases, splits, drops stopwords, stems words', () =>
  expect(tokenize("NVIDIA's export-controls in FY2025")).toEqual(['nvidia', 'export', 'control', 'fy2025']));

test('keeps numbers, strips thousands separators and currency', () =>
  expect(tokenize('Revenue was $60,922 million, up 12.5%')).toEqual(['revenu', '60922', 'million', '12.5']));

test('keeps 10-K item codes', () =>
  expect(tokenize('Item 1A. Risk Factors')).toEqual(['item', '1a', 'risk', 'factor']));

test('returns [] for stopwords and punctuation only', () => expect(tokenize('the of and ... ?!')).toEqual([]));

test('drops single letters but keeps single digits', () => expect(tokenize('a b 7 x')).toEqual(['7']));

test('compareItems orders 10-K items', () =>
  expect(['8', '1A', '7A', '1', '10', '7'].sort(compareItems)).toEqual(['1', '1A', '7', '7A', '8', '10']));
