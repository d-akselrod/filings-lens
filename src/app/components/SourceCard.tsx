import { useEffect, useRef, type ReactNode } from 'react';
import { highlightSegments, snippet } from '@/highlight';
import { cn } from '@/lib/utils';
import type { ChunkView, RankedResult } from '../../core/types';

const score = (s: number, digits: number) => s.toFixed(digits).replace(/^0(?=\.)/, '');

export function SourceCard({ result: r, chunk: c, n, terms, highlighted }: {
  result: RankedResult; chunk: ChunkView; n: number | null; terms: ReadonlySet<string>; highlighted: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  return (
    <article ref={ref} data-highlighted={highlighted} aria-label={`${c.ticker} 10-K FY${c.fiscalYear}, Item ${c.item}`}
      className={cn('rounded-[10px] border bg-card px-3 py-2.5 transition-shadow', highlighted && 'border-accline shadow-[0_0_0_3px_var(--accent)]')}>
      <header className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {n !== null && (
          <span role="img" aria-label={`Passage ${n}`}
            className="inline-flex h-4 min-w-4 items-center justify-center rounded-[5px] border border-accline bg-accent px-1 font-mono text-[10px] font-semibold text-primary">
            {n}
          </span>
        )}
        <span className="font-mono text-[11px] font-semibold text-foreground">{c.ticker}</span>
        <span>10-K · FY{c.fiscalYear}</span>
      </header>
      <h3 className="mt-1 mb-0.5 truncate text-[12.5px] font-semibold" title={`Item ${c.item} · ${c.itemTitle}`}>Item {c.item} · {c.itemTitle}</h3>
      <p className="line-clamp-4 text-[12px] leading-relaxed text-muted-foreground">
        {highlightSegments(snippet(c.text, terms), terms).map((s, i) => (s.hit
          ? <mark key={i} className="rounded-[3px] bg-hl px-0.5 text-inherit">{s.text}</mark>
          : s.text))}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {r.keyword && <Pill>BM25 #{r.keyword.rank}</Pill>}
        {r.vector && <Pill title={`distance ${r.vector.distance.toFixed(4)}`}>Vec #{r.vector.rank}</Pill>}
        <Pill>RRF {score(r.fused.score, 4)}</Pill>
        {r.rerank && <Pill accent>Rerank {score(r.rerank.score, 2)}</Pill>}
      </div>
      <a href={c.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[11.5px] text-primary underline-offset-2 hover:underline">
        View filing on sec.gov ↗
      </a>
    </article>
  );
}

function Pill({ accent, title, children }: { accent?: boolean; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={cn('rounded-[5px] border px-1.5 py-px font-mono text-[10px] font-medium',
      accent ? 'border-accline bg-accent text-primary' : 'bg-panel2 text-muted-foreground')}>
      {children}
    </span>
  );
}
