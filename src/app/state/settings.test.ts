import { beforeEach, expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '../../core/types';
import { useSettings } from './settings';

beforeEach(() => useSettings.getState().reset());

test('starts at the defaults', () => {
  expect(useSettings.getState().settings).toEqual(DEFAULT_SETTINGS);
});

test('set patches the tuning values and keeps the filters', () => {
  useSettings.getState().toggleFilter('tickers', 'NVDA');
  useSettings.getState().set({ k1: 2, mode: 'keyword' });
  expect(useSettings.getState().settings).toMatchObject({ k1: 2, mode: 'keyword', b: 0.75, filters: { tickers: ['NVDA'] } });
});

test('toggleFilter adds a value, and a second toggle removes it', () => {
  const { toggleFilter } = useSettings.getState();
  toggleFilter('tickers', 'AAPL');
  expect(useSettings.getState().settings.filters.tickers).toEqual(['AAPL']);
  toggleFilter('tickers', 'AAPL');
  expect(useSettings.getState().settings.filters.tickers).toEqual([]);
  toggleFilter('fiscalYears', 2025);
  toggleFilter('items', '1A');
  expect(useSettings.getState().settings.filters).toEqual({ tickers: [], fiscalYears: [2025], items: ['1A'] });
  expect(DEFAULT_SETTINGS.filters).toEqual({ tickers: [], fiscalYears: [], items: [] });
});

test('reset restores the defaults', () => {
  useSettings.getState().set({ metric: 'dot', candidates: 100 });
  useSettings.getState().toggleFilter('items', '1A');
  useSettings.getState().reset();
  expect(useSettings.getState().settings).toEqual(DEFAULT_SETTINGS);
});
