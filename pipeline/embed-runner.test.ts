import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { GeminiError } from '../src/core/gemini';
import { embedWithCache, QuotaExhaustedError } from './embed-runner';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'embed-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, text: `chunk text number ${i}` }));
const vectorFor = (text: string) => new Float32Array(768).fill(text.length);
const quota = () => new GeminiError(429, 'quota', 'Resource has been exhausted', 41000);

function fakeEmbed(script: Array<'ok' | GeminiError> = []) {
  const batches: string[][] = [];
  const embed = async (_key: string, texts: string[]) => {
    const step = script.shift() ?? 'ok';
    if (step !== 'ok') throw step;
    batches.push(texts);
    return texts.map(vectorFor);
  };
  return { embed, batches };
}

function fakeSleep() {
  const sleeps: number[] = [];
  return { sleep: async (ms: number) => { sleeps.push(ms); }, sleeps };
}

test('returns vectors keyed by item and serves a rerun entirely from the cache', async () => {
  const first = fakeEmbed();
  const out = await embedWithCache(items(3), { apiKey: 'k', cacheDir: dir, embed: first.embed, sleep: fakeSleep().sleep });
  expect([...out.keys()]).toEqual(['k0', 'k1', 'k2']);
  expect(out.get('k2')![0]).toBe('chunk text number 2'.length);
  const second = await embedWithCache(items(3), {
    apiKey: 'k', cacheDir: dir, sleep: fakeSleep().sleep,
    embed: async () => { throw new Error('embed must not be called'); },
  });
  expect(Array.from(second.get('k1')!)).toEqual(Array.from(out.get('k1')!));
});

test('batches only uncached texts and embeds duplicate texts once', async () => {
  const f = fakeEmbed();
  const list = [...items(250), { key: 'dup', text: 'chunk text number 0' }];
  const out = await embedWithCache(list, { apiKey: 'k', cacheDir: dir, batchSize: 100, embed: f.embed, sleep: fakeSleep().sleep });
  expect(f.batches.map(b => b.length)).toEqual([100, 100, 50]);
  expect(out.get('dup')![0]).toBe('chunk text number 0'.length);
  expect(out.size).toBe(251);
});

test('backs off on consecutive quota errors, doubling the server-suggested delay', async () => {
  const f = fakeEmbed([quota(), quota(), 'ok']);
  const s = fakeSleep();
  await embedWithCache(items(5), { apiKey: 'k', cacheDir: dir, embed: f.embed, sleep: s.sleep });
  expect(s.sleeps).toEqual([41000, 82000]);
});

test('stops after six consecutive quota errors, keeps finished batches, and resumes on rerun', async () => {
  const f = fakeEmbed(['ok', quota(), quota(), quota(), quota(), quota(), quota()]);
  await expect(embedWithCache(items(250), { apiKey: 'k', cacheDir: dir, batchSize: 100, embed: f.embed, sleep: fakeSleep().sleep }))
    .rejects.toBeInstanceOf(QuotaExhaustedError);
  expect((await readdir(dir)).filter(name => name.endsWith('.f32'))).toHaveLength(100);
  const healthy = fakeEmbed();
  const out = await embedWithCache(items(250), { apiKey: 'k', cacheDir: dir, batchSize: 100, embed: healthy.embed, sleep: fakeSleep().sleep });
  expect(healthy.batches.map(b => b.length)).toEqual([100, 50]);
  expect(out.size).toBe(250);
});

test('retries server and network errors three times after 5, 10 and 20 seconds', async () => {
  const server = () => new GeminiError(503, 'server', 'unavailable');
  const recovering = fakeEmbed([server(), new GeminiError(0, 'network', 'fetch failed'), 'ok']);
  const s = fakeSleep();
  await embedWithCache(items(2), { apiKey: 'k', cacheDir: dir, embed: recovering.embed, sleep: s.sleep });
  expect(s.sleeps).toEqual([5000, 10000]);
  const failing = fakeEmbed([server(), server(), server(), server()]);
  const s2 = fakeSleep();
  await expect(embedWithCache(items(2), { apiKey: 'k', cacheDir: join(dir, 'other'), embed: failing.embed, sleep: s2.sleep }))
    .rejects.toMatchObject({ reason: 'server' });
  expect(s2.sleeps).toEqual([5000, 10000, 20000]);
});

test('auth errors are not retried', async () => {
  const f = fakeEmbed([new GeminiError(403, 'auth', 'Your API key was reported as leaked.')]);
  const s = fakeSleep();
  await expect(embedWithCache(items(1), { apiKey: 'k', cacheDir: dir, embed: f.embed, sleep: s.sleep })).rejects.toMatchObject({ reason: 'auth' });
  expect(s.sleeps).toEqual([]);
});

test('reports every retry with its reason, wait and message', async () => {
  const f = fakeEmbed([quota(), new GeminiError(503, 'server', 'unavailable'), 'ok']);
  const retries: Array<[string, number, string]> = [];
  await embedWithCache(items(1), {
    apiKey: 'k', cacheDir: dir, embed: f.embed, sleep: fakeSleep().sleep,
    onRetry: (reason, waitMs, message) => retries.push([reason, waitMs, message]),
  });
  expect(retries).toEqual([['quota', 41000, 'Resource has been exhausted'], ['server', 5000, 'unavailable']]);
});

test('paces batch starts at least paceMs apart', async () => {
  let clock = 0;
  const sleeps: number[] = [];
  const f = fakeEmbed();
  await embedWithCache(items(75), {
    apiKey: 'k', cacheDir: dir, batchSize: 25, embed: f.embed, paceMs: 16000, now: () => clock,
    sleep: async ms => { sleeps.push(ms); clock += ms; },
  });
  expect(f.batches.map(b => b.length)).toEqual([25, 25, 25]);
  expect(sleeps).toEqual([16000, 16000]);
});
