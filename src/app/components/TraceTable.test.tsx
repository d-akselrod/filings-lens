// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { ChunkView, RankedResult } from '../../core/types';
import { TraceTable } from './TraceTable';

const chunk = (id: number, ticker: string, fiscalYear: number, item: string): ChunkView => ({
  id, key: `k${id}`, filingId: 0, item, itemTitle: 'Risk Factors', ordinal: 0, text: 'text', tokenCount: 1,
  ticker, companyName: ticker, fiscalYear, form: '10-K', url: 'https://www.sec.gov/x', accession: 'a',
});

test('each row shows every stage and how far reranking moved it', () => {
  const results: RankedResult[] = [
    { chunkId: 7, finalRank: 1, keyword: { rank: 3, score: 9.1 }, vector: { rank: 1, distance: 0.123456 }, fused: { rank: 2, score: 0.032258 }, rerank: { rank: 1, score: 0.9412 } },
    { chunkId: 3, finalRank: 2, vector: { rank: 2, distance: 0.2 }, fused: { rank: 2, score: 0.0164 } },
    { chunkId: 5, finalRank: 3, keyword: { rank: 1, score: 12 }, fused: { rank: 1, score: 0.0328 }, rerank: { rank: 3, score: 0.12 } },
  ];
  const chunks = new Map([[7, chunk(7, 'NVDA', 2025, '1A')], [3, chunk(3, 'AAPL', 2024, '7')], [5, chunk(5, 'MSFT', 2026, '1')]]);
  render(<TraceTable results={results} chunks={chunks} />);
  expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['#', 'Passage', 'BM25', 'Vector', 'Fused', 'Rerank', 'Δ']);
  const rows = screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell').map(c => c.textContent));
  expect(rows).toEqual([
    ['1', 'NVDA FY25 · Item 1A', '3', '1 · 0.1235', '0.0323', '0.94', '▲1'],
    ['2', 'AAPL FY24 · Item 7', '—', '2 · 0.2000', '0.0164', '—', '—'],
    ['3', 'MSFT FY26 · Item 1', '1', '—', '0.0328', '0.12', '▼2'],
  ]);
});
