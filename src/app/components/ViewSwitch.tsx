import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useUi, type UiState } from '@/state/ui';

const ITEM = 'h-6 rounded-md px-2.5 text-[12px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground '
  + 'data-[state=on]:bg-segon data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_2px_rgba(0,0,0,.12),0_0_0_1px_var(--fl-line)]';

export function ViewSwitch() {
  const view = useUi(s => s.view);
  const set = useUi(s => s.set);
  return (
    <ToggleGroup type="single" aria-label="View" value={view} onValueChange={v => { if (v) set({ view: v as UiState['view'] }); }}
      className="gap-0.5 rounded-lg border bg-panel2 p-0.5">
      <ToggleGroupItem value="ask" className={ITEM}>Ask</ToggleGroupItem>
      <ToggleGroupItem value="scorecard" className={ITEM}>Scorecard</ToggleGroupItem>
    </ToggleGroup>
  );
}
