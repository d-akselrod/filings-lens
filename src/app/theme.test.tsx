// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { mockMatchMedia } from './test-utils';
import { useTheme } from './theme';

const DARK = '(prefers-color-scheme: dark)';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

test('follows the system preference by default', () => {
  mockMatchMedia(q => q === DARK);
  const { result } = renderHook(() => useTheme());
  expect(result.current).toMatchObject({ pref: 'system', resolved: 'dark' });
  expect(document.documentElement.dataset.theme).toBe('dark');
});

test('cycle goes light, dark, system and remembers the choice', () => {
  mockMatchMedia(() => false);
  const { result } = renderHook(() => useTheme());
  act(() => result.current.cycle());
  expect([result.current.pref, localStorage.getItem('fl-theme'), document.documentElement.dataset.theme]).toEqual(['light', 'light', 'light']);
  act(() => result.current.cycle());
  expect([result.current.pref, localStorage.getItem('fl-theme'), document.documentElement.dataset.theme]).toEqual(['dark', 'dark', 'dark']);
  act(() => result.current.cycle());
  expect([result.current.pref, localStorage.getItem('fl-theme'), document.documentElement.dataset.theme]).toEqual(['system', 'system', 'light']);
});

test('a stored preference wins over the system setting', () => {
  localStorage.setItem('fl-theme', 'dark');
  mockMatchMedia(() => false);
  expect(renderHook(() => useTheme()).result.current.resolved).toBe('dark');
});

test('tracks live system changes while following the system', () => {
  const setSystem = mockMatchMedia(() => false);
  const { result } = renderHook(() => useTheme());
  expect(result.current.resolved).toBe('light');
  act(() => setSystem(q => q === DARK));
  expect(result.current.resolved).toBe('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
});

test('two components share one preference', () => {
  mockMatchMedia(() => false);
  const a = renderHook(() => useTheme());
  const b = renderHook(() => useTheme());
  act(() => a.result.current.cycle());
  expect(b.result.current.pref).toBe('light');
});
