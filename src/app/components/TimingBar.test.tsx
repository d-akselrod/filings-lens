// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { TimingBar } from './TimingBar';

test('the legend reads embed, search, rerank and answer times', () => {
  render(<TimingBar embedMs={180} search={{ vectorMs: 5, keywordMs: 3, fuseMs: 1, rerankMs: 410 }} answerMs={3900} />);
  expect(screen.getByTestId('timing-legend').textContent).toBe('embed 180ms · search 9ms · rerank 410ms · answer 3.9s');
});

test('steps that took no time are left out', () => {
  render(<TimingBar search={{ vectorMs: 0, keywordMs: 2, fuseMs: 0, rerankMs: 0 }} />);
  expect(screen.getByTestId('timing-legend').textContent).toBe('search 2ms');
});
