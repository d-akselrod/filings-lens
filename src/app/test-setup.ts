import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { mockMatchMedia } from './test-utils';

if (typeof window !== 'undefined') {
  mockMatchMedia(() => false);
  // Without vitest globals, Testing Library cannot register its own cleanup.
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());
}
