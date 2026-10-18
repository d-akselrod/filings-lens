import { Info, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { COPY } from '@/copy';
import { useKeys } from '@/state/keys';
import { useSession } from '@/state/session';
import { useUi } from '@/state/ui';

const BANNER = { restricted: COPY.restricted, exhausted: COPY.exhausted, missing: COPY.missing } as const;

/** Why the built-in key can't answer (restricted region > used up > missing), until the visitor adds a key. */
export function Banners() {
  const builtin = useKeys(s => s.builtin);
  const hasOwnKey = useKeys(s => s.byokKey !== null);
  const openByok = () => useUi.getState().set({ byokOpen: true });
  if (hasOwnKey || !(builtin in BANNER)) return null;
  return (
    <div role="status" className="mx-3 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[13px] lg:mx-6">
      <span className="min-w-[16rem] flex-1">{BANNER[builtin as keyof typeof BANNER]}</span>
      <Button size="sm" variant="outline" onClick={openByok} className="h-7 bg-card"><KeyRound />Use my own key</Button>
    </div>
  );
}

/** Notes about the latest search, shown above its sources. */
export function EvidenceNotice() {
  const turn = useSession(s => s.turns.at(-1));
  const notes = turn?.search?.notes ?? [];
  if (!turn?.search) return null;
  const lines = turn.search.results.length === 0 || notes.includes('no-matches')
    ? [COPY.noMatches]
    : [notes.includes('no-query-vector') && COPY.keywordOnly, notes.includes('reranker-unavailable') && COPY.rerankerUnavailable].filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {lines.map(line => (
        <p key={line as string} className="flex gap-1.5 rounded-lg bg-panel2 px-2.5 py-2 text-[12px] text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />{line}
        </p>
      ))}
    </div>
  );
}
