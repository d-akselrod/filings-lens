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

export function App() {
  useTheme();
  const { progress, init, failed, samples, reranker } = useBoot();
  const view = useUi(s => s.view);

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
    ? <LoadingScreen progress={progress} failed={failed} />
    : view === 'ask'
      ? <AnswerColumn samples={samples} />
      : <ScorecardView evalCount={init.hasEval ? init.manifest.eval?.count ?? null : null} rerankerReady={reranker.state === 'ready'} />;

  return (
    <AppShell
      header={<Header ready={init !== null} chunkCount={init?.chunkCount ?? null} facets={init?.facets ?? null} samples={samples} />}
      left={<SettingsPanel facets={init?.facets ?? null} rerankerStatus={reranker} />}
      main={<><Banners />{main}</>}
      right={<EvidencePanel notice={<EvidenceNotice />} />}
      footer={<Footer />}
    />
  );
}
