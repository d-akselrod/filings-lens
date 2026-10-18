import { Fragment } from 'react';
import type { SearchResponse } from '../../core/types';

const format = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : ms < 0.5 ? '<1ms' : `${Math.round(ms)}ms`);

export function TimingBar({ embedMs, search, answerMs }: { embedMs?: number; search?: SearchResponse['timings']; answerMs?: number }) {
  const steps = [
    { label: 'embed', ms: embedMs ?? 0, color: '#a78bfa' },
    { label: 'search', ms: search ? search.vectorMs + search.keywordMs + search.fuseMs : 0, color: '#38bdf8' },
    { label: 'rerank', ms: search?.rerankMs ?? 0, color: '#f59e0b' },
    { label: 'answer', ms: answerMs ?? 0, color: 'var(--fl-acc)' },
  ].filter(s => s.ms > 0);
  if (steps.length === 0) return null;
  return (
    <div className="mt-3 border-t border-dashed pt-2.5">
      <div className="flex h-1.5 gap-0.5" aria-hidden>
        {steps.map(s => <b key={s.label} className="min-w-1 rounded-[3px]" style={{ flex: s.ms, background: s.color }} />)}
      </div>
      <p data-testid="timing-legend" className="mt-1.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[10.5px] text-muted-foreground">
        {steps.map((s, i) => (
          <Fragment key={s.label}>
            {i > 0 && <span className="text-faint">{' · '}</span>}
            <span><i className="mr-1 inline-block size-[7px] rounded-[2px]" style={{ background: s.color }} />{s.label} {format(s.ms)}</span>
          </Fragment>
        ))}
      </p>
    </div>
  );
}
