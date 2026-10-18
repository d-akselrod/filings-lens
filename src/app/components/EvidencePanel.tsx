import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/state/session';
import { useUi } from '@/state/ui';
import { tokenize } from '../../core/tokenize';
import { SourceCard } from './SourceCard';
import { TraceTable } from './TraceTable';

const SHOWN = 20;

const TAB = 'flex-none px-0 text-[12.5px] data-[state=active]:font-semibold';

/** Sources and Trace for the latest turn. `notice` (keyword-only, no matches, reranker loading) sits above the sources. */
export function EvidencePanel({ notice }: { notice?: ReactNode }) {
  const turn = useSession(s => s.turns.at(-1));
  const highlighted = useUi(s => s.highlighted);

  if (!turn) {
    return <p className="p-4 text-[12.5px] text-muted-foreground">Sources for your answer appear here, with every score that ranked them.</p>;
  }

  const results = turn.search?.results ?? [];
  const chunks = new Map(turn.results.map(c => [c.id, c]));
  const terms = new Set(tokenize(turn.retrievalText));
  // Citation [n] refers to the passages the answer was written from, which outlive a re-search.
  const cited = turn.answer.passageIds.length > 0 ? turn.answer.passageIds : turn.passages.map(p => p.id);
  const passageCount = turn.passages.length;
  const shown = results.slice(0, Math.max(SHOWN, passageCount));
  const s = turn.settings;

  const card = (r: (typeof results)[number]) => {
    const chunk = chunks.get(r.chunkId);
    if (!chunk) return null;
    const n = cited.indexOf(r.chunkId) + 1 || null;
    return <SourceCard key={r.chunkId} result={r} chunk={chunk} n={n} terms={terms} highlighted={n !== null && n === highlighted} />;
  };

  return (
    <Tabs defaultValue="sources" className="flex h-full min-h-0 flex-col gap-0">
      <TabsList variant="line" className="h-10 w-full shrink-0 justify-start gap-4 border-b px-3 pb-0">
        <TabsTrigger value="sources" className={TAB}>
          Sources
          <span className="ml-1.5 rounded-[5px] border bg-panel2 px-1 font-mono text-[10px] font-medium text-muted-foreground">{shown.length}</span>
        </TabsTrigger>
        <TabsTrigger value="trace" className={TAB}>Trace</TabsTrigger>
      </TabsList>

      <TabsContent value="sources" className="min-h-0 flex-1 overflow-y-auto p-2.5">
        <div className="flex flex-col gap-2">
          {notice}
          {!turn.search && turn.answer.status === 'idle' && <p className="p-1.5 text-[12.5px] text-muted-foreground">Searching…</p>}
          {shown.slice(0, passageCount).map(card)}
          {shown.length > passageCount && (
            <>
              <h3 className="mt-2 px-0.5 text-[11.5px] font-semibold text-muted-foreground">More results</h3>
              {shown.slice(passageCount).map(card)}
            </>
          )}
        </div>
      </TabsContent>

      <TabsContent value="trace" className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {turn.search && (
          <>
            <p className="mb-2 font-mono text-[10.5px] text-muted-foreground">
              {results.length} results · {turn.search.usedMode} · {s.metric} · {s.dims}d · k1 {s.k1} · b {s.b} · RRF k {s.rrfK}
            </p>
            <TraceTable results={results} chunks={chunks} />
          </>
        )}
      </TabsContent>
    </Tabs>
  );
}
