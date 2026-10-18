import { create, type StoreApi, type UseBoundStore } from 'zustand';

export type BuiltinStatus = 'unknown' | 'available' | 'restricted' | 'exhausted' | 'missing';

export interface KeysState {
  builtin: BuiltinStatus;
  byokKey: string | null;
  remember: boolean;
  setByok(key: string, remember: boolean): void;
  clearByok(): void;
  markBuiltin(s: BuiltinStatus): void;
}

const STORAGE_KEY = 'fl-byok';

/** Storage can be missing or throw (private mode, blocked site data); the key then lives in memory only. */
function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

function attempt(write: () => void): void {
  try {
    write();
  } catch {
    // ignored: see storage()
  }
}

function stored(): { byokKey: string | null; remember: boolean } {
  let local: string | null = null;
  let session: string | null = null;
  attempt(() => { local = storage('local')?.getItem(STORAGE_KEY) ?? null; });
  attempt(() => { session = storage('session')?.getItem(STORAGE_KEY) ?? null; });
  if (local) return { byokKey: local, remember: true };
  return { byokKey: session, remember: false };
}

export const useKeys: UseBoundStore<StoreApi<KeysState>> = create<KeysState>()(set => ({
  builtin: 'unknown',
  ...stored(),
  setByok: (key, remember) => {
    attempt(() => storage(remember ? 'local' : 'session')?.setItem(STORAGE_KEY, key));
    attempt(() => storage(remember ? 'session' : 'local')?.removeItem(STORAGE_KEY));
    set({ byokKey: key, remember });
  },
  clearByok: () => {
    attempt(() => storage('local')?.removeItem(STORAGE_KEY));
    attempt(() => storage('session')?.removeItem(STORAGE_KEY));
    set({ byokKey: null, remember: false });
  },
  markBuiltin: builtin => set({ builtin }),
}));

/** The visitor's own key wins; the built-in key is tried until the API says it can't be used. */
export function activeSource(s: Pick<KeysState, 'builtin' | 'byokKey'>): 'byok' | 'builtin' | 'none' {
  if (s.byokKey) return 'byok';
  return s.builtin === 'available' || s.builtin === 'unknown' ? 'builtin' : 'none';
}
