// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import type { Facets } from '../../core/types';
import { CommandMenu } from './CommandMenu';

const facets: Facets = {
  tickers: ['AAPL', 'NVDA'], fiscalYears: [2025],
  items: [{ item: '1A', title: 'Risk Factors' }, { item: '7', title: "Management's Discussion and Analysis" }],
};
const sample = { question: 'How does NVIDIA describe export controls?', vector: new Float32Array(768).fill(0.1) };

beforeEach(() => {
  useSettings.getState().reset();
  useUi.setState({ byokOpen: false });
});

const renderMenu = () => render(<TooltipProvider><CommandMenu facets={facets} samples={[sample]} /></TooltipProvider>);

test('Ctrl+K opens the command menu', async () => {
  const user = userEvent.setup();
  renderMenu();
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.keyboard('{Control>}k{/Control}');
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('Sample questions')).toBeInTheDocument();
  expect(screen.getByText('Actions')).toBeInTheDocument();
});

test('choosing a company toggles its filter, and a section toggles the item filter', async () => {
  const user = userEvent.setup();
  renderMenu();
  await user.click(screen.getByRole('button', { name: /Search companies, sections/ }));
  await user.click(await screen.findByRole('option', { name: /NVIDIA \(NVDA\)/ }));
  expect(useSettings.getState().settings.filters.tickers).toEqual(['NVDA']);
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.keyboard('{Control>}k{/Control}');
  await user.click(await screen.findByRole('option', { name: /Item 1A · Risk Factors/ }));
  expect(useSettings.getState().settings.filters.items).toEqual(['1A']);
});

test('a sample question is asked with its precomputed vector; actions open the key dialog', async () => {
  const user = userEvent.setup();
  const ask = vi.fn(async () => {});
  useSession.setState({ ask });
  renderMenu();
  await user.keyboard('{Control>}k{/Control}');
  await user.click(await screen.findByRole('option', { name: sample.question }));
  expect(ask).toHaveBeenCalledWith(sample.question, { sampleVector: sample.vector });
  await user.keyboard('{Control>}k{/Control}');
  await user.click(await screen.findByRole('option', { name: 'Use my own key' }));
  expect(useUi.getState().byokOpen).toBe(true);
});
