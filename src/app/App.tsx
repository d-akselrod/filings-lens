import { useEffect } from 'react';
import { boot, useBoot } from './boot';
import { AnswerColumn } from './components/AnswerColumn';
import { Banners, EvidenceNotice } from './components/Banners';
import { EvidencePanel } from './components/EvidencePanel';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { LoadingScreen } from './components/LoadingScreen';
import { ScorecardView } from './components/ScorecardView';
import { SettingsPanel } from './components/SettingsPanel';
import { AppShell } from './layout/AppShell';
import { useSession } from './state/session';
import { useSettings } from './state/settings';
import { useUi } from './state/ui';
import { useTheme } from './theme';

const RERUN_DEBOUNCE_MS = 150;

/** Only the loading screen follows download progress, so progress updates don't re-render the whole app. */
function BootProgress() {
  const progress = useBoot(s => s.progress);
  const failed = useBoot(s => s.failed);
  return <LoadingScreen progress={progress} failed={failed} />;
}

export function App() {
  useTheme();
  const init = useBoot(s => s.init);
  const samples = useBoot(s => s.samples);
  const reranker = useBoot(s => s.reranker);
  const view = useUi(s => s.view);
  const evidenceOpen = useUi(s => s.evidenceOpen);

  useEffect(() => boot(), []);

  // Changing a search setting re-runs the latest search for free (no API call); the answer is marked stale.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useSettings.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (useSession.getState().turns.length > 0) void useSession.getState().rerun();
      }, RERUN_DEBOUNCE_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  const main = !init
    ? <BootProgress />
    : view === 'ask'
      ? <AnswerColumn samples={samples} />
      : <ScorecardView evalCount={init.hasEval ? init.manifest.eval?.count ?? null : null} rerankerReady={reranker.state === 'ready'} />;

  return (
    <AppShell
      header={<Header ready={init !== null} chunkCount={init?.chunkCount ?? null} facets={init?.facets ?? null} samples={samples} />}
      left={<SettingsPanel facets={init?.facets ?? null} rerankerStatus={reranker} />}
      main={<><Banners />{main}</>}
      right={<EvidencePanel notice={<EvidenceNotice />} />}
      rightOpen={evidenceOpen}
      onRightOpenChange={open => useUi.getState().set({ evidenceOpen: open })}
      footer={<Footer />}
    />
  );
}
