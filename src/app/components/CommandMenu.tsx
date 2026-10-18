import { Check, KeyRound, MessageSquareText, RotateCcw, Search, SunMoon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { companyLabel } from '@/lib/companies';
import { cn } from '@/lib/utils';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { useTheme } from '@/theme';
import type { Facets } from '../../core/types';
import type { Sample } from '../../worker/protocol';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** The header's search trigger plus the ⌘K / Ctrl+K palette of samples, filters and actions. */
export function CommandMenu({ facets, samples, className }: { facets: Facets | null; samples: Sample[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const filters = useSettings(s => s.settings.filters);
  const { toggleFilter, reset } = useSettings.getState();
  const { cycle } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={cn('flex min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border bg-panel2 py-1 pr-1.5 pl-2 text-[12px] text-faint hover:text-muted-foreground', className)}>
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">Search companies, sections…</span>
        <kbd className="ml-auto hidden rounded-[5px] border border-b-2 border-line2 bg-card px-1 font-mono text-[10px] text-muted-foreground sm:inline">
          {IS_MAC ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen} title="Command menu" description="Ask a sample question, filter the search, or run an action">
        <CommandInput placeholder="Type a company, section or action…" />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          {samples.length > 0 && (
            <CommandGroup heading="Sample questions">
              {samples.map(s => (
                <CommandItem key={s.question} value={s.question} onSelect={run(() => {
                  useUi.getState().set({ view: 'ask' });
                  void useSession.getState().ask(s.question, { sampleVector: s.vector });
                })}>
                  <MessageSquareText aria-hidden />{s.question}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {facets && (
            <>
              <CommandGroup heading="Companies">
                {facets.tickers.map(t => (
                  <CommandItem key={t} value={companyLabel(t)} onSelect={run(() => toggleFilter('tickers', t))}>
                    <span className="w-12 font-mono text-[11px] font-semibold">{t}</span>{companyLabel(t)}
                    {filters.tickers.includes(t) && <Check className="ml-auto text-primary" aria-label="Filtered" />}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Sections">
                {facets.items.map(({ item, title }) => (
                  <CommandItem key={item} value={`Item ${item} · ${title}`} onSelect={run(() => toggleFilter('items', item))}>
                    <span className="truncate">Item {item} · {title}</span>
                    {filters.items.includes(item) && <Check className="ml-auto text-primary" aria-label="Filtered" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          <CommandGroup heading="Actions">
            <CommandItem value="Reset search settings" onSelect={run(reset)}><RotateCcw aria-hidden />Reset search settings</CommandItem>
            <CommandItem value="Use my own key" onSelect={run(() => useUi.getState().set({ byokOpen: true }))}><KeyRound aria-hidden />Use my own key</CommandItem>
            <CommandItem value="Toggle theme" onSelect={run(cycle)}><SunMoon aria-hidden />Toggle theme</CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
