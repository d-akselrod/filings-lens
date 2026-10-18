// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useKeys } from '@/state/keys';
import { useUi } from '@/state/ui';
import { Header } from './Header';

beforeEach(() => {
  localStorage.clear();
  useUi.setState({ view: 'ask', byokOpen: false });
  useKeys.setState({ byokKey: null });
});

const renderHeader = (ready = true, chunkCount: number | null = 3812) =>
  render(<TooltipProvider><Header ready={ready} chunkCount={chunkCount} facets={null} samples={[]} /></TooltipProvider>);

test('the status pill shows the passage count once ready', () => {
  const view = renderHeader(false, null);
  expect(screen.getByText('Loading…')).toBeInTheDocument();
  view.unmount();
  renderHeader(true, 3812);
  expect(screen.getByText('Postgres · 3,812 passages')).toBeInTheDocument();
  expect(screen.getByText('Filings Lens')).toBeInTheDocument();
});

test('the view switch selects the scorecard', async () => {
  const user = userEvent.setup();
  renderHeader();
  await user.click(screen.getByRole('radio', { name: 'Scorecard' }));
  expect(useUi.getState().view).toBe('scorecard');
  await user.click(screen.getByRole('radio', { name: 'Ask' }));
  expect(useUi.getState().view).toBe('ask');
});

test('the header names the one answer model, Gemma 4 26B, without a model menu', () => {
  renderHeader();
  expect(screen.getByText('Gemma 4 · 26B')).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Answer model' })).toBeNull();
});

test('the theme button cycles system, light, dark', async () => {
  const user = userEvent.setup();
  renderHeader();
  await user.click(screen.getByRole('button', { name: 'Theme: system' }));
  await user.click(screen.getByRole('button', { name: 'Theme: light' }));
  expect(screen.getByRole('button', { name: 'Theme: dark' })).toBeInTheDocument();
  expect(document.documentElement.dataset.theme).toBe('dark');
});

test('the key button opens the bring-your-own-key dialog and shows a dot once a key is set', async () => {
  const user = userEvent.setup();
  const view = renderHeader();
  expect(screen.queryByTestId('byok-dot')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Use my own key' }));
  expect(useUi.getState().byokOpen).toBe(true);
  expect(await screen.findByRole('heading', { name: 'Use your own Gemini key' })).toBeInTheDocument();
  view.unmount();
  useKeys.setState({ byokKey: 'AIza-0123456789-abcdef' });
  renderHeader();
  expect(screen.getByTestId('byok-dot')).toBeInTheDocument();
});
