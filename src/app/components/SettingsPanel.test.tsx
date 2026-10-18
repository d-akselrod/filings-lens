// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useSettings } from '@/state/settings';
import { DEFAULT_SETTINGS, type Facets } from '../../core/types';
import { METRIC_HELP } from './MetricHelp';
import { SettingsPanel, type RerankerStatus } from './SettingsPanel';

const facets: Facets = {
  tickers: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA'],
  fiscalYears: [2025, 2024, 2023],
  items: [{ item: '1', title: 'Business' }, { item: '1A', title: 'Risk Factors' }, { item: '7', title: "Management's Discussion and Analysis" }],
};

function renderPanel(status: RerankerStatus = { state: 'idle' }) {
  const ui = (s: RerankerStatus) => <TooltipProvider><SettingsPanel facets={facets} rerankerStatus={s} /></TooltipProvider>;
  const view = render(ui(status));
  return { ...view, rerender: (s: RerankerStatus) => view.rerender(ui(s)) };
}

const settings = () => useSettings.getState().settings;

beforeEach(() => useSettings.getState().reset());

test('clicking Euclidean selects the l2 metric; Re-normalize is disabled only for cosine', async () => {
  const user = userEvent.setup();
  renderPanel();
  expect(screen.getByRole('switch', { name: 'Re-normalize' })).toBeDisabled();
  await user.click(screen.getByRole('radio', { name: 'Euclidean' }));
  expect(settings().metric).toBe('l2');
  expect(screen.getByRole('switch', { name: 'Re-normalize' })).toBeEnabled();
});

test('the disabled Re-normalize switch explains why', async () => {
  renderPanel();
  act(() => screen.getByLabelText('Why Re-normalize is off').focus());
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Cosine always normalizes');
});

test('the right arrow moves k1 up one step', async () => {
  const user = userEvent.setup();
  renderPanel();
  act(() => screen.getByRole('slider', { name: 'k1' }).focus());
  await user.keyboard('{ArrowRight}');
  expect(settings().k1).toBe(1.3);
});

test('the Dimensions slider snaps to 128, 256, 512 and 768', async () => {
  const user = userEvent.setup();
  renderPanel();
  act(() => screen.getByRole('slider', { name: 'Dimensions' }).focus());
  await user.keyboard('{ArrowLeft}');
  expect(settings().dims).toBe(512);
  await user.keyboard('{Home}');
  expect(settings().dims).toBe(128);
  expect(screen.getByText('128')).toBeInTheDocument();
});

test('Vector weight α is shown only in Hybrid mode', async () => {
  const user = userEvent.setup();
  renderPanel();
  expect(screen.getByRole('slider', { name: 'Vector weight α' })).toBeInTheDocument();
  await user.click(screen.getByRole('radio', { name: 'Keyword' }));
  expect(settings().mode).toBe('keyword');
  expect(screen.queryByRole('slider', { name: 'Vector weight α' })).toBeNull();
});

test('focusing the metric help shows the explanation', async () => {
  renderPanel();
  act(() => screen.getByRole('button', { name: 'About distance metrics' }).focus());
  expect(await screen.findByRole('tooltip')).toHaveTextContent(METRIC_HELP);
  expect(METRIC_HELP).toBe("The embedding model's vectors are normalized (length 1). On normalized vectors, cosine, Euclidean and dot product always put results in the same order — only the scores differ. Shorten the vectors with the Dimensions slider and turn off Re-normalize to see them diverge.");
});

test('company tiles filter by ticker and the header counts them', async () => {
  const user = userEvent.setup();
  renderPanel();
  expect(screen.getByTestId('companies-count')).toHaveTextContent('All');
  await user.click(screen.getByRole('button', { name: 'NVDA' }));
  expect(settings().filters.tickers).toEqual(['NVDA']);
  expect(screen.getByRole('button', { name: 'NVDA' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('companies-count')).toHaveTextContent('1 of 7');
  await user.click(screen.getByRole('button', { name: 'FY24' }));
  expect(settings().filters.fiscalYears).toEqual([2024]);
});

test('the Sections checklist filters by Item', async () => {
  const user = userEvent.setup();
  renderPanel();
  await user.click(screen.getByRole('button', { name: 'All sections' }));
  await user.click(await screen.findByRole('checkbox', { name: 'Item 1A · Risk Factors' }));
  expect(settings().filters.items).toEqual(['1A']);
});

test('the rerank switch and top-N slider, and the reranker status line', async () => {
  const user = userEvent.setup();
  const view = renderPanel({ state: 'loading', loaded: 12_000_000, total: 23_100_000 });
  expect(screen.getByText('Reranker: loading 12.0 / 23.1 MB')).toBeInTheDocument();
  view.rerender({ state: 'ready' });
  expect(screen.getByText('Reranker: ready')).toBeInTheDocument();
  expect(screen.getByText('Rerank top 20')).toBeInTheDocument();
  await user.click(screen.getByRole('switch', { name: 'Rerank' }));
  expect(settings().rerank).toBe(false);
  expect(screen.getByRole('slider', { name: 'Rerank top N' })).toHaveAttribute('aria-disabled', 'true');
});

test('Reset to defaults restores every setting', async () => {
  const user = userEvent.setup();
  renderPanel();
  await user.click(screen.getByRole('radio', { name: 'Dot' }));
  await user.click(screen.getByRole('button', { name: 'MSFT' }));
  await user.click(screen.getByRole('button', { name: 'Reset to defaults' }));
  expect(settings()).toEqual(DEFAULT_SETTINGS);
  expect(screen.getByRole('radio', { name: 'Cosine' })).toHaveAttribute('aria-checked', 'true');
});
