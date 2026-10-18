import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useMediaQuery } from './lib/media';

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'fl-theme';
const EVENT = 'fl-theme-change';
const NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const isPref = (v: unknown): v is ThemePref => v === 'system' || v === 'light' || v === 'dark';

let memoryPref: ThemePref = 'system'; // only used when storage is unavailable (private mode)

function readPref(): ThemePref {
  try {
    const stored = localStorage.getItem(KEY);
    return isPref(stored) ? stored : 'system';
  } catch {
    return memoryPref;
  }
}

function writePref(pref: ThemePref): void {
  memoryPref = pref;
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // storage blocked: keep it in memory for this page
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Theme preference shared by every component (and tab); applies data-theme to <html>. */
export function useTheme(): { pref: ThemePref; resolved: 'light' | 'dark'; cycle(): void } {
  const pref = useSyncExternalStore(subscribe, readPref, () => 'system' as ThemePref);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const resolved = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  const cycle = useCallback(() => writePref(NEXT[readPref()]), []);
  return { pref, resolved, cycle };
}
