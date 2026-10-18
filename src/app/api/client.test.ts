import { expect, test } from 'vitest';
import { buildUserPrompt, SYSTEM_INSTRUCTION, type PromptPassage } from '../../core/prompt';
import { encodeVectorB64 } from '../../core/scorecard';
import { builtinStatusFor, ClientError, embedQuestion, fetchStatus, streamAnswer, type ClientErrorCode, type KeySource } from './client';

function fakeFetch(...responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sse = (...events: unknown[]) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), {
  headers: { 'content-type': 'text/event-stream' },
});
const passages: PromptPassage[] = [
  { n: 1, ticker: 'NVDA', fiscalYear: 2025, item: '1A', itemTitle: 'Risk Factors', text: 'Export controls restrict sales to China.' },
];
const builtin: KeySource = { kind: 'builtin' };
const byok: KeySource = { kind: 'byok', key: 'my-own-key' };

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const t of gen) out.push(t);
  return out;
}

async function failure(p: Promise<unknown>): Promise<ClientError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ClientError);
    return e as ClientError;
  }
  throw new Error('expected a rejection');
}

test('fetchStatus reads /api/status', async () => {
  const f = fakeFetch(json({ region: 'ok', builtInKey: 'available' }));
  expect(await fetchStatus(f.fn)).toEqual({ region: 'ok', builtInKey: 'available' });
  expect(f.calls[0]!.url).toBe('/api/status');
});

test('questions are always embedded by /api/embed: the corpus vectors come from a model a Gemini key cannot call', async () => {
  const f = fakeFetch(json({ vector: encodeVectorB64(new Float32Array(768).fill(0.5)) }));
  const v = await embedQuestion('export controls', f.fn);
  expect(f.calls[0]).toMatchObject({ url: '/api/embed', init: { method: 'POST' } });
  expect(JSON.parse(String(f.calls[0]!.init!.body))).toEqual({ text: 'export controls' });
  expect(v).toHaveLength(768);
  expect(v[0]).toBe(0.5);
});

test('a built-in 403 restricted_region becomes ClientError restricted_region', async () => {
  const f = fakeFetch(json({ error: { code: 'restricted_region', message: "The built-in key isn't available in your region" } }, 403));
  expect(await failure(embedQuestion('q', f.fn))).toMatchObject({ code: 'restricted_region' });
});

test('a dropped connection or a non-JSON error page still becomes a ClientError', async () => {
  expect(await failure(embedQuestion('q', fakeFetch(new TypeError('Failed to fetch')).fn))).toMatchObject({ code: 'network' });
  expect(await failure(embedQuestion('q', fakeFetch(new Response('<html>Bad gateway</html>', { status: 502 })).fn)))
    .toMatchObject({ code: 'upstream_error' });
});

test('built-in answers post the chunk ids and yield deltas until done', async () => {
  const f = fakeFetch(sse({ type: 'delta', text: 'Sales are restricted ' }, { type: 'delta', text: '[1].' }, { type: 'done' }));
  const parts = await collect(streamAnswer({ question: 'q', chunkIds: [4], passages, model: 'fast', previousQuestion: 'p', corpus: 'v/corpus.1a2b3c4d.json', src: builtin }, f.fn));
  expect(parts).toEqual(['Sales are restricted ', '[1].']);
  expect(f.calls[0]!.url).toBe('/api/answer');
  expect(JSON.parse(String(f.calls[0]!.init!.body))).toEqual({ question: 'q', chunkIds: [4], model: 'fast', previousQuestion: 'p', corpus: 'v/corpus.1a2b3c4d.json' });
});

test('an error event after a delta yields the delta, then throws its code', async () => {
  const f = fakeFetch(sse({ type: 'delta', text: 'Partial' }, { type: 'error', code: 'upstream_quota' }));
  const parts: string[] = [];
  const err = await failure((async () => {
    for await (const t of streamAnswer({ question: 'q', chunkIds: [4], passages, model: 'fast', corpus: 'v/c.json', src: builtin }, f.fn)) parts.push(t);
  })());
  expect(parts).toEqual(['Partial']);
  expect(err.code).toBe('upstream_quota');
});

