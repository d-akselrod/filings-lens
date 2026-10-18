import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { mockMatchMedia } from './test-utils';

if (typeof window !== 'undefined') {
  mockMatchMedia(() => false);
  // jsdom has no ResizeObserver; Radix measures sliders, switches and popovers with it.
  window.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  // Nor these, which Radix Select and cmdk call while opening and moving the selection.
  Element.prototype.scrollIntoView ??= function () {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= function () {};
  Element.prototype.releasePointerCapture ??= function () {};
  // Without vitest globals, Testing Library cannot register its own cleanup.
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());
}
