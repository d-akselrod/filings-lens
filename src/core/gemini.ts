export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const EMBED_MODEL = 'gemini-embedding-2';
export const EMBED_DIMS = 768;
export const EMBED_BATCH_MAX = 100;

export type GeminiReason = 'quota' | 'auth' | 'bad_request' | 'server' | 'network';

export class GeminiError extends Error {
  /** quotaId from the API's QuotaFailure detail, e.g. "...RequestsPerDay..." for daily caps. */
  constructor(readonly status: number, readonly reason: GeminiReason, message: string, readonly retryAfterMs?: number, readonly quotaId?: string) {
    super(message);
    this.name = 'GeminiError';
  }
}

/** gemini-embedding-2 has no task_type; the task goes in the text. */
export function queryText(q: string): string {
  return `task: search result | query: ${q}`;
}

export function documentText(title: string, text: string): string {
  return `title: ${title} | text: ${text}`;
}

function reasonFor(status: number): GeminiReason {
  if (status === 429) return 'quota';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'server';
  return 'bad_request';
}

function parseDelay(delay: unknown): number | undefined {
  const match = typeof delay === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(delay) : null;
  return match ? Math.round(Number(match[1]) * 1000) : undefined;
}

export async function toGeminiError(res: Response): Promise<GeminiError> {
  const body = await res.text().catch(() => '');
  let message = body.slice(0, 300) || res.statusText || `HTTP ${res.status}`;
  let retryAfterMs: number | undefined;
  let quotaId: string | undefined;
  let reason = reasonFor(res.status);
  try {
    const error = (JSON.parse(body) as {
      error?: { message?: string; details?: Array<{ retryDelay?: unknown; reason?: unknown; violations?: Array<{ quotaId?: unknown }> }> };
    }).error;
    if (error?.message) message = error.message;
    // Google answers an unknown or malformed key with 400 INVALID_ARGUMENT, not 401/403.
    if (error?.details?.some(d => d.reason === 'API_KEY_INVALID')) reason = 'auth';
    retryAfterMs = error?.details?.map(d => parseDelay(d.retryDelay)).find(ms => ms !== undefined);
    const id = error?.details?.flatMap(d => d.violations ?? []).map(v => v.quotaId).find(q => typeof q === 'string');
    quotaId = typeof id === 'string' ? id : undefined;
  } catch {
    // not JSON — keep the raw text
  }
  return new GeminiError(res.status, reason, message, retryAfterMs, quotaId);
}

async function post(url: string, apiKey: string, body: unknown, o?: { fetch?: typeof fetch; signal?: AbortSignal }): Promise<Response> {
  let res: Response;
  try {
    res = await (o?.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: o?.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new GeminiError(0, 'network', e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) throw await toGeminiError(res);
  return res;
}

export async function embedBatch(apiKey: string, texts: string[], o?: { fetch?: typeof fetch; signal?: AbortSignal }): Promise<Float32Array[]> {
  if (texts.length > EMBED_BATCH_MAX) throw new RangeError(`embedBatch takes at most ${EMBED_BATCH_MAX} texts, got ${texts.length}`);
  if (texts.length === 0) return [];
  const res = await post(`${GEMINI_BASE}/models/${EMBED_MODEL}:batchEmbedContents`, apiKey, {
    requests: texts.map(text => ({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text }] }, outputDimensionality: EMBED_DIMS })),
  }, o);
  const { embeddings } = (await res.json()) as { embeddings: Array<{ values: number[] }> };
  return embeddings.map(e => Float32Array.from(e.values));
}

interface GenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

/** Text of the first candidate, without thought parts (Gemma 4 thinks first unless thinkingLevel is 'minimal'). */
export function answerText(response: GenerateResponse): string {
  return (response.candidates?.[0]?.content?.parts ?? []).filter(p => p.thought !== true).map(p => p.text ?? '').join('');
}

export async function generateText(
  apiKey: string, r: { model: string; system: string; user: string; thinkingLevel?: 'minimal' }, o?: { fetch?: typeof fetch },
): Promise<string> {
  const res = await post(`${GEMINI_BASE}/models/${r.model}:generateContent`, apiKey, {
    systemInstruction: { parts: [{ text: r.system }] },
    contents: [{ role: 'user', parts: [{ text: r.user }] }],
    ...(r.thinkingLevel ? { generationConfig: { thinkingConfig: { thinkingLevel: r.thinkingLevel } } } : {}),
  }, o);
  return answerText((await res.json()) as GenerateResponse);
}

export const ANSWER_MODELS = { fast: 'gemma-4-26b-a4b-it', deep: 'gemma-4-31b-it' } as const;
export type ModelChoice = keyof typeof ANSWER_MODELS;

/** 'minimal' turns Gemma 4's thinking off (measured: a cited answer in ~4 s instead of 30–60 s); 'low' is rejected. */
export type ThinkingLevel = 'minimal';
export interface StreamRequest { model: string; system: string; user: string; signal?: AbortSignal; thinkingLevel?: ThinkingLevel }

/** Splits an SSE buffer into complete `data:` events and the unfinished tail. */
export function parseSseLines(buffer: string): { events: unknown[]; rest: string } {
  const lines = buffer.split(/\r?\n/);
  const rest = lines.pop() ?? '';
  const events: unknown[] = [];
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload) events.push(JSON.parse(payload));
  }
  return { events, rest };
}

/** Anything else (SAFETY, RECITATION, OTHER…) means the answer was cut off or withheld. */
const NORMAL_STOPS = new Set(['STOP', 'MAX_TOKENS']);

/** Streams answer text (thought parts removed) from `:streamGenerateContent?alt=sse`. */
export async function* streamGenerate(apiKey: string, r: StreamRequest, o?: { fetch?: typeof fetch }): AsyncGenerator<string> {
  const res = await post(`${GEMINI_BASE}/models/${r.model}:streamGenerateContent?alt=sse`, apiKey, {
    systemInstruction: { parts: [{ text: r.system }] },
    contents: [{ role: 'user', parts: [{ text: r.user }] }],
    ...(r.thinkingLevel ? { generationConfig: { thinkingConfig: { thinkingLevel: r.thinkingLevel } } } : {}),
  }, { fetch: o?.fetch, signal: r.signal });
  if (!res.body) throw new GeminiError(502, 'server', 'empty streaming response');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new GeminiError(0, 'network', e instanceof Error ? e.message : String(e));
    }
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const { events, rest } = parseSseLines(chunk.done ? `${buffer}\n` : buffer);
    buffer = rest;
    for (const event of events) {
      const error = (event as { error?: { code?: number; message?: string } }).error;
      if (error) throw new GeminiError(error.code ?? 500, error.code === 429 ? 'quota' : 'server', error.message ?? 'stream error');
      const response = event as GenerateResponse;
      const blocked = response.promptFeedback?.blockReason;
      if (blocked) throw new GeminiError(200, 'server', `Gemini blocked the prompt (${blocked})`);
      const text = answerText(response);
      if (text) yield text;
      const stop = response.candidates?.[0]?.finishReason;
      if (stop && !NORMAL_STOPS.has(stop)) throw new GeminiError(200, 'server', `Gemini stopped the answer early (${stop})`);
    }
    if (chunk.done) return;
  }
}
