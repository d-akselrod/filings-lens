import { describe, expect, test, vi } from 'vitest';
import { GeminiError, type StreamRequest } from '../src/core/gemini';
import { decodeVectorB64 } from '../src/core/scorecard';
import type { CorpusLookup } from './corpus';
import type { ServerEnv } from './env';
import { handleAnswer, handleEmbed, handleStatus, type Deps } from './handlers';
import { memoryStore } from './limits';

const PASSAGES: Record<number, ReturnType<CorpusLookup['get']>> = {
  0: { ticker: 'NVDA', fiscalYear: 2025, item: '1A', itemTitle: 'Risk Factors', text: 'Export controls restrict sales to China.' },
  1: { ticker: 'NVDA', fiscalYear: 2024, item: '1A', itemTitle: 'Risk Factors', text: 'New export restrictions may reduce demand.' },
  2: { ticker: 'AAPL', fiscalYear: 2025, item: '7', itemTitle: "Management's Discussion and Analysis", text: 'Services revenue reached a record.' },
};

function makeDeps(env: Partial<ServerEnv> = {}, stream?: Deps['stream']) {
  const embed = vi.fn(async (_key: string, texts: string[]) => texts.map(() => new Float32Array(768).fill(0.25)));
  const streamSpy = vi.fn(stream ?? (async function* () { yield 'Revenue grew [1].'; }));
  const deps: Deps = {
    env: {
      geminiKey: 'server-key', allowedOrigins: [], ipSalt: 'salt', upstash: null,
      limits: { visitorDailyRequests: 50, globalDailyAnswers: 200, globalDailyEmbeds: 800 }, ...env,
    },
    store: memoryStore(),
    corpus: async () => ({ get: id => PASSAGES[id] }),
    now: () => new Date('2026-10-17T12:00:00Z'),
    embed,
    stream: streamSpy as Deps['stream'],
  };
  return { deps, embed, stream: streamSpy };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://filings.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vercel-ip-country': 'US', 'x-real-ip': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const answerBody = { question: 'How does NVIDIA describe export-control risk?', chunkIds: [2, 0], model: 'fast' };
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

describe('input validation (Review Focus #1)', () => {
  test.each([
    ['a 501-character question', { ...answerBody, question: 'x'.repeat(501) }],
    ['a blank question', { ...answerBody, question: '   ' }],
    ['11 chunk ids', { ...answerBody, chunkIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }],
    ['an unknown chunk id', { ...answerBody, chunkIds: [0, 99] }],
    ['duplicate chunk ids', { ...answerBody, chunkIds: [0, 0] }],
    ['an unknown model', { ...answerBody, model: 'pro' }],
    ['a body that is not JSON', '{not json'],
  ])('rejects %s with 400 and never calls Google', async (_name, body) => {
    const { deps, embed, stream } = makeDeps();
    const res = await handleAnswer(post('/api/answer', body), deps);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('bad_request');
    expect(stream).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  test('names the bad field', async () => {
    const res = await handleAnswer(post('/api/answer', { ...answerBody, question: '' }), makeDeps().deps);
    expect((await errorOf(res)).message).toMatch(/question/);
  });

  test('embed rejects a blank or oversized text', async () => {
    const { deps, embed } = makeDeps();
    expect((await handleEmbed(post('/api/embed', { text: ' ' }), deps)).status).toBe(400);
    expect((await handleEmbed(post('/api/embed', { text: 'y'.repeat(501) }), deps)).status).toBe(400);
    expect(embed).not.toHaveBeenCalled();
  });
});

describe('regional rule (Review Focus #2)', () => {
  test.each([['FR'], [undefined]])('country %s gets 403 and never reaches Google', async country => {
    const { deps, embed, stream } = makeDeps();
    const headers = country ? { 'x-vercel-ip-country': country } : { 'x-vercel-ip-country': '' };
    const answer = await handleAnswer(post('/api/answer', answerBody, headers), deps);
    const embedRes = await handleEmbed(post('/api/embed', { text: 'export controls' }, headers), deps);
    expect([answer.status, embedRes.status]).toEqual([403, 403]);
    expect((await errorOf(answer)).code).toBe('restricted_region');
    expect(stream).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  test('status reports region and key availability without calling Google', async () => {
    const { deps, embed, stream } = makeDeps();
    const status = async (country: string, d: Deps = deps) =>
      (await handleStatus(new Request('https://filings.example/api/status', { headers: { 'x-vercel-ip-country': country } }), d)).json();
    expect(await status('DE')).toEqual({ region: 'restricted', builtInKey: 'restricted' });
    expect(await status('US')).toEqual({ region: 'ok', builtInKey: 'available' });
    expect(await status('US', makeDeps({ geminiKey: null }).deps)).toEqual({ region: 'ok', builtInKey: 'missing' });
    expect(embed).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });
});

test('foreign origins get 403 when ALLOWED_ORIGINS is set (Review Focus #5)', async () => {
  const { deps, stream } = makeDeps({ allowedOrigins: ['https://a.app'] });
  const res = await handleAnswer(post('/api/answer', answerBody, { origin: 'https://evil.app' }), deps);
  expect(res.status).toBe(403);
  expect((await errorOf(res)).code).toBe('origin');
  expect(stream).not.toHaveBeenCalled();
  expect((await handleAnswer(post('/api/answer', answerBody, { origin: 'https://a.app' }), deps)).status).toBe(200);
});

test('a missing key gives 503 and the visitor cap gives 429', async () => {
  expect((await handleEmbed(post('/api/embed', { text: 'q' }), makeDeps({ geminiKey: null }).deps)).status).toBe(503);
  const { deps } = makeDeps({ limits: { visitorDailyRequests: 1, globalDailyAnswers: 200, globalDailyEmbeds: 800 } });
  expect((await handleEmbed(post('/api/embed', { text: 'q' }), deps)).status).toBe(200);
  const capped = await handleEmbed(post('/api/embed', { text: 'q' }), deps);
  expect(capped.status).toBe(429);
  expect((await errorOf(capped)).code).toBe('visitor_cap');
});

describe('streaming answers (Review Focus #3)', () => {
  test('a quota error before the first token is a JSON 429', async () => {
    const { deps } = makeDeps({}, async function* () {
      throw new GeminiError(429, 'quota', 'Resource exhausted');
    });
    const res = await handleAnswer(post('/api/answer', answerBody), deps);
    expect(res.status).toBe(429);
    expect((await errorOf(res)).code).toBe('upstream_quota');
  });

  test('an error after tokens becomes an SSE error event', async () => {
    const { deps } = makeDeps({}, async function* () {
      yield 'A';
      throw new GeminiError(429, 'quota', 'Resource exhausted');
    });
    const res = await handleAnswer(post('/api/answer', answerBody), deps);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('data: {"type":"delta","text":"A"}\n\ndata: {"type":"error","code":"upstream_quota"}\n\n');
  });

  test('a stream that produces no text is an upstream error, not an empty answer', async () => {
    const { deps } = makeDeps({}, async function* () {});
    const res = await handleAnswer(post('/api/answer', answerBody), deps);
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe('upstream_error');
  });

  test('success streams deltas then done, with passages numbered in request order', async () => {
    const { deps, stream } = makeDeps({}, async function* () {
      yield 'Services revenue';
      yield ' reached a record [1].';
    });
    const res = await handleAnswer(post('/api/answer', { ...answerBody, previousQuestion: 'What about Apple?' }), deps);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe(
      'data: {"type":"delta","text":"Services revenue"}\n\n' +
      'data: {"type":"delta","text":" reached a record [1]."}\n\n' +
      'data: {"type":"done"}\n\n');
    const request = stream.mock.calls[0]![1] as StreamRequest;
    expect(stream.mock.calls[0]![0]).toBe('server-key');
    expect(request.model).toBe('gemma-4-26b-a4b-it');
    expect(request.thinkingLevel).toBe('minimal');
    expect(request.user).toContain("Passages:\n[1] AAPL 10-K FY2025 — Item 7 Management's Discussion and Analysis\n");
    expect(request.user).toContain('[2] NVDA 10-K FY2025 — Item 1A Risk Factors\n');
    expect(request.user.startsWith('Previous question (context only): What about Apple?')).toBe(true);
  });
});

test('embed returns the query vector as base64 float16', async () => {
  const { deps, embed } = makeDeps();
  const res = await handleEmbed(post('/api/embed', { text: ' export controls ' }), deps);
  expect(res.status).toBe(200);
  const { vector } = (await res.json()) as { vector: string };
  expect(atob(vector)).toHaveLength(1536);
  expect(decodeVectorB64(vector)[0]).toBeCloseTo(0.25, 3);
  expect(embed).toHaveBeenCalledWith('server-key', ['task: search result | query: export controls']);
});

test('wrong methods get 405', async () => {
  const { deps } = makeDeps();
  expect((await handleAnswer(new Request('https://filings.example/api/answer'), deps)).status).toBe(405);
  expect((await handleStatus(new Request('https://filings.example/api/status', { method: 'POST' }), deps)).status).toBe(405);
});
