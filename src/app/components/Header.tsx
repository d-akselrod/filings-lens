import { KeyRound, Loader2, Monitor, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { COPY } from '@/copy';
import { useKeys } from '@/state/keys';
import { useSession } from '@/state/session';
import { useUi } from '@/state/ui';
import { useTheme } from '@/theme';
import type { Facets } from '../../core/types';
import type { Sample } from '../../worker/protocol';
import { ByokDialog } from './ByokDialog';
import { CommandMenu } from './CommandMenu';
import { ModelPicker } from './ModelPicker';
import { ViewSwitch } from './ViewSwitch';

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;

export function Header({ ready, chunkCount, facets, samples }: { ready: boolean; chunkCount: number | null; facets: Facets | null; samples: Sample[] }) {
  const { pref, cycle } = useTheme();
  const hasOwnKey = useKeys(s => s.byokKey !== null);
  const byokOpen = useUi(s => s.byokOpen);
  const setUi = useUi(s => s.set);
  const deep = useSession(s => s.model === 'deep');
  const ThemeIcon = THEME_ICON[pref];

  return (
    <>
      <div className="flex min-w-0 items-center gap-2 overflow-hidden px-3 py-2 whitespace-nowrap">
        <div className="flex items-center gap-2 text-[14px] font-semibold tracking-tight">
          <span className="size-[18px] rounded-md bg-linear-135 from-primary to-acc2 shadow-[inset_0_0_0_1px_rgba(255,255,255,.25)]" aria-hidden />
          Filings Lens
        </div>
        <CommandMenu facets={facets} samples={samples} />
        <span className="flex-1" />
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
        <ModelPicker />
        <IconButton label="Use my own key" onClick={() => setUi({ byokOpen: true })}>
          <KeyRound />
          {hasOwnKey && <i data-testid="byok-dot" className="absolute top-1 right-1 size-1.5 rounded-full bg-ok" aria-hidden />}
        </IconButton>
        <IconButton label={`Theme: ${pref}`} onClick={cycle}><ThemeIcon /></IconButton>
        <ViewSwitch />
      </div>
      {deep && <p role="note" className="border-t bg-warn/10 px-3 py-1 text-[12px] text-foreground">{COPY.deepNote}</p>}
      <ByokDialog open={byokOpen} onOpenChange={open => setUi({ byokOpen: open })} />
    </>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} onClick={onClick}
          className="relative grid size-7 shrink-0 place-items-center rounded-lg border bg-card text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-3.5">
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
