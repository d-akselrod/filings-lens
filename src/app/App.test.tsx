// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { COPY } from '@/copy';
import type { InitResult } from '../worker/protocol';

const init: InitResult = {
  manifest: {
    schemaVersion: 1, builtAt: '2026-10-17T00:00:00Z', embeddingModel: 'gemini-embedding-2', dims: 768, vectorEncoding: 'f16le', chunkCount: 3812,
    corpus: { file: 'v/corpus.1a2b3c4d.json', bytes: 1, gzipBytes: 1 }, vectors: { file: 'v/vectors.1a2b3c4d.f16', bytes: 1 },
  },
  chunkCount: 3812,
  facets: { tickers: ['NVDA'], fiscalYears: [2025], items: [{ item: '1A', title: 'Risk Factors' }] },
  hasEval: false,
};

vi.mock('@/engine', () => ({
  getEngine: () => ({
    init: async (onProgress: (p: unknown) => void) => {
      onProgress({ phase: 'database' });
      return init;
    },
    samples: async () => [],
    loadReranker: async () => {},
  }),
}));
vi.mock('@/api/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchStatus: async () => ({ region: 'restricted', builtInKey: 'restricted' }),
}));

test('after loading, a restricted visitor sees the region banner and the passage count', async () => {
  const { App } = await import('./App');
  render(<TooltipProvider><App /></TooltipProvider>);
  expect(await screen.findByText(COPY.restricted)).toBeInTheDocument();
  expect(screen.getByText('Postgres · 3,812 passages')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Question' })).toBeInTheDocument();
  expect(screen.getByRole('contentinfo')).toHaveTextContent(COPY.footer);
});
