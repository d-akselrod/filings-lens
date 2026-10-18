import { expect, test } from 'vitest';
import { documentText, embedBatch, GeminiError, generateText, queryText } from './gemini';

type Call = { url: string; init: RequestInit };

function fakeFetch(...responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const quotaBody = {
  error: {
    code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/embed_content_free_tier_requests' }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '41s' },
    ],
  },
};

test('embedBatch posts one batch request and returns vectors in order', async () => {
  const f = fakeFetch(json({ embeddings: [{ values: Array(768).fill(0.1) }, { values: Array(768).fill(0.2) }] }));
  const out = await embedBatch('k', ['a', 'b'], { fetch: f.fn });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents');
  expect(f.calls[0]!.init.method).toBe('POST');
  expect(new Headers(f.calls[0]!.init.headers).get('x-goog-api-key')).toBe('k');
  expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({
    requests: ['a', 'b'].map(text => ({ model: 'models/gemini-embedding-2', content: { parts: [{ text }] }, outputDimensionality: 768 })),
  });
  expect(out.map(v => [v.constructor.name, v.length])).toEqual([['Float32Array', 768], ['Float32Array', 768]]);
  expect(out[0]![0]).toBeCloseTo(0.1, 6);
  expect(out[1]![767]).toBeCloseTo(0.2, 6);
});

test('embedBatch rejects more than 100 texts before calling the API', async () => {
  const f = fakeFetch();
  await expect(embedBatch('k', Array(101).fill('x'), { fetch: f.fn })).rejects.toBeInstanceOf(RangeError);
  expect(f.calls).toHaveLength(0);
});

test('embedBatch of no texts makes no request', async () => {
  const f = fakeFetch();
  expect(await embedBatch('k', [], { fetch: f.fn })).toEqual([]);
  expect(f.calls).toHaveLength(0);
});

test('maps HTTP errors to GeminiError reasons', async () => {
  const reasonOf = async (res: Response | Error) => {
    try {
      await embedBatch('k', ['a'], { fetch: fakeFetch(res).fn });
    } catch (e) {
      return e;
    }
    throw new Error('expected a rejection');
  };
  expect(await reasonOf(json(quotaBody, 429))).toMatchObject({ reason: 'quota', status: 429, retryAfterMs: 41000, quotaId: undefined });
  const daily = { error: { ...quotaBody.error, details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/embed_content_free_tier_requests',
      quotaId: 'EmbedContentRequestsPerDayPerUserPerProjectPerModel-FreeTier', quotaValue: '1000' }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '81478s' },
  ] } };
  expect(await reasonOf(json(daily, 429))).toMatchObject({ reason: 'quota', retryAfterMs: 81478000, quotaId: 'EmbedContentRequestsPerDayPerUserPerProjectPerModel-FreeTier' });
  expect(await reasonOf(json({ error: { code: 403, message: 'Your API key was reported as leaked.', status: 'PERMISSION_DENIED' } }, 403)))
    .toMatchObject({ reason: 'auth', status: 403, message: 'Your API key was reported as leaked.' });
  expect(await reasonOf(json({ error: { code: 400, message: 'bad', status: 'INVALID_ARGUMENT' } }, 400))).toMatchObject({ reason: 'bad_request' });
  expect(await reasonOf(new Response('<html>Bad gateway</html>', { status: 502 }))).toMatchObject({ reason: 'server', status: 502 });
  const network = await reasonOf(new TypeError('fetch failed'));
  expect(network).toBeInstanceOf(GeminiError);
  expect(network).toMatchObject({ reason: 'network', status: 0 });
});

test('generateText sends the system instruction and drops thought parts', async () => {
  const f = fakeFetch(json({
    candidates: [{
      content: { role: 'model', parts: [{ text: 'Let me think about the passages.', thought: true }, { text: 'Revenue was $10.2 billion ' }, { text: '[1].' }] },
      finishReason: 'STOP', index: 0,
    }],
    usageMetadata: { promptTokenCount: 51, candidatesTokenCount: 13, thoughtsTokenCount: 141, totalTokenCount: 205 },
    modelVersion: 'gemma-4-26b-a4b-it',
  }));
  const text = await generateText('k', { model: 'gemma-4-26b-a4b-it', system: 'SYS', user: 'USER' }, { fetch: f.fn });
  expect(text).toBe('Revenue was $10.2 billion [1].');
  expect(f.calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent');
  expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({
    systemInstruction: { parts: [{ text: 'SYS' }] },
    contents: [{ role: 'user', parts: [{ text: 'USER' }] }],
  });
});

test('generateText sends a thinking level as generationConfig.thinkingConfig', async () => {
  const f = fakeFetch(json({ candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] } }] }));
  await generateText('k', { model: 'gemma-4-26b-a4b-it', system: 'SYS', user: 'USER', thinkingLevel: 'minimal' }, { fetch: f.fn });
  expect(JSON.parse(String(f.calls[0]!.init.body)).generationConfig).toEqual({ thinkingConfig: { thinkingLevel: 'minimal' } });
});

test('task prefixes for gemini-embedding-2', () => {
  expect(queryText('x')).toBe('task: search result | query: x');
  expect(documentText('T', 'b')).toBe('title: T | text: b');
});
