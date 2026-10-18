import { ANSWER_MODELS, GeminiError, queryText, type ModelChoice, type StreamRequest } from '../src/core/gemini';
import { buildUserPrompt, MAX_PASSAGES, MAX_QUESTION_CHARS, SYSTEM_INSTRUCTION, type PromptPassage } from '../src/core/prompt';
import { isRestrictedCountry } from '../src/core/region';
import { encodeVectorB64 } from '../src/core/scorecard';
import type { CorpusLookup } from './corpus';
import type { ServerEnv } from './env';
import { checkLimits, visitorId, type CounterStore, type LimitKind } from './limits';

export type ApiErrorCode = 'bad_request' | 'method' | 'origin' | 'restricted_region' | 'missing_key'
  | 'visitor_cap' | 'global_budget' | 'upstream_quota' | 'upstream_error';

export interface Deps {
  env: ServerEnv;
  store: CounterStore;
  corpus: () => Promise<CorpusLookup>;
  now: () => Date;
  embed: (apiKey: string, texts: string[]) => Promise<Float32Array[]>;
  stream: (apiKey: string, r: StreamRequest) => AsyncIterable<string>;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const fail = (status: number, code: ApiErrorCode, message: string) => json(status, { error: { code, message } });

const countryOf = (req: Request) => req.headers.get('x-vercel-ip-country');
const ipOf = (req: Request) => req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

function upstreamFailure(e: unknown): Response {
  if (e instanceof GeminiError && e.reason === 'quota') return fail(429, 'upstream_quota', "Today's free Gemini quota is used up");
  return fail(502, 'upstream_error', "Google's API returned an error");
}

export async function handleStatus(req: Request, d: Deps): Promise<Response> {
  if (req.method !== 'GET') return fail(405, 'method', 'Use GET');
  const restricted = isRestrictedCountry(countryOf(req));
  return json(200, {
    region: restricted ? 'restricted' : 'ok',
    builtInKey: !d.env.geminiKey ? 'missing' : restricted ? 'restricted' : 'available',
  });
}

/** Method, origin, region, key, body validation and daily limits — in that order — before any call to Google. */
/** `validate` returns the parsed body, or an error message string. */
async function guard<T extends object>(req: Request, d: Deps, kind: LimitKind, validate: (body: unknown) => Promise<T | string>):
  Promise<Response | { body: T; key: string }> {
  if (req.method !== 'POST') return fail(405, 'method', 'Use POST');
  if (d.env.allowedOrigins.length > 0 && !d.env.allowedOrigins.includes(req.headers.get('origin') ?? '')) {
    return fail(403, 'origin', 'This API only serves the Filings Lens site');
  }
  if (isRestrictedCountry(countryOf(req))) return fail(403, 'restricted_region', "The built-in key isn't available in your region");
  if (!d.env.geminiKey) return fail(503, 'missing_key', 'The built-in key is not configured');
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail(400, 'bad_request', 'Body must be JSON');
  }
  const body = await validate(raw);
  if (typeof body === 'string') return fail(400, 'bad_request', body);
  const now = d.now();
  const visitor = await visitorId(ipOf(req), d.env.ipSalt, now.toISOString().slice(0, 10));
  const limited = await checkLimits(d.store, visitor, kind, d.env.limits, now);
  if (limited === 'visitor_cap') return fail(429, 'visitor_cap', 'Daily question limit reached for this visitor');
  if (limited === 'global_budget') return fail(429, 'global_budget', "Today's free answers are used up");
  return { body, key: d.env.geminiKey };
}

const isQuestion = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= MAX_QUESTION_CHARS;

export async function handleEmbed(req: Request, d: Deps): Promise<Response> {
  const g = await guard(req, d, 'embed', async raw => {
    const text = (raw as { text?: unknown } | null)?.text;
    return isQuestion(text) ? { text: text.trim() } : `text must be 1–${MAX_QUESTION_CHARS} characters`;
  });
  if (g instanceof Response) return g;
  try {
    const [vector] = await d.embed(g.key, [queryText(g.body.text)]);
    return json(200, { vector: encodeVectorB64(vector!) });
  } catch (e) {
    return upstreamFailure(e);
  }
}

interface AnswerRequest { question: string; passages: PromptPassage[]; model: ModelChoice; previousQuestion?: string }

export async function handleAnswer(req: Request, d: Deps): Promise<Response> {
  const g = await guard(req, d, 'answer', async (raw): Promise<AnswerRequest | string> => {
    const b = (raw ?? {}) as { question?: unknown; chunkIds?: unknown; model?: unknown; previousQuestion?: unknown };
    if (!isQuestion(b.question)) return `question must be 1–${MAX_QUESTION_CHARS} characters`;
    if (b.previousQuestion !== undefined && (typeof b.previousQuestion !== 'string' || b.previousQuestion.length > MAX_QUESTION_CHARS)) {
      return `previousQuestion must be at most ${MAX_QUESTION_CHARS} characters`;
    }
    if (b.model !== 'fast' && b.model !== 'deep') return 'model must be "fast" or "deep"';
    const ids = b.chunkIds;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_PASSAGES || !ids.every(Number.isInteger) || new Set(ids).size !== ids.length) {
      return `chunkIds must be 1–${MAX_PASSAGES} unique integers`;
    }
    const corpus = await d.corpus();
    const passages: PromptPassage[] = [];
    for (const [i, id] of (ids as number[]).entries()) {
      const passage = corpus.get(id);
      if (!passage) return `chunkIds contains unknown id ${id}`;
      passages.push({ n: i + 1, ...passage });
    }
    const previous = typeof b.previousQuestion === 'string' && b.previousQuestion.trim() ? b.previousQuestion.trim() : undefined;
    return { question: b.question.trim(), passages, model: b.model, previousQuestion: previous };
  });
  if (g instanceof Response) return g;

  const user = buildUserPrompt(g.body.question, g.body.passages, g.body.previousQuestion);
  const iterator = d.stream(g.key, {
    model: ANSWER_MODELS[g.body.model], system: SYSTEM_INSTRUCTION, user, signal: req.signal, thinkingLevel: 'minimal',
  })[Symbol.asyncIterator]();
  // Wait for the first token so an immediate quota error can still be a proper HTTP status.
  let first: IteratorResult<string>;
  try {
    first = await iterator.next();
  } catch (e) {
    return upstreamFailure(e);
  }
  const encoder = new TextEncoder();
  const event = (payload: unknown) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let r = first; !r.done; r = await iterator.next()) controller.enqueue(event({ type: 'delta', text: r.value }));
        controller.enqueue(event({ type: 'done' }));
      } catch (e) {
        const code: ApiErrorCode = e instanceof GeminiError && e.reason === 'quota' ? 'upstream_quota' : 'upstream_error';
        controller.enqueue(event({ type: 'error', code }));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
  });
}
