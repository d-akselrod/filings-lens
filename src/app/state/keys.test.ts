// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { activeSource, useKeys } from './keys';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useKeys.getState().clearByok();
  useKeys.getState().markBuiltin('unknown');
});

test('your own key wins; otherwise the built-in key unless it is known to be unusable', () => {
  expect(activeSource({ builtin: 'available', byokKey: 'k' })).toBe('byok');
  expect(activeSource({ builtin: 'restricted', byokKey: 'k' })).toBe('byok');
  expect(activeSource({ builtin: 'available', byokKey: null })).toBe('builtin');
  expect(activeSource({ builtin: 'unknown', byokKey: null })).toBe('builtin');
  for (const builtin of ['restricted', 'exhausted', 'missing'] as const) expect(activeSource({ builtin, byokKey: null })).toBe('none');
});

test('without remember, the key is written only to sessionStorage', () => {
  useKeys.getState().setByok('key-1', false);
  expect(sessionStorage.getItem('fl-byok')).toBe('key-1');
  expect(localStorage.getItem('fl-byok')).toBeNull();
  expect(useKeys.getState()).toMatchObject({ byokKey: 'key-1', remember: false });
});

test('with remember, the key is written only to localStorage, replacing a session copy', () => {
  useKeys.getState().setByok('key-1', false);
  useKeys.getState().setByok('key-2', true);
  expect(localStorage.getItem('fl-byok')).toBe('key-2');
  expect(sessionStorage.getItem('fl-byok')).toBeNull();
  expect(useKeys.getState()).toMatchObject({ byokKey: 'key-2', remember: true });
});

test('clearByok removes the key from both storages and from memory', () => {
  useKeys.getState().setByok('key-1', true);
  sessionStorage.setItem('fl-byok', 'stale');
  useKeys.getState().clearByok();
  expect(localStorage.getItem('fl-byok')).toBeNull();
  expect(sessionStorage.getItem('fl-byok')).toBeNull();
  expect(useKeys.getState().byokKey).toBeNull();
});

test('when storage is blocked, the key is still kept in memory', () => {
  const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
  try {
    useKeys.getState().setByok('key-3', true);
    expect(useKeys.getState()).toMatchObject({ byokKey: 'key-3', remember: true });
  } finally {
    blocked.mockRestore();
  }
});

test('a key remembered on this device is restored when the app loads', async () => {
  localStorage.setItem('fl-byok', 'saved-key');
  vi.resetModules();
  const fresh = await import('./keys');
  expect(fresh.useKeys.getState()).toMatchObject({ byokKey: 'saved-key', remember: true, builtin: 'unknown' });
});

test('markBuiltin records the built-in key status', () => {
  useKeys.getState().markBuiltin('restricted');
  expect(useKeys.getState().builtin).toBe('restricted');
});
