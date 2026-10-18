import { rankDelta } from '@/highlight';
import { cn } from '@/lib/utils';
import type { ChunkView, RankedResult } from '../../core/types';

const HEADERS = ['#', 'Passage', 'BM25', 'Vector', 'Fused', 'Rerank', 'Δ'];

export function TraceTable({ results, chunks }: { results: RankedResult[]; chunks: ReadonlyMap<number, ChunkView> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {HEADERS.map(h => <th key={h} scope="col" className="px-1.5 py-1.5 font-medium whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody className="num">
          {results.map(r => {
            const c = chunks.get(r.chunkId);
            const delta = rankDelta(r);
            return (
              <tr key={r.chunkId} className="border-b border-border/60 last:border-0">
                <td className="px-1.5 py-1 text-muted-foreground">{r.finalRank}</td>
                <td className="px-1.5 py-1 font-sans whitespace-nowrap">
                  {c ? `${c.ticker} FY${String(c.fiscalYear).slice(-2)} · Item ${c.item}` : `#${r.chunkId}`}
                </td>
                <td className="px-1.5 py-1">{r.keyword ? r.keyword.rank : '—'}</td>
                <td className="px-1.5 py-1 whitespace-nowrap">{r.vector ? `${r.vector.rank} · ${r.vector.distance.toFixed(4)}` : '—'}</td>
                <td className="px-1.5 py-1">{r.fused.score.toFixed(4)}</td>
                <td className="px-1.5 py-1">{r.rerank ? r.rerank.score.toFixed(2) : '—'}</td>
                <td className={cn('px-1.5 py-1', delta > 0 ? 'text-ok' : delta < 0 ? 'text-destructive' : 'text-faint')}>
                  {delta > 0 ? `▲${delta}` : delta < 0 ? `▼${-delta}` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
