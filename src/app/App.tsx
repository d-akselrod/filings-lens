import { AppShell } from './layout/AppShell';
import { useTheme } from './theme';

export function App() {
  useTheme();
  return (
    <AppShell
      header={<div className="px-4 py-2 text-sm font-semibold">Filings Lens</div>}
      left={<div className="p-4 text-sm text-muted-foreground">Settings</div>}
      main={<div className="p-6 text-sm text-muted-foreground">Answers</div>}
      right={<div className="p-4 text-sm text-muted-foreground">Sources</div>}
      footer={<div className="px-4 py-2 text-xs text-muted-foreground">Footer</div>}
    />
  );
}
