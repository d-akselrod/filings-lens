import { proxy } from 'comlink';
import { create } from 'zustand';
import type { InitResult, LoadProgress, Sample } from '../worker/protocol';
import { fetchStatus } from './api/client';
import type { RerankerStatus } from './components/SettingsPanel';
import { getEngine } from './engine';
import { useKeys } from './state/keys';
import { setCorpusVersion } from './state/session';

export interface BootState {
  progress: LoadProgress;
  init: InitResult | null;
  failed: boolean;
  samples: Sample[];
  reranker: RerankerStatus;
}

export const useBoot = create<BootState>(() => ({
  progress: { phase: 'manifest' }, init: null, failed: false, samples: [], reranker: { state: 'idle' },
}));

let started = false;

/** Loads the data into the worker, then samples and the reranker; runs once even if React mounts twice. */
export function boot(): void {
  if (started) return;
  started = true;
  const engine = getEngine();
  void fetchStatus().then(s => useKeys.getState().markBuiltin(s.builtInKey), () => {});
  engine.init(proxy((progress: LoadProgress) => useBoot.setState({ progress }))).then(async init => {
    setCorpusVersion(init.manifest.corpus.file);
    useBoot.setState({ init, reranker: { state: 'loading' } });
    useBoot.setState({ samples: await engine.samples() });
    let reportedPercent = -1;
    await engine.loadReranker(proxy((loaded: number, total: number) => {
      // The model arrives in hundreds of small chunks; one update per percent keeps the UI responsive.
      const percent = total > 0 ? Math.floor((loaded / total) * 100) : 0;
      if (percent === reportedPercent) return;
      reportedPercent = percent;
      useBoot.setState({ reranker: { state: 'loading', loaded, total } });
    }));
    useBoot.setState({ reranker: { state: 'ready' } });
  }).catch(() => {
    if (useBoot.getState().init) useBoot.setState({ reranker: { state: 'error' } });
    else useBoot.setState({ failed: true });
  });
}
