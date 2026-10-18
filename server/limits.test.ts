import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { checkLimits, memoryStore, visitorId } from './limits';

test('memoryStore counts up and forgets a key after its TTL', async () => {
  let clock = 0;
  const store = memoryStore(() => clock);
  expect(await store.incr('a', 10)).toBe(1);
  expect(await store.incr('a', 10)).toBe(2);
  expect(await store.incr('b', 10)).toBe(1);
  clock = 10_001;
  expect(await store.incr('a', 10)).toBe(1);
});

test('each visitor gets a daily cap that resets at the next UTC day', async () => {
  const store = memoryStore();
  const cfg = { visitorDailyRequests: 2, globalDailyAnswers: 100, globalDailyEmbeds: 100 };
  const late = new Date('2026-10-17T23:59:00Z');
  const nextDay = new Date('2026-10-18T00:01:00Z');
  expect(await checkLimits(store, 'v1', 'embed', cfg, late)).toBeNull();
  expect(await checkLimits(store, 'v1', 'answer', cfg, late)).toBeNull();
  expect(await checkLimits(store, 'v1', 'answer', cfg, late)).toBe('visitor_cap');
  expect(await checkLimits(store, 'v2', 'answer', cfg, late)).toBeNull();
  expect(await checkLimits(store, 'v1', 'answer', cfg, nextDay)).toBeNull();
});

test('the global daily budget is counted per kind across visitors', async () => {
  const store = memoryStore();
  const cfg = { visitorDailyRequests: 50, globalDailyAnswers: 1, globalDailyEmbeds: 100 };
  const now = new Date('2026-10-17T12:00:00Z');
  expect(await checkLimits(store, 'a', 'answer', cfg, now)).toBeNull();
  expect(await checkLimits(store, 'b', 'answer', cfg, now)).toBe('global_budget');
  expect(await checkLimits(store, 'b', 'embed', cfg, now)).toBeNull();
});

test('visitorId is a salted, per-day, 16-hex-character hash of the IP', async () => {
  const id = await visitorId('203.0.113.7', 'salt', '2026-10-17');
  expect(id).toBe(createHash('sha256').update('salt|203.0.113.7|2026-10-17').digest('hex').slice(0, 16));
  expect(await visitorId('203.0.113.7', 'salt', '2026-10-18')).not.toBe(id);
});
