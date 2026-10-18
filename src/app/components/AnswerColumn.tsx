import { COPY } from '@/copy';
import { useSession } from '@/state/session';
import type { Sample } from '../../worker/protocol';
import { AnswerCard } from './AnswerCard';
import { Composer } from './Composer';
import { SuggestedQuestions } from './SuggestedQuestions';

export function AnswerColumn({ samples }: { samples: Sample[] }) {
  const turns = useSession(s => s.turns);
  const busy = useSession(s => s.busy);
  const ask = useSession(s => s.ask);
  const latest = turns.at(-1);
  const earlier = turns.slice(0, -1);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {earlier.length > 0 && (
            <ul aria-label="Earlier questions" className="flex flex-col gap-0.5 text-[12px] text-muted-foreground">
              {earlier.map(t => <li key={t.id} className="truncate">Earlier: {t.question}</li>)}
            </ul>
          )}
          {latest ? (
            <>
              <div>
                <p className="mb-0.5 text-[11px] font-medium text-faint">Question</p>
                <h2 className="text-[13.5px] leading-snug font-semibold tracking-tight">{latest.question}</h2>
              </div>
              <AnswerCard turn={latest} />
            </>
          ) : (
            <div className="pt-[8vh] pb-2">
              <h2 className="text-lg font-semibold tracking-tight">{COPY.emptyTitle}</h2>
              <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">{COPY.emptyBody}</p>
            </div>
          )}
          <SuggestedQuestions samples={samples} />
        </div>
      </div>
      <Composer onSubmit={(q, followUp) => void ask(q, { followUp })} hasTurns={turns.length > 0} busy={busy} />
    </div>
  );
}
