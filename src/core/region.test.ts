import { expect, test } from 'vitest';
import { isRestrictedCountry } from './region';

test.each(['DE', 'GB', 'CH', 'NO', 'GP', 'FR', 'IS', 'LI', 'IE', 'GR', 'JE'])('%s is restricted', code =>
  expect(isRestrictedCountry(code)).toBe(true));

test.each(['US', 'CA', 'JP', 'IN', 'BR', 'AU'])('%s is not restricted', code =>
  expect(isRestrictedCountry(code)).toBe(false));

test('missing or unknown countries fail closed', () => {
  for (const code of [null, undefined, '', 'XX', 'U', 'USA', '12']) expect(isRestrictedCountry(code)).toBe(true);
});

test('codes are case-insensitive', () => {
  expect(isRestrictedCountry('de')).toBe(true);
  expect(isRestrictedCountry('us')).toBe(false);
});
