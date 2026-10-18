import { proxy } from 'comlink';
import { ChevronRight, Loader2, Play } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { getEngine } from '@/engine';
import { cn } from '@/lib/utils';
import { useSettings } from '@/state/settings';
import type { BaselineName, ScorecardResult, ScoreRow } from '../../core/scorecard';
import type { SearchSettings } from '../../core/types';
import type { WorkerApi } from '../../worker/protocol';

const ORDER: BaselineName[] = ['current', 'vector', 'keyword', 'hybrid', 'hybrid+rerank'];
const LABEL: Record<BaselineName, string> = {
  current: 'Your settings', vector: 'Vector only', keyword: 'Keyword only', hybrid: 'Hybrid', 'hybrid+rerank': 'Hybrid + rerank',
};
const SHORT: Record<BaselineName, string> = { current: 'Yours', vector: 'Vector', keyword: 'Keyword', hybrid: 'Hybrid', 'hybrid+rerank': '+ Rerank' };
const COLUMNS: Array<[keyof Omit<ScoreRow, 'name'>, string]> = [['recall5', 'Recall@5'], ['recall10', 'Recall@10'], ['mrr10', 'MRR@10'], ['ndcg10', 'nDCG@10']];

interface Run { status: 'idle' | 'running' | 'done' | 'error'; done: number; total: number; result: ScorecardResult | null; settings: SearchSettings | null }

export function ScorecardView({ evalCount, rerankerReady, engine = getEngine() }: {
  evalCount: number | null; rerankerReady: boolean; engine?: Pick<WorkerApi, 'scorecard'>;
}) {
  const settings = useSettings(s => s.settings);
  const [run, setRun] = useState<Run>({ status: 'idle', done: 0, total: 0, result: null, settings: null });

  const start = async () => {
    setRun(r => ({ ...r, status: 'running', done: 0, total: 0 }));
    try {
      const result = await engine.scorecard(settings, proxy((done: number, total: number) => setRun(r => ({ ...r, done, total }))));
      setRun(r => ({ ...r, status: 'done', result, settings }));
    } catch {
      setRun(r => ({ ...r, status: 'error' }));
    }
  };

  const rows = run.result?.rows ?? [];
  const best = Object.fromEntries(COLUMNS.map(([key]) => [key, Math.max(...rows.map(r => r[key]))]));
  const running = run.status === 'running';

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Scorecard</h2>
          {evalCount ? (
            <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
              How well search finds the right passages for {evalCount} reviewed test questions. Runs entirely in your browser with precomputed question embeddings; filters are ignored.
            </p>
          ) : (
            <p className="mt-1 text-[13.5px] text-muted-foreground">The scorecard needs the reviewed test questions, which aren't published with this data yet.</p>
          )}
        </div>

        {evalCount ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={() => void start()} disabled={running}>
                {running ? <Loader2 className="animate-spin" /> : <Play />}
                {rerankerReady ? 'Run scorecard' : 'Run (without rerank)'}
              </Button>
              {running && run.total > 0 && <span className="num text-[12px] text-muted-foreground">{run.done} / {run.total} runs</span>}
              {run.status === 'done' && run.settings !== settings && (
                <span className="text-[12.5px] text-muted-foreground">Settings changed since this run.</span>
              )}
              {run.status === 'error' && <span className="text-[12.5px] text-destructive">The scorecard failed to run. Try again.</span>}
            </div>

            <div className="overflow-x-auto rounded-xl border bg-card shadow-panel">
              <table aria-label="Scorecard results" className="w-full text-[13px]">
                <thead>
                  <tr className="border-b text-left text-[12px] text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-medium" />
                    {COLUMNS.map(([, label]) => <th key={label} scope="col" className="px-3 py-2 text-right font-medium">{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ORDER.map(name => {
                    const row = rows.find(r => r.name === name);
                    return (
                      <tr key={name} className={cn('border-b last:border-0', name === 'current' && 'bg-accent/40')}>
                        <th scope="row" className="px-3 py-2 text-left font-medium whitespace-nowrap">{LABEL[name]}</th>
                        {name === 'hybrid+rerank' && !row && (run.result || !rerankerReady) ? (
                          <td colSpan={COLUMNS.length} className="px-3 py-2 text-right text-muted-foreground">
                            {rerankerReady ? 'Run again to include the reranker.' : 'Waiting for reranker…'}
                          </td>
                        ) : COLUMNS.map(([key]) => (
                          <td key={key} className="num px-3 py-2 text-right">
                            {row ? (row[key] === best[key] ? <strong className="font-semibold text-primary">{row[key].toFixed(3)}</strong> : row[key].toFixed(3)) : '—'}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {run.result && (
              <Collapsible>
                <CollapsibleTrigger className="group flex items-center gap-1 text-[13px] font-medium">
                  <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
                  Per question
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 overflow-x-auto rounded-xl border bg-card">
                  <table aria-label="First correct passage per question" className="w-full text-[12.5px]">
                    <thead>
                      <tr className="border-b text-left text-[11.5px] text-muted-foreground">
                        <th scope="col" className="px-3 py-2 font-medium">Question</th>
                        {ORDER.map(name => <th key={name} scope="col" className="px-2 py-2 text-right font-medium whitespace-nowrap">{SHORT[name]}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {run.result.perQuestion.map(q => (
                        <tr key={q.id} className="border-b last:border-0">
                          <th scope="row" className="px-3 py-1.5 text-left font-normal">{q.question}</th>
                          {ORDER.map(name => {
                            const rank = q.firstGoldRank[name];
                            return <td key={name} className="num px-2 py-1.5 text-right">{rank && rank <= 10 ? rank : '—'}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
