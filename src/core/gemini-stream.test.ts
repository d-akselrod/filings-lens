import { expect, test } from 'vitest';
import { parseSseLines, streamGenerate } from './gemini';
import { UpstreamError } from './upstream';

const encoder = new TextEncoder();

/** Gemini SSE: `data: <json>\r\n\r\n` per event; chunked at arbitrary byte boundaries. */
function sseResponse(events: unknown[], chunkSize = 7, failAfterChunks?: number): Response {
  const bytes = encoder.encode(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''));
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (failAfterChunks !== undefined && sent / chunkSize >= failAfterChunks) {
        controller.error(new TypeError('network error'));
        return;
      }
      if (sent >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(sent, sent + chunkSize));
      sent += chunkSize;
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const part = (text: string, thought = false) => ({
  candidates: [{ content: { role: 'model', parts: [thought ? { text, thought: true } : { text }] }, index: 0 }],
  modelVersion: 'gemma-4-26b-a4b-it',
});
const finish = { candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'STOP', index: 0 }],
  usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 12, thoughtsTokenCount: 150, totalTokenCount: 202 } };

function fakeFetch(response: Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response;
  }) as typeof fetch;
  return { fn, calls };
}

async function collect(gen: AsyncGenerator<string>) {
  const out: string[] = [];
  for await (const text of gen) out.push(text);
  return out;
}

const request = { model: 'gemma-4-26b-a4b-it', system: 'Answer only from passages.', user: '[1] Revenue was $10.2 billion.\nQuestion: revenue?' };

test('streams answer text across arbitrary chunk boundaries and drops thought parts', async () => {
  const f = fakeFetch(sseResponse([part('Let me check passage 1.', true), part('Revenue'), part(' was $10.2 billion [1].'), finish]));
  expect(await collect(streamGenerate('k', request, { fetch: f.fn }))).toEqual(['Revenue', ' was $10.2 billion [1].']);
  expect(f.calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:streamGenerateContent?alt=sse');
  expect(new Headers(f.calls[0]!.init.headers).get('x-goog-api-key')).toBe('k');
  expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({
    systemInstruction: { parts: [{ text: 'Answer only from passages.' }] },
    contents: [{ role: 'user', parts: [{ text: request.user }] }],
  });
});

test('an HTTP 429 throws a quota error before anything is yielded', async () => {
  const res = new Response(JSON.stringify({ error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } }), { status: 429 });
  const gen = streamGenerate('k', request, { fetch: fakeFetch(res).fn });
  await expect(gen.next()).rejects.toMatchObject({ reason: 'quota', status: 429 });
});

test('an error event mid-stream yields what arrived, then throws', async () => {
  const gen = streamGenerate('k', request, { fetch: fakeFetch(sseResponse([part('Revenue grew'), { error: { code: 429, message: 'quota' } }])).fn });
  expect(await gen.next()).toEqual({ done: false, value: 'Revenue grew' });
  await expect(gen.next()).rejects.toMatchObject({ reason: 'quota' });
});

test('a dropped connection mid-stream becomes a network UpstreamError', async () => {
  const firstEventBytes = encoder.encode(`data: ${JSON.stringify(part('Revenue grew'))}\r\n\r\n`).length;
  const gen = streamGenerate('k', request, { fetch: fakeFetch(sseResponse([part('Revenue grew'), part(' strongly')], firstEventBytes, 1)).fn });
  const seen: string[] = [];
  const error = await (async () => {
    try {
      for await (const text of gen) seen.push(text);
    } catch (e) {
      return e;
    }
  })();
  expect(seen).toEqual(['Revenue grew']);
  expect(error).toBeInstanceOf(UpstreamError);
  expect(error).toMatchObject({ reason: 'network' });
});

test('a blocked prompt throws instead of ending quietly', async () => {
  const blocked = { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, usageMetadata: { promptTokenCount: 40, totalTokenCount: 40 } };
  const gen = streamGenerate('k', request, { fetch: fakeFetch(sseResponse([blocked])).fn });
  await expect(gen.next()).rejects.toMatchObject({ reason: 'server', message: expect.stringContaining('PROHIBITED_CONTENT') });
});

test('an abnormal stop reason yields the text that arrived, then throws', async () => {
  const recitation = { candidates: [{ content: { role: 'model', parts: [{ text: ' was' }] }, finishReason: 'RECITATION', index: 0 }] };
  const gen = streamGenerate('k', request, { fetch: fakeFetch(sseResponse([part('Revenue'), recitation])).fn });
  expect(await gen.next()).toEqual({ done: false, value: 'Revenue' });
  expect(await gen.next()).toEqual({ done: false, value: ' was' });
  await expect(gen.next()).rejects.toMatchObject({ reason: 'server', message: expect.stringContaining('RECITATION') });
});

test('STOP and MAX_TOKENS end the stream normally', async () => {
  const maxTokens = { candidates: [{ content: { role: 'model', parts: [{ text: ' grew.' }] }, finishReason: 'MAX_TOKENS', index: 0 }] };
  expect(await collect(streamGenerate('k', request, { fetch: fakeFetch(sseResponse([part('Revenue'), maxTokens])).fn })))
    .toEqual(['Revenue', ' grew.']);
});

test('parseSseLines returns complete data lines and keeps the partial tail', () => {
  expect(parseSseLines('data: {"a":1}\n\ndata: {"b"')).toEqual({ events: [{ a: 1 }], rest: 'data: {"b"' });
  expect(parseSseLines('data: {"a":1}\r\n\r\n')).toEqual({ events: [{ a: 1 }], rest: '' });
});

test('a thinking level is sent as generationConfig.thinkingConfig', async () => {
  const f = fakeFetch(sseResponse([part('OK')]));
  await collect(streamGenerate('k', { ...request, thinkingLevel: 'minimal' }, { fetch: f.fn }));
  expect(JSON.parse(String(f.calls[0]!.init.body)).generationConfig).toEqual({ thinkingConfig: { thinkingLevel: 'minimal' } });
});
