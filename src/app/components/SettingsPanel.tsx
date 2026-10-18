import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useSettings } from '@/state/settings';
import type { Dims, Facets, Metric, SearchMode } from '../../core/types';
import { MetricHelp } from './MetricHelp';

export interface RerankerStatus { state: 'idle' | 'loading' | 'ready' | 'error'; loaded?: number; total?: number }

const DIMS: Dims[] = [128, 256, 512, 768];
const METRICS: Array<[label: string, value: Metric]> = [['Cosine', 'cosine'], ['Euclidean', 'l2'], ['Dot', 'dot']];
const MODES: Array<[label: string, value: SearchMode]> = [['Hybrid', 'hybrid'], ['Vector', 'vector'], ['Keyword', 'keyword']];

const TILE = 'h-7 min-w-0 rounded-[7px] border border-border bg-card px-1 font-mono text-[11px] font-medium text-muted-foreground '
  + 'hover:bg-panel2 data-[state=on]:border-accline data-[state=on]:bg-accent data-[state=on]:text-primary';

const mb = (bytes: number) => (bytes / 1e6).toFixed(1);

function rerankerLine(r: RerankerStatus): string {
  if (r.state === 'ready') return 'Reranker: ready';
  if (r.state === 'error') return 'Reranker: failed to load';
  if (r.state === 'loading') return r.total ? `Reranker: loading ${mb(r.loaded ?? 0)} / ${mb(r.total)} MB` : 'Reranker: loading';
  return 'Reranker: not loaded yet';
}

export function SettingsPanel({ facets, rerankerStatus }: { facets: Facets | null; rerankerStatus: RerankerStatus }) {
  const { settings: s, set, toggleFilter, reset } = useSettings();
  const { tickers, fiscalYears, items } = s.filters;

  return (
    <div className="flex flex-col gap-5 p-4 text-[13px]">
      {facets && (
        <>
          <Group title="Companies" aside={
            <span data-testid="companies-count" className={cn(tickers.length > 0 && 'text-primary')}>
              {tickers.length === 0 ? 'All' : `${tickers.length} of ${facets.tickers.length}`}
            </span>
          }>
            <div className="grid grid-cols-4 gap-1">
              {facets.tickers.map(t => (
                <Toggle key={t} pressed={tickers.includes(t)} onPressedChange={() => toggleFilter('tickers', t)} className={TILE}>{t}</Toggle>
              ))}
            </div>
          </Group>

          <Group title="Fiscal year">
            <div className="grid grid-cols-4 gap-1">
              {facets.fiscalYears.map(y => (
                <Toggle key={y} pressed={fiscalYears.includes(y)} onPressedChange={() => toggleFilter('fiscalYears', y)} className={TILE}>
                  FY{String(y).slice(-2)}
                </Toggle>
              ))}
            </div>
          </Group>

          <Group title="Sections">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-full justify-between font-normal">
                  {items.length === 0 ? 'All sections' : `${items.length} of ${facets.items.length} sections`}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="max-h-80 w-72 overflow-y-auto p-1">
                {facets.items.map(({ item, title }) => {
                  const id = `section-${item}`;
                  return (
                    <label key={item} htmlFor={id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-panel2">
                      <Checkbox id={id} checked={items.includes(item)} onCheckedChange={() => toggleFilter('items', item)} />
                      <span className="truncate">Item {item} · {title}</span>
                    </label>
                  );
                })}
              </PopoverContent>
            </Popover>
          </Group>
        </>
      )}

      <Group title="Vector search">
        <Row label="Metric"><MetricHelp /></Row>
        <Segmented label="Metric" value={s.metric} options={METRICS} onChange={metric => set({ metric })} />
        <SliderField label="Dimensions" display={s.dims} min={0} max={DIMS.length - 1} step={1}
          value={DIMS.indexOf(s.dims)} onChange={i => set({ dims: DIMS[i]! })} />
        <Row label="Re-normalize">
          {s.metric === 'cosine' ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} aria-label="Why Re-normalize is off" className="inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                  <Switch aria-label="Re-normalize" checked={s.renormalize} disabled />
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">Cosine always normalizes</TooltipContent>
            </Tooltip>
          ) : (
            <Switch aria-label="Re-normalize" checked={s.renormalize} onCheckedChange={renormalize => set({ renormalize })} />
          )}
        </Row>
        <SliderField label="Candidates" display={s.candidates} min={10} max={100} step={10} value={s.candidates} onChange={candidates => set({ candidates })} />
      </Group>

      <Group title="Keyword · BM25">
        <SliderField label="k1" display={s.k1.toFixed(1)} min={0} max={3} step={0.1} value={s.k1} onChange={k1 => set({ k1 })} />
        <SliderField label="b" display={s.b.toFixed(2)} min={0} max={1} step={0.05} value={s.b} onChange={b => set({ b })} />
      </Group>

      <Group title="Fusion">
        <Row label="Mode" />
        <Segmented label="Mode" value={s.mode} options={MODES} onChange={mode => set({ mode })} />
        <SliderField label="RRF k" display={s.rrfK} min={1} max={120} step={1} value={s.rrfK} onChange={rrfK => set({ rrfK })} />
        {s.mode === 'hybrid' && (
          <SliderField label="Vector weight α" display={s.alpha.toFixed(2)} min={0} max={1} step={0.05} value={s.alpha} onChange={alpha => set({ alpha })} />
        )}
      </Group>

      <Group title="Rerank">
        <Row label={`Rerank top ${s.rerankTop}`}>
          <Switch aria-label="Rerank" checked={s.rerank} onCheckedChange={rerank => set({ rerank })} />
        </Row>
        <Slider aria-label="Rerank top N" min={5} max={50} step={5} value={[s.rerankTop]} disabled={!s.rerank}
          onValueChange={([rerankTop]) => set({ rerankTop: rerankTop! })} className="my-1.5" />
        <p className="mt-2 text-[11.5px] text-muted-foreground">{rerankerLine(rerankerStatus)}</p>
      </Group>

      <Group title="Answer">
        <SliderField label="Passages sent to the model" display={s.contextPassages} min={3} max={10} step={1}
          value={s.contextPassages} onChange={contextPassages => set({ contextPassages })} />
      </Group>

      <Button variant="outline" size="sm" onClick={reset}>Reset to defaults</Button>
    </div>
  );
}

function Group({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 flex justify-between text-[11.5px] font-semibold text-muted-foreground">
        <span>{title}</span>
        {aside}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="mt-2 mb-1.5 flex min-h-5 items-center justify-between gap-2">
      <span>{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: Array<[label: string, value: T]>; onChange: (v: T) => void;
}) {
  return (
    <ToggleGroup type="single" aria-label={label} value={value} onValueChange={v => { if (v) onChange(v as T); }}
      className="flex w-full gap-0.5 rounded-lg border bg-panel2 p-0.5">
      {options.map(([text, v]) => (
        <ToggleGroupItem key={v} value={v}
          className="h-7 flex-1 rounded-md px-1 text-[12px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-segon data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_2px_rgba(0,0,0,.12),0_0_0_1px_var(--fl-line)]">
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function SliderField({ label, display, value, min, max, step, onChange }: {
  label: string; display: ReactNode; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <Row label={label}>
        <span className="num rounded-[5px] border bg-panel2 px-1.5 text-[11px]">{display}</span>
      </Row>
      <Slider aria-label={label} min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v!)} />
    </div>
  );
}
