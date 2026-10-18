import { COPY } from '@/copy';

/** Rendered inside AppShell's <footer>. */
export function Footer() {
  return (
    <p className="px-4 py-2 text-[11.5px] text-muted-foreground">{COPY.footer}</p>
  );
}
