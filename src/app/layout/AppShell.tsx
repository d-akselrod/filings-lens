import { PanelLeft, PanelRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useMediaQuery } from '@/lib/media';

interface Props {
  header: ReactNode; left: ReactNode; main: ReactNode; right: ReactNode; footer: ReactNode;
  leftLabel?: string; rightLabel?: string;
  /** Controls the right drawer on narrow screens (e.g. a citation chip opens Sources). */
  rightOpen?: boolean; onRightOpenChange?(open: boolean): void;
}

/** Header, three columns (≥1024px; wider side panels from 1280px), footer. Below 1024px the side panels become drawers. */
export function AppShell({ header, left, main, right, footer, leftLabel = 'Tune search', rightLabel = 'Sources', rightOpen, onRightOpenChange }: Props) {
  const wide = useMediaQuery('(min-width: 1024px)');
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="shrink-0 border-b bg-card/85 backdrop-blur">{header}</header>
      {wide ? (
        <div className="grid min-h-0 flex-1 grid-cols-[248px_minmax(0,1fr)_320px] xl:grid-cols-[280px_minmax(0,1fr)_360px]">
          <aside className="min-h-0 overflow-y-auto border-r bg-card">{left}</aside>
          <main className="flex min-h-0 min-w-0 flex-col">{main}</main>
          <aside className="min-h-0 overflow-y-auto border-l bg-card">{right}</aside>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 justify-between gap-2 border-b bg-card px-3 py-2">
            <Drawer side="left" label={leftLabel} icon={<PanelLeft />}>{left}</Drawer>
            <Drawer side="right" label={rightLabel} icon={<PanelRight />} open={rightOpen} onOpenChange={onRightOpenChange}>{right}</Drawer>
          </div>
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">{main}</main>
        </div>
      )}
      <footer className="shrink-0 border-t bg-card">{footer}</footer>
    </div>
  );
}

function Drawer({ side, label, icon, open, onOpenChange, children }: {
  side: 'left' | 'right'; label: string; icon: ReactNode; open?: boolean; onOpenChange?(open: boolean): void; children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">{icon}{label}</Button>
      </SheetTrigger>
      <SheetContent side={side} className="w-[320px] overflow-y-auto p-0" aria-describedby={undefined}>
        <SheetTitle className="sr-only">{label}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
