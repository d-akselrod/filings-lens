import { Check, Copy, RotateCcw, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { COPY, copyForCode } from '@/copy';
import { useSession, type Turn } from '@/state/session';
import { useUi } from '@/state/ui';
import type { ModelChoice } from '../../core/gemini';
import { AnswerText } from './AnswerText';
import { TimingBar } from './TimingBar';

export const MODEL_LABEL: Record<ModelChoice, string> = { fast: 'Gemma 4 · 26B', deep: 'Gemma 4 · 31B' };

export function AnswerCard({ turn }: { turn: Turn }) {
  const regenerate = useSession(s => s.regenerate);
  const busy = useSession(s => s.busy);
  const setUi = useUi(s => s.set);
  const [copied, setCopied] = useState(false);
  const a = turn.answer;
  const sources = a.passageIds.length || turn.passages.length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(a.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: nothing useful to tell the visitor
    }
  };

  let body: ReactNode = null;
  if (a.text) {
    body = <AnswerText text={a.text} checks={a.checks} streaming={a.status === 'streaming'} onCite={n => setUi({ highlighted: n })} />;
  } else if (a.status === 'idle' || a.status === 'streaming') {
    body = (
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <span className="inline-block size-1.5 animate-ping rounded-full bg-primary" aria-hidden />
        {a.status === 'idle' ? 'Searching the filings…' : `Writing with ${MODEL_LABEL[a.model]}…`}
      </p>
    );
  }

  return (
    <section aria-label="Answer" className="rounded-xl border bg-card px-4 py-3.5 shadow-panel">
      <header className="mb-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <span className="grid size-5 place-items-center rounded-md bg-linear-135 from-primary to-acc2" aria-hidden>
          <Sparkles className="size-3 fill-white text-white" />
        </span>
        <span className="font-semibold text-foreground">Answer</span>
        {sources > 0 && <span>· {sources} sources</span>}
        <span className="ml-1 rounded-full border px-2 py-px font-mono text-[10.5px]">{MODEL_LABEL[a.model]}</span>
        <span className="flex-1" />
        <IconButton label={copied ? 'Copied' : 'Copy answer'} onClick={() => void copy()} disabled={!a.text}>
          {copied ? <Check /> : <Copy />}
        </IconButton>
        <IconButton label="Regenerate" onClick={() => void regenerate()} disabled={busy}><RotateCcw /></IconButton>
      </header>

      {body}

      {a.status === 'interrupted' && (
        <Status tone="warn" action={<Button size="xs" variant="outline" disabled={busy} onClick={() => void regenerate()}>Retry</Button>}>
          {COPY.interrupted}
        </Status>
      )}
      {(a.status === 'error' || a.status === 'skipped') && <Status tone={a.error ? 'warn' : 'muted'}>{copyForCode(a.error)}</Status>}
      {turn.stale && a.status !== 'streaming' && (
        <Status tone="muted" action={<Button size="xs" variant="outline" disabled={busy} onClick={() => void regenerate()}>Regenerate</Button>}>
          {COPY.stale}
        </Status>
      )}

      <TimingBar embedMs={turn.embedMs} search={turn.search?.timings} answerMs={a.ms} />
    </section>
  );
}

function Status({ tone, action, children }: { tone: 'warn' | 'muted'; action?: ReactNode; children: ReactNode }) {
  return (
    <div role="status" className={`mt-2.5 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] ${tone === 'warn'
      ? 'bg-warn/10 text-foreground' : 'bg-panel2 text-muted-foreground'}`}>
      <span className="flex-1">{children}</span>
      {action}
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick(): void; disabled?: boolean; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={onClick} disabled={disabled}
          className="size-7 text-muted-foreground hover:text-foreground [&_svg]:size-3.5">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
