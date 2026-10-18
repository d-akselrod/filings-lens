import { KeyRound, Loader2, Monitor, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useKeys } from '@/state/keys';
import { useUi } from '@/state/ui';
import { useTheme } from '@/theme';
import type { Facets } from '../../core/types';
import type { Sample } from '../../worker/protocol';
import { MODEL_LABEL } from './AnswerCard';
import { ByokDialog } from './ByokDialog';
import { CommandMenu } from './CommandMenu';
import { ViewSwitch } from './ViewSwitch';

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;

export function Header({ ready, chunkCount, facets, samples }: { ready: boolean; chunkCount: number | null; facets: Facets | null; samples: Sample[] }) {
  const { pref, cycle } = useTheme();
  const hasOwnKey = useKeys(s => s.byokKey !== null);
  const byokOpen = useUi(s => s.byokOpen);
  const setUi = useUi(s => s.set);
  const ThemeIcon = THEME_ICON[pref];

  return (
    <>
      {/* Below md the header wraps: brand and model/key/theme on top, search and view switch underneath. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2 whitespace-nowrap md:flex-nowrap">
        <div className="order-1 flex items-center gap-2 text-[14px] font-semibold tracking-tight md:order-none">
          <span className="size-[18px] rounded-md bg-linear-135 from-primary to-acc2 shadow-[inset_0_0_0_1px_rgba(255,255,255,.25)]" aria-hidden />
          Filings Lens
        </div>
        <CommandMenu facets={facets} samples={samples} className="order-7 flex-1 md:order-none md:ml-1.5 md:flex-[0_1_220px]" />
        <span className="order-2 flex-1 md:order-none" />
        <span className="hidden items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-[11.5px] text-muted-foreground md:inline-flex">
          {ready ? (
            <>
              <i className="size-[7px] rounded-full bg-ok shadow-[0_0_0_3px_color-mix(in_srgb,var(--fl-ok)_22%,transparent)]" aria-hidden />
              Postgres · {(chunkCount ?? 0).toLocaleString('en-US')} passages
            </>
          ) : (
            <><Loader2 className="size-3 animate-spin" aria-hidden />Loading…</>
          )}
        </span>
        <span className="order-3 inline-flex items-center rounded-full border bg-card px-2.5 py-1 text-[11.5px] text-muted-foreground md:order-none">{MODEL_LABEL.fast}</span>
        <IconButton className="order-4 md:order-none" label="Use my own key" onClick={() => setUi({ byokOpen: true })}>
          <KeyRound />
          {hasOwnKey && <i data-testid="byok-dot" className="absolute top-1 right-1 size-1.5 rounded-full bg-ok" aria-hidden />}
        </IconButton>
        <IconButton className="order-5 md:order-none" label={`Theme: ${pref}`} onClick={cycle}><ThemeIcon /></IconButton>
        <span className="order-6 h-0 basis-full md:hidden" aria-hidden />
        <ViewSwitch className="order-8 md:order-none" />
      </div>
      <ByokDialog open={byokOpen} onOpenChange={open => setUi({ byokOpen: open })} />
    </>
  );
}

function IconButton({ label, onClick, className, children }: { label: string; onClick(): void; className?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} onClick={onClick}
          className={cn('relative grid size-7 shrink-0 place-items-center rounded-lg border bg-card text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-3.5', className)}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
