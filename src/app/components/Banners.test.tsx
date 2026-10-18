// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { COPY } from '@/copy';
import { useKeys } from '@/state/keys';
import { useSession, type Turn } from '@/state/session';
import { useUi } from '@/state/ui';
import { DEFAULT_SETTINGS, type SearchNote } from '../../core/types';
import { Banners, EvidenceNotice } from './Banners';
import { Footer } from './Footer';

beforeEach(() => {
  useKeys.setState({ builtin: 'unknown', byokKey: null });
  useUi.setState({ byokOpen: false });
  useSession.setState({ turns: [] });
});

test('one banner at a time for the built-in key, and none once the visitor has a key', async () => {
  const user = userEvent.setup();
  const view = render(<Banners />);
  expect(view.container).toBeEmptyDOMElement();
  for (const [builtin, text] of [['restricted', COPY.restricted], ['exhausted', COPY.exhausted], ['missing', COPY.missing]] as const) {
    useKeys.setState({ builtin });
    view.rerender(<Banners />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(text);
  }
  await user.click(screen.getByRole('button', { name: 'Use my own key' }));
  expect(useUi.getState().byokOpen).toBe(true);
  useKeys.setState({ builtin: 'restricted', byokKey: 'AIza-0123456789-abcdef' });
  view.rerender(<Banners />);
  expect(screen.queryByRole('status')).toBeNull();
});

function turnWith(notes: SearchNote[], results = 3): Turn {
  return {
    id: 't1', question: 'Q', retrievalText: 'Q', vector: null, vectorSource: 'none', settings: DEFAULT_SETTINGS, stale: false,
    search: { results: Array.from({ length: results }, (_, i) => ({ chunkId: i, finalRank: i + 1, fused: { rank: i + 1, score: 0.01 } })),
      usedMode: 'keyword', notes, timings: { vectorMs: 0, keywordMs: 1, fuseMs: 0, rerankMs: 0 } },
    results: [], passages: [], answer: { text: '', status: 'skipped', checks: [], model: 'fast', passageIds: [] },
  };
}

test('the evidence notice explains keyword-only searches, empty results and a reranker still loading', () => {
  const view = render(<EvidenceNotice />);
  expect(view.container).toBeEmptyDOMElement();
  useSession.setState({ turns: [turnWith(['no-query-vector', 'reranker-unavailable'])] });
  view.rerender(<EvidenceNotice />);
  expect(view.container).toHaveTextContent(COPY.keywordOnly);
  expect(view.container).toHaveTextContent(COPY.rerankerUnavailable);
  useSession.setState({ turns: [turnWith(['no-matches'], 0)] });
  view.rerender(<EvidenceNotice />);
  expect(view.container).toHaveTextContent(COPY.noMatches);
  expect(view.container).not.toHaveTextContent(COPY.keywordOnly);
});

test('the footer carries the exact notice', () => {
  const { container } = render(<Footer />);
  expect(container.textContent).toBe(COPY.footer);
});
