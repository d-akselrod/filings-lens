import type { ApiErrorCode } from '../../../server/handlers';
import { ANSWER_MODELS, parseSseLines, streamGenerate, type ModelChoice } from '../../core/gemini';
import { buildUserPrompt, SYSTEM_INSTRUCTION, type PromptPassage } from '../../core/prompt';
import { decodeVectorB64 } from '../../core/vector-b64';
import { isDailyQuota, UpstreamError } from '../../core/upstream';
import type { BuiltinStatus } from '../state/keys';

export type KeySource = { kind: 'builtin' } | { kind: 'byok'; key: string };
export type ClientErrorCode = ApiErrorCode | 'network' | 'byok_invalid' | 'byok_quota' | 'no_key' | 'search_failed';

export class ClientError extends Error {
  constructor(readonly code: ClientErrorCode, message: string) {
    super(message);
    this.name = 'ClientError';
  }
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function apiError(res: Response): Promise<ClientError> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
  const code = typeof body?.error?.code === 'string' ? (body.error.code as ApiErrorCode) : 'upstream_error';
  const message = typeof body?.error?.message === 'string' ? body.error.message : `HTTP ${res.status}`;
  return new ClientError(code, message);
}

async function send(url: string, init: RequestInit, f: typeof fetch): Promise<Response> {
  let res: Response;
  try {
    res = await f(url, init);
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ClientError('network', messageOf(e));
  }
  if (!res.ok) throw await apiError(res);
  return res;
}

const postJson = (url: string, body: unknown, f: typeof fetch, signal?: AbortSignal) =>
  send(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal }, f);

/** Errors from Google on the visitor's own key (answers only), in the client's terms. */
function byokError(e: unknown): unknown {
  if (isAbort(e)) return e;
  const reason = e instanceof UpstreamError ? e.reason : null;
  if (reason === 'auth') return new ClientError('byok_invalid', messageOf(e));
  if (reason === 'quota') return new ClientError(isDailyQuota(e as UpstreamError) ? 'byok_quota' : 'upstream_busy', messageOf(e));
  if (reason === 'network') return new ClientError('network', messageOf(e));
  return new ClientError('upstream_error', messageOf(e));
}

export async function fetchStatus(f: typeof fetch = fetch): Promise<{ region: 'ok' | 'restricted'; builtInKey: 'available' | 'restricted' | 'missing' }> {
  return (await send('/api/status', { cache: 'no-store' }, f)).json();
}

/**
 * Questions are always embedded by /api/embed, even for visitors with their own Gemini key: the corpus vectors come
 * from NVIDIA's Nemotron 3 Embed (via OpenRouter), which a Gemini key can't call.
 */
export async function embedQuestion(text: string, f: typeof fetch = fetch): Promise<Float32Array> {
  const { vector } = (await (await postJson('/api/embed', { text }, f)).json()) as { vector: string };
  return decodeVectorB64(vector);
}

/** `corpus` is the manifest's corpus file: the server refuses chunk ids from another data version (409 stale_corpus). */
export async function* streamAnswer(a: {
  question: string; chunkIds: number[]; passages: PromptPassage[]; model: ModelChoice; corpus: string;
  previousQuestion?: string; src: KeySource; signal?: AbortSignal;
}, f: typeof fetch = fetch): AsyncGenerator<string> {
  if (a.src.kind === 'byok') {
    try {
      // Same prompt and thinking level as the built-in path (server/handlers.ts).
      yield* streamGenerate(a.src.key, {
        model: ANSWER_MODELS[a.model], system: SYSTEM_INSTRUCTION, user: buildUserPrompt(a.question, a.passages, a.previousQuestion),
        signal: a.signal, thinkingLevel: 'minimal',
      }, { fetch: f });
    } catch (e) {
      throw byokError(e);
    }
    return;
  }

  const res = await postJson('/api/answer', {
    question: a.question, chunkIds: a.chunkIds, model: a.model, corpus: a.corpus,
    ...(a.previousQuestion ? { previousQuestion: a.previousQuestion } : {}),
  }, f, a.signal);
  if (!res.body) throw new ClientError('network', 'The answer response had no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (isAbort(e)) throw e;
        throw new ClientError('network', messageOf(e));
      }
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const { events, rest } = parseSseLines(chunk.done ? `${buffer}\n` : buffer);
      buffer = rest;
      for (const event of events as Array<{ type?: string; text?: string; code?: ClientErrorCode }>) {
        if (event.type === 'delta' && event.text) yield event.text;
        else if (event.type === 'done') return;
        else if (event.type === 'error') throw new ClientError(event.code ?? 'upstream_error', 'The answer stream reported an error');
      }
      if (chunk.done) throw new ClientError('network', 'The answer stream ended before it finished');
    }
  } finally {
    // Stops the server's stream (and its Gemini call) when the consumer stops early.
    void reader.cancel().catch(() => {});
  }
}

export function builtinStatusFor(code: ClientErrorCode): BuiltinStatus | null {
  switch (code) {
    case 'restricted_region': return 'restricted';
    case 'visitor_cap':
    case 'global_budget':
    case 'upstream_quota': return 'exhausted';
    case 'missing_key': return 'missing';
    default: return null;
  }
}
