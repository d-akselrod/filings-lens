import * as Comlink from 'comlink';
import type { Remote } from 'comlink';
import type { WorkerApi } from '../worker/protocol';

let engine: Remote<WorkerApi> | null = null;

/** The one search worker for the whole app, started on first use. */
export function getEngine(): Remote<WorkerApi> {
  engine ??= Comlink.wrap<WorkerApi>(new Worker(new URL('../worker/search.worker.ts', import.meta.url), { type: 'module' }));
  return engine;
}
