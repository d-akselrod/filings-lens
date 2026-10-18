import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { EdgarClient, fiscalYearOf, latest10Ks, type SubmissionsJson } from './edgar';

const fixture = async (): Promise<SubmissionsJson> =>
  JSON.parse(await readFile(new URL('./fixtures/submissions-nvda.json', import.meta.url), 'utf8')) as SubmissionsJson;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'edgar-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('latest10Ks keeps only form 10-K, newest first', async () => {
  const refs = latest10Ks(await fixture(), 'NVDA', 3);
  expect(refs.map(r => r.accession)).toEqual(['0001045810-25-000023', '0001045810-24-000029', '0001045810-23-000017']);
  expect(refs[0]).toEqual({
    ticker: 'NVDA', cik: '0001045810', accession: '0001045810-25-000023', filedAt: '2025-02-26', periodEnd: '2025-01-26',
    fiscalYear: 2025, primaryDocument: 'nvda-20250126.htm',
    url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581025000023/nvda-20250126.htm',
  });
});

test('latest10Ks sorts by filing date even when EDGAR order is shuffled', async () => {
  const sub = await fixture();
  const recent = sub.filings.recent;
  for (const key of Object.keys(recent) as Array<keyof typeof recent>) (recent[key] as unknown[]).reverse();
  expect(latest10Ks(sub, 'NVDA', 2).map(r => r.fiscalYear)).toEqual([2025, 2024]);
});

test('fiscal year is the calendar year of the period end', () => {
  expect(fiscalYearOf('2025-01-26')).toBe(2025);
  expect(fiscalYearOf('2024-09-28')).toBe(2024);
});

function recordingFetch(body: (url: string) => string, status = 200) {
  const calls: Array<{ url: string; headers: Headers; at: number }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), at: performance.now() });
    return new Response(body(String(url)), { status });
  }) as typeof fetch;
  return { fn, calls };
}

test('client sends the User-Agent and serves repeats from the disk cache', async () => {
  const f = recordingFetch(() => JSON.stringify({ cik: '1045810', name: 'NVIDIA CORP', filings: { recent: {} } }));
  const client = new EdgarClient({ userAgent: 'Jane Doe jane@example.com', cacheDir: dir, minIntervalMs: 0, fetch: f.fn });
  const first = await client.submissions('0001045810');
  const second = await client.submissions('0001045810');
  expect(first.name).toBe('NVIDIA CORP');
  expect(second).toEqual(first);
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.url).toBe('https://data.sec.gov/submissions/CIK0001045810.json');
  expect(f.calls[0]!.headers.get('user-agent')).toBe('Jane Doe jane@example.com');
});

test('client caches filing documents by accession', async () => {
  const f = recordingFetch(() => '<html>10-K</html>');
  const client = new EdgarClient({ userAgent: 'Jane Doe jane@example.com', cacheDir: dir, minIntervalMs: 0, fetch: f.fn });
  const [ref] = latest10Ks(await fixture(), 'NVDA', 1);
  expect(await client.document(ref!)).toBe('<html>10-K</html>');
  expect(await readFile(join(dir, '0001045810-25-000023.htm'), 'utf8')).toBe('<html>10-K</html>');
  await client.document(ref!);
  expect(f.calls.map(c => c.url)).toEqual([ref!.url]);
});

test('uncached requests are spaced at least minIntervalMs apart, even when concurrent', async () => {
  const f = recordingFetch(url => JSON.stringify({ cik: url, name: 'X', filings: { recent: {} } }));
  const client = new EdgarClient({ userAgent: 'Jane Doe jane@example.com', cacheDir: dir, minIntervalMs: 50, fetch: f.fn });
  await Promise.all([client.submissions('0000000001'), client.submissions('0000000002'), client.submissions('0000000003')]);
  const starts = f.calls.map(c => c.at).sort((a, b) => a - b);
  expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(45);
  expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(45);
});

test('client refuses a User-Agent without a contact email and surfaces HTTP errors', async () => {
  expect(() => new EdgarClient({ userAgent: 'Filings Lens', cacheDir: dir })).toThrow(/email/i);
  const f = recordingFetch(() => 'Request Rate Threshold Exceeded', 403);
  const client = new EdgarClient({ userAgent: 'Jane Doe jane@example.com', cacheDir: dir, minIntervalMs: 0, fetch: f.fn });
  await expect(client.submissions('0001045810')).rejects.toThrow(/403/);
});
