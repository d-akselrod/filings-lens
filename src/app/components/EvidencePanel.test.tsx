// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useSession, type Turn } from '@/state/session';
import { useUi } from '@/state/ui';
import { DEFAULT_SETTINGS, type ChunkView } from '../../core/types';
import { EvidencePanel } from './EvidencePanel';

const chunk = (id: number): ChunkView => ({
  id, key: `k${id}`, filingId: 0, item: '1A', itemTitle: 'Risk Factors', ordinal: 0, text: `Passage ${id}.`, tokenCount: 3,
  ticker: 'NVDA', companyName: 'NVIDIA', fiscalYear: 2025, form: '10-K', url: 'https://www.sec.gov/x', accession: 'a',
});

const turn: Turn = {
  id: 't1', question: 'Q', retrievalText: 'Q', vector: null, vectorSource: 'none', settings: DEFAULT_SETTINGS, stale: false,
  search: { results: [0, 1].map((chunkId, i) => ({ chunkId, finalRank: i + 1, fused: { rank: i + 1, score: 0.016 } })),
    usedMode: 'keyword', notes: [], timings: { vectorMs: 0, keywordMs: 1, fuseMs: 0, rerankMs: 0 } },
  results: [chunk(0), chunk(1)], passages: [chunk(0), chunk(1)],
  answer: {
    text: 'Revenue was $70 billion [1]. Margins rose [9]. Demand grew.', status: 'done', model: 'fast', passageIds: [0, 1],
    checks: [
      { text: 'Revenue was $70 billion [1].', citations: [1], invalidCitations: [], missingCitation: false, unsupportedNumbers: ['$70 billion'] },
      { text: 'Margins rose [9].', citations: [9], invalidCitations: [9], missingCitation: true, unsupportedNumbers: [] },
      { text: 'Demand grew.', citations: [], invalidCitations: [], missingCitation: true, unsupportedNumbers: [] },
    ],
  },
};

beforeEach(() => {
  useSession.setState({ turns: [turn] });
  useUi.setState({ evidenceTab: 'trace', highlighted: null });
});

test('the Trace tab lists the citation check for every sentence (spec 6.4, review I5)', () => {
  render(<TooltipProvider><EvidencePanel /></TooltipProvider>);
  const list = screen.getByRole('list', { name: 'Citation check' });
  const items = within(list).getAllByRole('listitem').map(li => li.textContent);
  expect(items).toHaveLength(3);
  expect(items[0]).toContain('Revenue was $70 billion [1].');
  expect(items[0]).toContain('Not found in cited passage: $70 billion');
  expect(items[1]).toContain('No passage [9]');
  expect(items[2]).toContain('No citation');
});
