import { networkError, reasonFor, UpstreamError } from './upstream.js';

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
/** NVIDIA Nemotron 3 Embed 1B on OpenRouter's free tier: 50 requests a day, but each request can carry a large batch. */
export const EMBED_MODEL = 'nvidia/nemotron-3-embed-1b:free';
export const EMBED_NATIVE_DIMS = 2048;
/** The model card allows slicing from the start plus re-normalizing; 768 dimensions keep the vectors inside the download budget. */
export const EMBED_DIMS = 768;
export const EMBED_BATCH_MAX = 256;

/** Nemotron 3 Embed is asymmetric: queries and documents carry different prefixes (model card, /v1/embeddings). */
export function queryText(q: string): string {
  return `query: ${q}`;
}

export function documentText(title: string, text: string): string {
  return `passage: ${title}\n${text}`;
}

/** The first `dims` components, L2-normalized again. */
export function sliceNormalize(v: ArrayLike<number>, dims = EMBED_DIMS): Float32Array {
  const out = new Float32Array(dims);
  let sum = 0;
  for (let i = 0; i < dims; i++) {
    out[i] = v[i]!;
    sum += out[i]! * out[i]!;
  }
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < dims; i++) out[i] = out[i]! / norm;
  return out;
}

interface OpenRouterError { code?: number; message?: string }

function toUpstreamError(status: number, error: OpenRouterError | undefined, headers: Headers): UpstreamError {
  const code = error?.code ?? status;
  const message = error?.message ?? `HTTP ${status}`;
  const reason = reasonFor(code);
  if (reason !== 'quota') return new UpstreamError(code, reason, message);
  const reset = Number(headers.get('x-ratelimit-reset'));
  const retryAfterMs = Number.isFinite(reset) && reset > 0 ? Math.max(0, reset - Date.now()) : undefined;
  const quotaId = /per-?day/i.test(message) ? 'free-models-per-day' : 'free-models-per-min';
  return new UpstreamError(code, reason, message, retryAfterMs, quotaId);
}

export async function embedBatch(apiKey: string, texts: string[], o?: { fetch?: typeof fetch; signal?: AbortSignal }): Promise<Float32Array[]> {
  if (texts.length > EMBED_BATCH_MAX) throw new RangeError(`embedBatch takes at most ${EMBED_BATCH_MAX} texts, got ${texts.length}`);
  if (texts.length === 0) return [];
  let res: Response;
  try {
    res = await (o?.fetch ?? fetch)(`${OPENROUTER_BASE}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://filings-lens.vercel.app', 'X-Title': 'Filings Lens',
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
      signal: o?.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw networkError(e);
  }
  const body = (await res.json().catch(() => ({}))) as { data?: Array<{ index: number; embedding: number[] }>; error?: OpenRouterError };
  // OpenRouter can report a provider failure inside a 200 response.
  if (!res.ok || body.error) throw toUpstreamError(res.status, body.error, res.headers);
  if (!body.data || body.data.length !== texts.length) {
    throw new UpstreamError(502, 'server', `expected ${texts.length} embeddings, got ${body.data?.length ?? 0}`);
  }
  return [...body.data].sort((a, b) => a.index - b.index).map(d => sliceNormalize(d.embedding));
}
