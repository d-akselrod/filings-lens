import { beforeEach, expect, test } from 'vitest';
import { useUi } from './ui';

beforeEach(() => useUi.setState({ highlighted: null, highlightNonce: 0, evidenceTab: 'trace', evidenceOpen: false }));

test('citing a source highlights it, shows the Sources tab, opens the drawer and re-scrolls on repeat clicks (review I2)', () => {
  useUi.getState().cite(3);
  expect(useUi.getState()).toMatchObject({ highlighted: 3, evidenceTab: 'sources', evidenceOpen: true, highlightNonce: 1 });
  useUi.getState().cite(3);
  expect(useUi.getState().highlightNonce).toBe(2);
});
