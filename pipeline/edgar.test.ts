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
    const at = performance.now(); // before any other work, so cold-start costs don't skew the spacing measurement
    calls.push({ url: String(url), headers: new Headers(init?.headers), at });
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

test('latestTenKs pages into older submission files only when recent filings are not enough', async () => {
  const columns = (rows: Array<[acc: string, date: string, report: string, form: string, doc: string]>) => ({
    accessionNumber: rows.map(r => r[0]), filingDate: rows.map(r => r[1]), reportDate: rows.map(r => r[2]),
    form: rows.map(r => r[3]), primaryDocument: rows.map(r => r[4]),
  });
  const recent = columns([
    ['0001326801-26-000010', '2026-01-29', '2025-12-31', '10-K', 'meta-20251231.htm'],
    ['0001326801-26-000500', '2026-04-30', '2026-03-31', '4', 'xslF345X05/wk-form4.xml'],
    ['0001326801-25-000017', '2025-01-30', '2024-12-31', '10-K', 'meta-20241231.htm'],
  ]);
  const page = columns([['0001326801-24-000012', '2024-02-02', '2023-12-31', '10-K', 'meta-20231231.htm']]);
  const sub = { cik: '1326801', name: 'Meta Platforms, Inc.', filings: { recent, files: [{ name: 'CIK0001326801-submissions-001.json' }] } };
  const f = recordingFetch(url => JSON.stringify(url.endsWith('submissions-001.json') ? page : sub));
  const client = new EdgarClient({ userAgent: 'Jane Doe jane@example.com', cacheDir: dir, minIntervalMs: 0, fetch: f.fn });
  const three = await client.latestTenKs('0001326801', 'META', 3);
  expect(three.map(r => r.fiscalYear)).toEqual([2025, 2024, 2023]);
  expect(three[2]!.url).toBe('https://www.sec.gov/Archives/edgar/data/1326801/000132680124000012/meta-20231231.htm');
  expect(f.calls.map(c => c.url)).toEqual([
    'https://data.sec.gov/submissions/CIK0001326801.json',
    'https://data.sec.gov/submissions/CIK0001326801-submissions-001.json',
  ]);
  const two = await new EdgarClient({ userAgent: 'Jane Doe jane@example.com', cacheDir: dir, minIntervalMs: 0, fetch: f.fn })
    .latestTenKs('0001326801', 'META', 2);
  expect(two).toHaveLength(2);
  expect(f.calls).toHaveLength(2);
});

test('client refuses a User-Agent without a contact email and surfaces HTTP errors', async () => {
  expect(() => new EdgarClient({ userAgent: 'Filings Lens', cacheDir: dir })).toThrow(/email/i);
  const f = recordingFetch(() => 'Request Rate Threshold Exceeded', 403);
  const client = new EdgarClient({ userAgent: 'Jane Doe jane@example.com', cacheDir: dir, minIntervalMs: 0, fetch: f.fn });
  await expect(client.submissions('0001045810')).rejects.toThrow(/403/);
});
