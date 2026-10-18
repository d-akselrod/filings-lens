// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { useSettings } from '@/state/settings';
import type { ScorecardResult } from '../../core/scorecard';
import type { SearchSettings } from '../../core/types';
import type { WorkerApi } from '../../worker/protocol';
import { ScorecardView } from './ScorecardView';

const result: ScorecardResult = {
  rows: [
    { name: 'current', recall5: 0.6, recall10: 0.7, mrr10: 0.5123, ndcg10: 0.55 },
    { name: 'vector', recall5: 0.55, recall10: 0.725, mrr10: 0.45, ndcg10: 0.5 },
    { name: 'keyword', recall5: 0.4, recall10: 0.5, mrr10: 0.3, ndcg10: 0.35 },
    { name: 'hybrid', recall5: 0.6, recall10: 0.7, mrr10: 0.5123, ndcg10: 0.55 },
    { name: 'hybrid+rerank', recall5: 0.65, recall10: 0.7, mrr10: 0.6, ndcg10: 0.6 },
  ],
  perQuestion: [
    { id: 'q01', question: 'How does NVIDIA describe export controls?', firstGoldRank: { current: 1, vector: 2, keyword: null, hybrid: 1, 'hybrid+rerank': 12 } },
  ],
};

beforeEach(() => useSettings.getState().reset());

function fakeEngine(onRun?: (s: SearchSettings, progress: (done: number, total: number) => void) => void) {
  return {
    scorecard: vi.fn(async (s: SearchSettings, progress: (done: number, total: number) => void) => {
      onRun?.(s, progress);
      return result;
    }),
  } satisfies Pick<WorkerApi, 'scorecard'>;
}

test('runs with the current settings and shows every baseline with the best value in each column in bold', async () => {
  const user = userEvent.setup();
  useSettings.getState().set({ k1: 2 });
  const engine = fakeEngine();
  render(<ScorecardView evalCount={40} rerankerReady engine={engine} />);
  expect(screen.getByRole('heading', { name: 'Scorecard' })).toBeInTheDocument();
  expect(screen.getByText('How well search finds the right passages for 40 reviewed test questions. Runs entirely in your browser with precomputed question embeddings; filters are ignored.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Run scorecard' }));
  expect(engine.scorecard).toHaveBeenCalledOnce();
  expect(engine.scorecard.mock.calls[0]![0]).toBe(useSettings.getState().settings);

  const table = screen.getByRole('table', { name: 'Scorecard results' });
  expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['', 'Recall@5', 'Recall@10', 'MRR@10', 'nDCG@10']);
  const rows = within(table).getAllByRole('row').slice(1).map(r => [
    within(r).getByRole('rowheader').textContent, ...within(r).getAllByRole('cell').map(c => c.textContent),
  ]);
  expect(rows).toEqual([
    ['Your settings', '0.600', '0.700', '0.512', '0.550'],
    ['Vector only', '0.550', '0.725', '0.450', '0.500'],
    ['Keyword only', '0.400', '0.500', '0.300', '0.350'],
    ['Hybrid', '0.600', '0.700', '0.512', '0.550'],
    ['Hybrid + rerank', '0.650', '0.700', '0.600', '0.600'],
  ]);
  expect([...table.querySelectorAll('strong')].map(b => b.textContent)).toEqual(['0.725', '0.650', '0.600', '0.600']);
});

test('progress reads done / total runs while the scorecard runs', async () => {
  const user = userEvent.setup();
  let report: (done: number, total: number) => void = () => {};
  let finish: () => void = () => {};
  const engine = {
    scorecard: vi.fn((_s: SearchSettings, progress: (done: number, total: number) => void) => {
      report = progress;
      return new Promise<ScorecardResult>(resolve => { finish = () => resolve(result); });
    }),
  };
  render(<ScorecardView evalCount={40} rerankerReady engine={engine} />);
  await user.click(screen.getByRole('button', { name: 'Run scorecard' }));
  report(3, 10);
  expect(await screen.findByText('3 / 10 runs')).toBeInTheDocument();
  finish();
  expect(await screen.findByText('Hybrid + rerank')).toBeInTheDocument();
});

test('without a ready reranker the button says so and the rerank row waits', async () => {
  const user = userEvent.setup();
  const engine = fakeEngine();
  engine.scorecard.mockResolvedValueOnce({ ...result, rows: result.rows.filter(r => r.name !== 'hybrid+rerank') });
  render(<ScorecardView evalCount={40} rerankerReady={false} engine={engine} />);
  await user.click(screen.getByRole('button', { name: 'Run (without rerank)' }));
  const row = (await screen.findByRole('rowheader', { name: 'Hybrid + rerank' })).closest('tr')!;
  expect(row).toHaveTextContent('Waiting for reranker…');
});

test('the per-question list shows the first correct rank, or — beyond the top 10', async () => {
  const user = userEvent.setup();
  render(<ScorecardView evalCount={40} rerankerReady engine={fakeEngine()} />);
  await user.click(screen.getByRole('button', { name: 'Run scorecard' }));
  await user.click(screen.getByRole('button', { name: /Per question/ }));
  const row = screen.getByText('How does NVIDIA describe export controls?').closest('tr')!;
  expect(within(row).getAllByRole('cell').map(c => c.textContent)).toEqual(['1', '2', '—', '1', '—']);
});

test('without a published evaluation set there is nothing to run', () => {
  render(<ScorecardView evalCount={null} rerankerReady engine={fakeEngine()} />);
  expect(screen.queryByRole('button', { name: /Run/ })).toBeNull();
});
