// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ChunkView, RankedResult } from '../../core/types';
import { SourceCard } from './SourceCard';

const view: ChunkView = {
  id: 7, key: 'k7', filingId: 0, item: '1A', itemTitle: 'Risk Factors', ordinal: 0,
  text: 'New export licensing requirements apply to our data center products destined for China.', tokenCount: 20,
  ticker: 'NVDA', companyName: 'NVIDIA', fiscalYear: 2025, form: '10-K',
  url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581025000023/nvda-20250126.htm', accession: '0001045810-25-000023',
};
const result: RankedResult = {
  chunkId: 7, finalRank: 1, keyword: { rank: 3, score: 9 }, vector: { rank: 1, distance: 0.123456 },
  fused: { rank: 2, score: 0.032258 }, rerank: { rank: 1, score: 0.9412 },
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const renderCard = (n: number | null, highlighted = false) =>
  render(<TooltipProvider><SourceCard result={result} chunk={view} n={n} terms={new Set(['export', 'china'])} highlighted={highlighted} /></TooltipProvider>);

test('shows the filing, highlighted snippet, score pills and an exact sec.gov link', () => {
  const { container } = renderCard(1);
  expect(screen.getByText('NVDA')).toBeInTheDocument();
  expect(screen.getByText('10-K · FY2025')).toBeInTheDocument();
  expect(screen.getByText('Item 1A · Risk Factors')).toBeInTheDocument();
  expect([...container.querySelectorAll('mark')].map(m => m.textContent)).toEqual(['export', 'China']);
  expect(screen.getByText('BM25 #3')).toBeInTheDocument();
  expect(screen.getByText('Vec #1')).toHaveAttribute('title', 'distance 0.1235');
  expect(screen.getByText('RRF .0323')).toBeInTheDocument();
  expect(screen.getByText('Rerank .94')).toBeInTheDocument();
  expect(screen.getByText('1')).toHaveAttribute('aria-label', 'Passage 1');
  const link = screen.getByRole('link', { name: 'View filing on sec.gov ↗' });
  expect(link).toHaveAttribute('href', view.url);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('a highlighted card scrolls into view; a result outside the passages has no chip', () => {
  renderCard(2, true);
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  expect(screen.getByRole('article')).toHaveAttribute('data-highlighted', 'true');
});

test('a result outside the passages has no citation chip', () => {
  renderCard(null);
  expect(screen.queryByLabelText(/^Passage /)).toBeNull();
});
