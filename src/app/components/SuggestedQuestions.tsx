import { useSession } from '@/state/session';
import type { Sample } from '../../worker/protocol';

/** Sample questions carry precomputed vectors, so they get full hybrid search even without a working key. */
export function SuggestedQuestions({ samples }: { samples: Sample[] }) {
  const turns = useSession(s => s.turns);
  const ask = useSession(s => s.ask);
  const busy = useSession(s => s.busy);
  const asked = new Set(turns.map(t => t.question));
  const shown = turns.length === 0 ? samples : samples.filter(s => !asked.has(s.question)).slice(0, 2);
  if (shown.length === 0) return null;
  return (
    <div>
      {turns.length > 0 && <p className="mb-1.5 text-[11.5px] font-medium text-faint">Try also</p>}
      <div className="flex flex-wrap gap-1.5">
        {shown.map(s => (
          <button key={s.question} type="button" disabled={busy} onClick={() => void ask(s.question, { sampleVector: s.vector })}
            className="rounded-full border bg-card px-3 py-1 text-left text-[12.5px] text-muted-foreground transition-colors hover:border-accline hover:text-primary disabled:opacity-50">
            {s.question}
          </button>
        ))}
      </div>
    </div>
  );
}
