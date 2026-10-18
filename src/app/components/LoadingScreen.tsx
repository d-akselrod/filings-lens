import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { COPY } from '@/copy';
import type { LoadPhase, LoadProgress } from '../../worker/protocol';

const LABELS: Record<Exclude<LoadPhase, 'download' | 'ready'>, string> = {
  manifest: 'Fetching manifest',
  database: 'Building the database (PGlite)',
  'keyword-index': 'Indexing keywords (BM25)',
  vectors: 'Loading vectors',
};

const mb = (bytes: number) => (bytes / 1e6).toFixed(1);

export function LoadingScreen({ progress, failed }: { progress: LoadProgress; failed: boolean }) {
  if (failed) {
    return (
      <div className="grid flex-1 place-items-center p-6">
        <div role="alert" className="max-w-sm text-center">
          <p className="text-[14px]">{COPY.loadFailed}</p>
          <Button className="mt-3" size="sm" onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </div>
    );
  }
  const downloading = progress.phase === 'download';
  const total = progress.totalBytes ?? 0;
  const loaded = Math.min(progress.loadedBytes ?? 0, total);
  const { phase } = progress;
  const label = phase === 'download' ? `Downloading filings data — ${mb(loaded)} / ${mb(total)} MB` : phase === 'ready' ? 'Ready' : LABELS[phase];

  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="w-full max-w-xs" aria-live="polite">
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          <span>{label}</span>
        </p>
        {downloading && <Progress className="mt-2.5 h-1.5" value={total ? (loaded / total) * 100 : 0} aria-label="Download progress" />}
      </div>
    </div>
  );
}
