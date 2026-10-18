import { expect, test } from 'vitest';
import config from '../../vite.config';

test('dev and preview servers are cross-origin isolated, so the reranker gets WASM threads', () => {
  const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
  expect(config.server?.headers).toMatchObject(isolation);
  expect(config.preview?.headers).toMatchObject(isolation);
});