test('a built-in stream that ends without done counts as a network interruption', async () => {
  const f = fakeFetch(sse({ type: 'delta', text: 'Partial' }));
  expect(await failure(collect(streamAnswer({ question: 'q', chunkIds: [4], passages, model: 'fast', corpus: 'v/c.json', src: builtin }, f.fn))))
    .toMatchObject({ code: 'network' });
});

test('a built-in answer refused before streaming throws the API error code', async () => {
  const f = fakeFetch(json({ error: { code: 'visitor_cap', message: 'Daily question limit reached for this visitor' } }, 429));
  expect(await failure(collect(streamAnswer({ question: 'q', chunkIds: [4], passages, model: 'fast', corpus: 'v/c.json', src: builtin }, f.fn))))
    .toMatchObject({ code: 'visitor_cap' });
});

test('your own key answers directly with Google, sending the shared prompt with minimal thinking', async () => {
  const f = fakeFetch(sse({ candidates: [{ content: { role: 'model', parts: [{ text: 'Sales are restricted [1].' }] } }] }));
  const parts = await collect(streamAnswer({ question: 'q', chunkIds: [4], passages, model: 'fast', corpus: 'v/c.json', src: byok }, f.fn));
  expect(parts).toEqual(['Sales are restricted [1].']);
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:streamGenerateContent?alt=sse');
  expect(new Headers(f.calls[0]!.init?.headers).get('x-goog-api-key')).toBe('my-own-key');
  const body = JSON.parse(String(f.calls[0]!.init!.body));
  expect(body.systemInstruction.parts[0].text).toBe(SYSTEM_INSTRUCTION);
  expect(body.contents[0].parts[0].text).toBe(buildUserPrompt('q', passages));
  expect(body.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: 'minimal' } });
});

test("your own key's Google errors map to byok_invalid, byok_quota, network and upstream_error", async () => {
  const cases: Array<[() => Response | Error, ClientErrorCode]> = [
    [() => json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT',
      details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }] } }, 400), 'byok_invalid'],
    [() => json({ error: { code: 403, message: 'Your API key was reported as leaked.', status: 'PERMISSION_DENIED' } }, 403), 'byok_invalid'],
    [() => json({ error: { code: 429, message: 'Resource has been exhausted', status: 'RESOURCE_EXHAUSTED', details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
    ] } }, 429), 'byok_quota'],
    [() => json({ error: { code: 429, message: 'Resource has been exhausted', status: 'RESOURCE_EXHAUSTED', details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '21s' },
    ] } }, 429), 'upstream_busy'],
    [() => new TypeError('Failed to fetch'), 'network'],
    [() => json({ error: { code: 500, message: 'Internal error' } }, 500), 'upstream_error'],
  ];
  for (const [response, code] of cases) {
    expect(await failure(collect(streamAnswer({ question: 'q', chunkIds: [4], passages, model: 'fast', corpus: 'v/c.json', src: byok }, fakeFetch(response()).fn))))
      .toMatchObject({ code });
  }
});

test('builtinStatusFor maps API error codes onto the built-in key status', () => {
  expect(builtinStatusFor('restricted_region')).toBe('restricted');
  for (const code of ['visitor_cap', 'global_budget', 'upstream_quota'] as const) expect(builtinStatusFor(code)).toBe('exhausted');
  expect(builtinStatusFor('missing_key')).toBe('missing');
  for (const code of ['bad_request', 'method', 'origin', 'upstream_busy', 'upstream_error', 'stale_corpus', 'network', 'byok_invalid', 'byok_quota', 'no_key'] as const) {
    expect(builtinStatusFor(code)).toBeNull();
  }
});
