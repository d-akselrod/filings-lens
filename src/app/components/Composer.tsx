import { ArrowUp, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { useSettings } from '@/state/settings';
import type { SearchFilters } from '../../core/types';
import { MAX_QUESTION_CHARS } from '../../core/prompt';

const MAX_HEIGHT_PX = 4 * 24 + 16; // four 24px lines plus padding

export function Composer({ onSubmit, hasTurns, busy }: { onSubmit(q: string, followUp: boolean): void; hasTurns: boolean; busy: boolean }) {
  const [value, setValue] = useState('');
  const [followUp, setFollowUp] = useState(true);
  const filters = useSettings(s => s.settings.filters);
  const toggleFilter = useSettings(s => s.toggleFilter);
  const box = useRef<HTMLTextAreaElement>(null);
  const trimmed = value.trim();
  const canSubmit = !busy && trimmed.length > 0;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(trimmed, hasTurns && followUp);
    setValue('');
  };

  const tokens: Array<{ key: keyof SearchFilters; value: string | number; label: string }> = [
    ...filters.tickers.map(t => ({ key: 'tickers' as const, value: t, label: t })),
    ...filters.fiscalYears.map(y => ({ key: 'fiscalYears' as const, value: y, label: `FY${String(y).slice(-2)}` })),
    ...filters.items.map(item => ({ key: 'items' as const, value: item, label: `Item ${item}` })),
  ];

  return (
    <form onSubmit={e => { e.preventDefault(); submit(); }}
      className="mx-3 mb-3 flex flex-wrap items-end gap-1.5 rounded-xl border border-line2 bg-card p-1.5 pl-2 shadow-panel lg:mx-6">
      {tokens.length > 0 && (
        <div className="flex w-full flex-wrap gap-1 pt-0.5">
          {tokens.map(t => (
            <button key={`${t.key}-${t.value}`} type="button" aria-label={`Remove filter ${t.label}`} onClick={() => toggleFilter(t.key, t.value)}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-primary hover:bg-primary hover:text-primary-foreground">
              {t.label}<X className="size-3" aria-hidden />
            </button>
          ))}
        </div>
      )}
      <textarea ref={box} aria-label="Question" rows={1} maxLength={MAX_QUESTION_CHARS} value={value}
        placeholder={hasTurns ? 'Ask a follow-up…' : 'Ask about the 10-K filings…'}
        onChange={e => setValue(e.target.value.slice(0, MAX_QUESTION_CHARS))}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className="min-h-9 min-w-0 flex-1 resize-none bg-transparent py-2 text-[14px] leading-6 outline-none placeholder:text-faint" />
      <div className="flex items-center gap-1.5 pb-0.5">
        {value.length > 400 && <span className="num text-[11px] text-muted-foreground">{value.length}/{MAX_QUESTION_CHARS}</span>}
        {hasTurns && (
          <Toggle size="sm" pressed={followUp} onPressedChange={setFollowUp}
            className="h-8 rounded-lg px-2 text-[12px] text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-primary">
            Follow-up
          </Toggle>
        )}
        <Button type="submit" size="icon" aria-label="Ask" disabled={!canSubmit} className="size-8 rounded-lg bg-foreground text-background hover:bg-foreground/85">
          <ArrowUp />
        </Button>
      </div>
    </form>
  );
}
