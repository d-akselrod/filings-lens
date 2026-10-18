import { expect, test } from 'vitest';
import { documentText, EMBED_BATCH_MAX, embedBatch, queryText, sliceNormalize } from './embeddings';
import { isDailyQuota, UpstreamError } from './upstream';

function fakeFetch(...responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
/** A deterministic, not-yet-normalized 2048-d vector, like the model's raw output before slicing. */
const raw = (seed: number) => Array.from({ length: 2048 }, (_, i) => Math.sin(seed * 7 + i) + 0.1);
const norm = (v: ArrayLike<number>) => Math.sqrt(Array.from(v).reduce((s, x) => s + x * x, 0));

test('embedBatch sends one OpenAI-style request to OpenRouter and returns 768-d unit vectors in input order', async () => {
  const f = fakeFetch(json({ object: 'list', model: 'nvidia/nemotron-3-embed-1b', data: [
    { object: 'embedding', index: 1, embedding: raw(2) }, { object: 'embedding', index: 0, embedding: raw(1) },
  ] }));
  const out = await embedBatch('or-key', ['query: a', 'passage: b'], { fetch: f.fn });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.url).toBe('https://openrouter.ai/api/v1/embeddings');
  expect(f.calls[0]!.init.method).toBe('POST');
  expect(new Headers(f.calls[0]!.init.headers).get('authorization')).toBe('Bearer or-key');
  expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ model: 'nvidia/nemotron-3-embed-1b:free', input: ['query: a', 'passage: b'] });
  expect(out.map(v => [v.constructor.name, v.length])).toEqual([['Float32Array', 768], ['Float32Array', 768]]);
  expect(norm(out[0]!)).toBeCloseTo(1, 5);
  expect(out[0]![5]! / out[0]![9]!).toBeCloseTo(raw(1)[5]! / raw(1)[9]!, 4);
  expect(out[1]![5]! / out[1]![9]!).toBeCloseTo(raw(2)[5]! / raw(2)[9]!, 4);
});

test('sliceNormalize keeps the leading dimensions, rescaled to unit length', () => {
  const v = sliceNormalize([3, 4, 12, 99], 2);
  expect(Array.from(v)).toEqual([expect.closeTo(0.6, 6), expect.closeTo(0.8, 6)]);
});

test('queries and passages carry the retrieval prefixes from the model card', () => {
  expect(queryText('How does NVIDIA describe export controls?')).toBe('query: How does NVIDIA describe export controls?');
  expect(documentText('NVIDIA 10-K FY2025 — Item 1A Risk Factors', 'Export controls restrict sales.'))
    .toBe('passage: NVIDIA 10-K FY2025 — Item 1A Risk Factors\nExport controls restrict sales.');
});

test('oversized batches are refused before any request, and an empty batch makes none', async () => {
  const f = fakeFetch();
  await expect(embedBatch('k', Array(EMBED_BATCH_MAX + 1).fill('x'), { fetch: f.fn })).rejects.toBeInstanceOf(RangeError);
  expect(await embedBatch('k', [], { fetch: f.fn })).toEqual([]);
  expect(f.calls).toHaveLength(0);
});

async function failure(response: Response | Error): Promise<UpstreamError> {
  try {
    await embedBatch('k', ['a'], { fetch: fakeFetch(response).fn });
  } catch (e) {
    expect(e).toBeInstanceOf(UpstreamError);
    return e as UpstreamError;
  }
  throw new Error('expected a rejection');
}

test('OpenRouter errors map to upstream reasons, telling the daily free cap from the per-minute one', async () => {
  const daily = await failure(json({ error: { code: 429, message: 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day' } },
    429, { 'X-RateLimit-Reset': String(Date.now() + 6 * 3_600_000) }));
  expect(daily).toMatchObject({ status: 429, reason: 'quota', quotaId: 'free-models-per-day' });
  expect(isDailyQuota(daily)).toBe(true);

  const minute = await failure(json({ error: { code: 429, message: 'Rate limit exceeded: free-models-per-min.' } },
    429, { 'X-RateLimit-Reset': String(Date.now() + 20_000) }));
  expect(minute).toMatchObject({ reason: 'quota', quotaId: 'free-models-per-min' });
  expect(minute.retryAfterMs).toBeGreaterThan(15_000);
  expect(minute.retryAfterMs).toBeLessThanOrEqual(20_000);
  expect(isDailyQuota(minute)).toBe(false);

  expect(await failure(json({ error: { code: 401, message: 'No auth credentials found' } }, 401))).toMatchObject({ reason: 'auth', message: 'No auth credentials found' });
  expect(await failure(json({ error: { code: 502, message: 'Provider returned error' } }, 502))).toMatchObject({ reason: 'server' });
  expect(await failure(new TypeError('fetch failed'))).toMatchObject({ reason: 'network', status: 0 });
});

test('an error inside a 200 response, or a vector count that does not match, is still an error', async () => {
  expect(await failure(json({ error: { code: 429, message: 'Rate limit exceeded: free-models-per-day' } }))).toMatchObject({ reason: 'quota', quotaId: 'free-models-per-day' });
  expect(await failure(json({ data: [] }))).toMatchObject({ reason: 'server' });
});
