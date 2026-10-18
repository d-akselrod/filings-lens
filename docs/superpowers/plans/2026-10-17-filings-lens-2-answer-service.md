# Filings Lens — Plan 2 of 3: Answer Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A small Vercel API (`/api/status`, `/api/embed`, `/api/answer`). It keeps the Gemini key on the server, enforces the regional rule and the free-tier limits, and streams cited Gemma answers. It also includes the shared streaming, prompt, and citation-check modules that the browser reuses for bring-your-own-key.

**Architecture:**
- **Shared modules** (`src/core/`) are used by both the function and the browser: Gemini streaming, the prompt builder, the citation checker, and the region list.
- **Function-only code** (`server/`): environment parsing, rate limits, the corpus lookup, and the handlers. The handlers are pure functions `(Request, Deps) => Promise<Response>`, so tests run without Vercel.
- **Entry points:** `api/*.ts` are three-line Vercel entry points.
- **Local dev:** `scripts/dev-api.ts` serves the same handlers on port 8787 for local development and Vite's proxy (Plan 3).

**Tech Stack:** Vercel Functions (Node runtime, Web-standard `export default { fetch }`), `@upstash/redis` 1.39.0 (optional, free tier), Vitest 5, tsx 4.

**Spec:** `docs/superpowers/specs/2026-10-17-sec-filings-rag-design.md`

**Deliberate deviation from the spec** (tell the owner): the spec describes one function with two operations. This plan uses three tiny Vercel entry files (`status`, `embed`, `answer`) that share one handler module.
- `status` is a cheap extra. It lets the UI show the regional/key state before anyone asks a question.
- Separate files avoid relying on rewrite-path behavior.
- Only `answer` gets the 300 s duration and the bundled corpus.

**Depends on:** Plan 1. It uses `src/core/{types,gemini,scorecard}.ts` and the committed `public/data/` files.

## Global Constraints

- **The key:** it lives only in the server env var `GEMINI_API_KEY`. It's never logged and never in a response. The browser never receives it.
- **Models:** `fast` = `gemma-4-26b-a4b-it` (the default) and `deep` = `gemma-4-31b-it`. Thought parts (`"thought": true`) are never forwarded.
- **Input limits:**
  - `question`/`text`: trimmed, 1–500 characters.
  - `previousQuestion`: ≤500 characters.
  - `chunkIds`: 1–10 unique integers that exist in the corpus.
  - `model`: `'fast' | 'deep'`.
- **Regional rule:** the visitor's country comes from `x-vercel-ip-country` (ISO 3166-1 alpha-2). If it's in `RESTRICTED_COUNTRIES`, **missing, or unknown**, the request is restricted (fail closed). Restricted requests never call Google.
- **Free-tier limits** (env overrides):
  - `VISITOR_DAILY_REQUESTS` = 50 per visitor per UTC day (embed + answer).
  - `GLOBAL_DAILY_ANSWERS` = 200.
  - `GLOBAL_DAILY_EMBEDS` = 800.
  - Counters live in Upstash Redis (free) when configured, otherwise in memory.
- **Origins:** `ALLOWED_ORIGINS` is comma-separated. When it's set, any other `Origin` → 403 `origin`. When it's empty (local dev), every origin is allowed.
- **Error body:** `{ "error": { "code": ApiErrorCode, "message": string } }`.
- **Answer stream format:** SSE lines `data: {"type":"delta","text":"…"}`, then `data: {"type":"done"}`. After an upstream failure mid-stream: `data: {"type":"error","code":"upstream_quota"|"upstream_error"}`.
- **Function max durations:** status 10 s, embed 30 s, answer 300 s.
- **Code conventions:** relative imports only, ESM, colocated `*.test.ts`. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Branching:** work on branch `plan-2-answer-service`, created from the merged Plan 1 work.

## Review Focus

1. **Oversized or junk input** (501-character question, empty question, 11 ids, unknown id, non-JSON body): 400 `bad_request` with a readable message, and Google is never called. Task 5.
2. **Restricted, missing, or unknown country header:** 403 `restricted_region`, and Google is never called. Task 5.
3. **Google quota exhausted before or during streaming:**
   - Before the first token: JSON 429 `upstream_quota`.
   - After tokens have been sent: an SSE `error` event, so the client can keep the partial answer.
   - Tasks 1 and 5.
4. **Numbers written in a different scale or format than the passage** (`$60.9 billion` vs a table's `60,922` in millions; `(1,234)` negatives; `12.5 %`): not flagged. Years and Item numbers are never checked. Task 3.
5. **Calls from another website** (foreign `Origin`) when `ALLOWED_ORIGINS` is set: 403 `origin`. Task 5.

---

## File Structure

```
src/core/gemini.ts        + ANSWER_MODELS, streamGenerate(), parseSseLines()   (extends Plan 1 file)
src/core/prompt.ts        SYSTEM_INSTRUCTION, buildUserPrompt(), input limits
src/core/citations.ts     splitSentences(), extractCitations(), extractNumbers(), checkSentence()
src/core/region.ts        RESTRICTED_COUNTRIES, isRestrictedCountry()
server/env.ts             readEnv()
server/limits.ts          CounterStore, memoryStore(), upstashStore(), checkLimits(), visitorId()
server/corpus.ts          loadCorpusLookup()
server/handlers.ts        handleStatus(), handleEmbed(), handleAnswer(), Deps, ApiErrorCode
server/deps.ts            getDeps() — production singletons
api/status.ts, api/embed.ts, api/answer.ts
scripts/dev-api.ts        local server on :8787 with DEV_COUNTRY
vercel.json               function durations + includeFiles
```

---

### Task 1: Streaming generation client

**Files:** Modify `src/core/gemini.ts`; Test `src/core/gemini-stream.test.ts`

**Interfaces:**
- Consumes: `GEMINI_BASE`, `GeminiError`, `toGeminiError` (Plan 1, Task 7).
- Produces:
```ts
export const ANSWER_MODELS = { fast: 'gemma-4-26b-a4b-it', deep: 'gemma-4-31b-it' } as const;
export type ModelChoice = keyof typeof ANSWER_MODELS;
export interface StreamRequest { model: string; system: string; user: string; signal?: AbortSignal }
export function streamGenerate(apiKey: string, r: StreamRequest, o?: { fetch?: typeof fetch }): AsyncGenerator<string>;
export function parseSseLines(buffer: string): { events: unknown[]; rest: string };  // complete `data:` lines → JSON; rest = partial tail
```
**Request:** `POST {BASE}/models/{model}:streamGenerateContent?alt=sse` with header `x-goog-api-key` and body `{ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }] }`. Verified live: first byte arrives in 0.8 s, and thought parts arrive as `parts[].thought === true`.

**Yields:** each event's `candidates[0].content.parts[]` where `thought !== true` and the text is non-empty.

**Errors:**
- Non-2xx → throw `await toGeminiError(res)` before yielding anything.
- An event with an `error` object → throw a `GeminiError`. Code 429 → `quota`; otherwise `server`.

- [ ] **Step 1: Write the failing tests** (fake `fetch` whose body is a `ReadableStream` of SSE bytes)
- Events split across arbitrary byte boundaries, including mid-line, yield `['Revenue', ' was $10.2 billion [1].']` and skip a `thought: true` part.
- The URL ends with `:streamGenerateContent?alt=sse`, and the body's `systemInstruction` text equals `system`.
- HTTP 429 throws `GeminiError{reason:'quota'}` before the first yield.
- **Review Focus #3:** a stream with one delta and then `data: {"error":{"code":429,"message":"quota"}}` yields the delta, then throws `reason:'quota'`.
- `parseSseLines('data: {"a":1}\n\ndata: {"b"')` returns `{ events: [{a:1}], rest: 'data: {"b"' }`.
- [ ] **Step 2: Run to make sure they fail.** `npx vitest run src/core/gemini-stream.test.ts`: FAIL.
- [ ] **Step 3: Implement.** Decode with `TextDecoder` and feed `parseSseLines` incrementally.
- [ ] **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(core): streaming Gemma client with thought filtering`

---

### Task 2: Prompt builder

**Files:** Create `src/core/prompt.ts`; Test `src/core/prompt.test.ts`

**Interfaces:**
- Produces:
```ts
export const MAX_QUESTION_CHARS = 500;
export const MAX_PASSAGES = 10;
export interface PromptPassage { n: number; ticker: string; fiscalYear: number; item: string; itemTitle: string; text: string }
export const SYSTEM_INSTRUCTION: string;   // exact copy below
export function buildUserPrompt(question: string, passages: PromptPassage[], previousQuestion?: string): string;
```
`SYSTEM_INSTRUCTION` (exact):
```
You answer questions about SEC Form 10-K annual reports using ONLY the numbered passages provided.
Rules:
1. End every sentence that states a fact with citations like [1] or [2][3] pointing to the passages that support it.
2. Copy numbers exactly as written in the passages, with their units and fiscal period.
3. If the passages do not answer the question, reply exactly: "The provided filings don't answer this." Then stop.
4. Never give investment advice, price predictions, or opinions on buying or selling securities.
5. Answer in at most 6 sentences of plain prose. No headings, lists, or markdown.
```
User prompt layout (exact; the first block appears only when `previousQuestion` is set):
```
Previous question (context only): {previousQuestion}

Passages:
[1] NVDA 10-K FY2025 — Item 1A Risk Factors
{text}

[2] …

Question: {question}
```

- [ ] **Step 1: Write the failing tests**
- An exact string match for a two-passage prompt, with and without `previousQuestion`.
- Throws `RangeError` for 11 passages or a 501-character question.
- `SYSTEM_INSTRUCTION` contains `"The provided filings don't answer this."`.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(core): answer prompt builder`

---

### Task 3: Citation checker

**Files:** Create `src/core/citations.ts`; Test `src/core/citations.test.ts`

**Interfaces:**
- Produces:
```ts
export interface NumberToken { raw: string; value: number; percent: boolean; halfUnit: number }
export interface SentenceCheck { text: string; citations: number[]; invalidCitations: number[]; missingCitation: boolean; unsupportedNumbers: string[] }
export function splitSentences(text: string, final?: boolean): { complete: string[]; rest: string };
export function extractCitations(s: string): number[];               // [1], [1][3], [2, 1] → sorted unique
export function extractNumbers(s: string): NumberToken[];
export function checkSentence(s: string, passages: ReadonlyMap<number, string>): SentenceCheck;
```
**Algorithms** (not determined by the signatures):
- **Sentence boundary:** at `.`, `!`, or `?` when all of these hold:
  - It isn't a decimal point (no digit on both sides).
  - The token before it isn't one of `U.S, U.K, E.U, Inc, Corp, Co, Ltd, No, vs, e.g, i.e, approx, Mr, Ms, Dr, St` (case-insensitive).
  - It's followed by optional closing `"')]`, then optional citation groups `(\s*\[\d+(?:\s*,\s*\d+)*\])+`, which become part of the sentence, then whitespace and an uppercase letter, digit, `"`, or `$`.
  - The end of the text also counts as a boundary, but only when `final` is true.
  - Whatever isn't complete is returned as `rest`.
- **Numbers:**
  - First remove citation groups and the strings `10-K`/`10-Q`.
  - Match `/(?<![\w.])(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\s*(?:%|percent\b|thousand\b|million\b|billion\b|trillion\b))?/gi`. Parentheses around a number mean a negative; compare absolute values.
  - `value = number × scale` (thousand 1e3, million 1e6, billion 1e9, trillion 1e12).
  - `halfUnit = 0.5 × 10^(−decimals) × scale`.
  - `percent` is true for `%` and `percent`.
  - **Skip:**
    - 4-digit integers 1900–2100 with no `$`, decimals, or unit (years)
    - integers < 10 with no `$` or unit
    - numbers whose preceding 12 characters end with `/(item|note|part|fy|fiscal(?: year)?|q[1-4])\s*$/i`
- **Support:** an answer number `a` is supported if some number `p` in any cited, valid passage has the same `percent` flag, and for some `m ∈ {1e-9, 1e-6, 1e-3, 1, 1e3, 1e6, 1e9}`: `|a.value − p.value·m| ≤ max(a.halfUnit, p.halfUnit·m)`.
- **Missing citation:** `missingCitation = validCitations.length === 0 && !EXEMPT.test(s)`, where `EXEMPT = /(provided filings|passages)\s+(?:don't|do not|doesn't|does not)\s+(?:answer|cover|contain)|investment advice/i`. A cited `n` that isn't in `passages` goes in `invalidCitations`.

- [ ] **Step 1: Write the failing tests** (Review Focus #4 is covered here)
```ts
const P = new Map([[1, 'Total net sales | $60,922 | $26,974\nOperating loss | (1,234)'], [2, 'gross margin of 12.5 %']]);
test.each([
  ['Total net sales were $60.9 billion [1].', []],
  ['Operating loss was $1.2 billion [1].', []],
  ['Gross margin was 12.5% [2].', []],
  ['Revenue was $70 billion [1].', ['$70 billion']],
  ['In fiscal 2025, revenue grew [1].', []],
  ['Item 1A lists the main risks [1].', []],
])('%s', (s, unsupported) => expect(checkSentence(s, P).unsupportedNumbers).toEqual(unsupported));
test('citations', () => {
  expect(checkSentence('NVIDIA faces export limits.', P).missingCitation).toBe(true);
  expect(checkSentence("The provided filings don't answer this.", P).missingCitation).toBe(false);
  expect(checkSentence('Sales rose [9].', P)).toMatchObject({ invalidCitations: [9], missingCitation: true });
  expect(extractCitations('a [1][3] b [2, 1]')).toEqual([1, 2, 3]);
});
test('streaming sentence split', () => {
  expect(splitSentences('Revenue was $10.2 billion [1]. It gre')).toEqual({ complete: ['Revenue was $10.2 billion [1].'], rest: 'It gre' });
  expect(splitSentences('U.S. export rules apply [1]. Next')).toEqual({ complete: ['U.S. export rules apply [1].'], rest: 'Next' });
  expect(splitSentences('Sales rose. [2] Costs fell [3].', true).complete).toEqual(['Sales rose. [2]', 'Costs fell [3].']);
});
```
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(core): deterministic citation and number checker`

---

### Task 4: Regional rule and free-tier limits

**Files:** Create `src/core/region.ts`, `server/limits.ts`; Test `src/core/region.test.ts`, `server/limits.test.ts`

**Interfaces:**
- Produces:
```ts
// src/core/region.ts
export const RESTRICTED_COUNTRIES: ReadonlySet<string>;
// EU-27: AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE
// EEA: IS LI NO · CH · GB · conservative extras: AX GF GP MQ RE YT MF GI JE GG IM
export function isRestrictedCountry(code: string | null | undefined): boolean;  // null, '', 'XX', non-2-letter → true
// server/limits.ts
export interface CounterStore { incr(key: string, ttlSeconds: number): Promise<number> }
export function memoryStore(now?: () => number): CounterStore;
export function upstashStore(url: string, token: string): CounterStore;  // Redis.incr; expire(key, ttl) when result === 1
export type LimitKind = 'embed' | 'answer';
export interface LimitConfig { visitorDailyRequests: number; globalDailyAnswers: number; globalDailyEmbeds: number }
export async function visitorId(ip: string, salt: string, day: string): Promise<string>; // sha256 hex of `${salt}|${ip}|${day}`, first 16 chars (WebCrypto)
export async function checkLimits(store: CounterStore, visitor: string, kind: LimitKind, cfg: LimitConfig, now: Date):
  Promise<null | 'visitor_cap' | 'global_budget'>;
// keys: `v:${YYYY-MM-DD}:${visitor}` then `g:${kind}:${YYYY-MM-DD}` (UTC day); TTL 172800 s; visitor checked first
```

- [ ] **Step 1: Write the failing tests**
- `DE`, `GB`, `CH`, `NO`, and `GP` are restricted. `US` and `CA` are not. `null`, `''`, and `'XX'` are restricted.
- `memoryStore` counts up and forgets a key after its TTL (fake clock).
- With `visitorDailyRequests 2`: the 3rd request on the same day is `'visitor_cap'`, and the next UTC day it's `null` again.
- With `globalDailyAnswers 1`, two different visitors: the second gets `'global_budget'`.
- `visitorId` is deterministic and 16 hex characters.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement** (`npm i @upstash/redis@1.39.0`). **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(server): regional rule and daily free-tier limits`

---

### Task 5: API handlers

**Files:** Create `server/env.ts`, `server/corpus.ts`, `server/handlers.ts`; Test `server/handlers.test.ts`, `server/corpus.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4. Also from Plan 1: `encodeVectorB64`, `queryText`, `embedBatch`, `Manifest`, and `CorpusFile`.
- Produces:
```ts
// server/env.ts
export interface ServerEnv { geminiKey: string | null; allowedOrigins: string[]; limits: LimitConfig; ipSalt: string;
  upstash: { url: string; token: string } | null }
export function readEnv(e: Record<string, string | undefined>): ServerEnv;
// upstash url = UPSTASH_REDIS_REST_URL ?? KV_REST_API_URL; token = UPSTASH_REDIS_REST_TOKEN ?? KV_REST_API_TOKEN; ipSalt = IP_HASH_SALT ?? ''
// server/corpus.ts
export interface CorpusLookup { get(id: number): Omit<PromptPassage, 'n'> | undefined }
export async function loadCorpusLookup(rootDir: string): Promise<CorpusLookup>;  // public/data/manifest.json → corpus file
// server/handlers.ts
export type ApiErrorCode = 'bad_request' | 'method' | 'origin' | 'restricted_region' | 'missing_key'
  | 'visitor_cap' | 'global_budget' | 'upstream_quota' | 'upstream_error';
export interface Deps {
  env: ServerEnv; store: CounterStore; corpus: () => Promise<CorpusLookup>; now: () => Date;
  embed: (apiKey: string, texts: string[]) => Promise<Float32Array[]>;
  stream: (apiKey: string, r: StreamRequest) => AsyncIterable<string>;
}
export function handleStatus(req: Request, d: Deps): Promise<Response>;  // GET → { region: 'ok'|'restricted', builtInKey: 'available'|'restricted'|'missing' }
export function handleEmbed(req: Request, d: Deps): Promise<Response>;   // POST { text } → { vector: base64 f16le }
export function handleAnswer(req: Request, d: Deps): Promise<Response>;  // POST { question, chunkIds, model, previousQuestion? } → SSE
```
**Check order for embed and answer:**
1. Method must be POST, otherwise 405 `method`.
2. Origin, otherwise 403 `origin`.
3. Region (`x-vercel-ip-country`), otherwise 403 `restricted_region`.
4. Key present, otherwise 503 `missing_key`.
5. JSON body and validation, otherwise 400 `bad_request`, with the message naming the field.
6. Limits (visitor id from `x-real-ip`, else the first `x-forwarded-for` entry, else `'unknown'`), otherwise 429 `visitor_cap`/`global_budget`.
7. Call Google.

**Embedding:** embeds `queryText(text)`.

**Answer:**
- Build passages from the lookup in request order, numbered n = 1…, then build the prompt (Task 2).
- Await the first item of `stream(...)` *before* creating the Response.
  - A `GeminiError` at that point → JSON error: 429 `upstream_quota` for `quota`, otherwise 502 `upstream_error`.
  - Otherwise respond 200 with `Content-Type: text/event-stream; charset=utf-8` and `Cache-Control: no-store`, then stream the deltas and finish with `done`.
  - A later error → an `error` event, then close.
- **Status:** never calls Google. All JSON responses carry `Cache-Control: no-store`.

- [ ] **Step 1: Write the failing tests** (fake `Deps` with spies, a `memoryStore`, and a 3-entry fake corpus lookup)
- **Review Focus #1:**
  - A 501-character question → 400.
  - `"   "` → 400.
  - 11 ids → 400.
  - An unknown id → 400.
  - A body that isn't JSON → 400.
  - In every case the `stream`/`embed` spies weren't called.
- **Review Focus #2:** country `FR` → 403 `restricted_region`. A missing header → 403 as well. No Google spy calls. Status for `DE` → `{region:'restricted', builtInKey:'restricted'}`; for `US` → `available`; with no key → `missing`.
- **Review Focus #5:** with `allowedOrigins ['https://a.app']` and `Origin: https://evil.app` → 403 `origin`.
- The visitor cap returns 429 `visitor_cap`.
- **Review Focus #3:** the stream spy throws a quota `GeminiError` immediately → 429 JSON `upstream_quota`. Yielding `'A'` and then throwing → a body of `data: {"type":"delta","text":"A"}` followed by `data: {"type":"error","code":"upstream_quota"}`.
- On success the body ends with `data: {"type":"done"}`, and the `user` prompt passed to the spy starts its passages with `[1] ` for the first requested id.
- Embed returns 200, and `vector` base64-decodes to 1,536 bytes.
- **`corpus.test.ts`:** `loadCorpusLookup` against a temp dir built by Plan 1's `writeDataFiles` (fixture) returns `ticker`, `fiscalYear`, `itemTitle`, and `text` for id 0.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(server): status, embed and streaming answer handlers`

---

### Task 6: Vercel entry points, local dev server, live verification

**Files:** Create `server/deps.ts`, `api/status.ts`, `api/embed.ts`, `api/answer.ts`, `scripts/dev-api.ts`, `vercel.json`; Modify `package.json` (add the script `"dev:api": "tsx scripts/dev-api.ts"`)

**Interfaces:**
- Produces: `getDeps(): Deps`, built once per process:
  - `readEnv(process.env)`
  - `upstashStore` when Upstash is configured, otherwise `memoryStore`, with a single `console.warn` saying the limits are per-instance
  - corpus = memoized `loadCorpusLookup(process.cwd())`
  - `embed` = `embedBatch`, `stream` = `streamGenerate`
- Each `api/*.ts` file:
  ```ts
  import { handleAnswer } from '../server/handlers';
  import { getDeps } from '../server/deps';
  export default { fetch: (req: Request) => handleAnswer(req, getDeps()) };
  ```
  `api/status.ts` and `api/embed.ts` are the same with their own handler.
- `vercel.json`:
```json
{
  "functions": {
    "api/status.ts": { "maxDuration": 10 },
    "api/embed.ts": { "maxDuration": 30 },
    "api/answer.ts": { "maxDuration": 300, "includeFiles": "public/data/**" }
  }
}
```
- **`scripts/dev-api.ts`:**
  - Load `.env.local` with `process.loadEnvFile`.
  - Start `node:http` on port 8787.
  - Convert `IncomingMessage` to a `Request`: the body via `Readable.toWeb` with `duplex: 'half'`, plus the injected headers `x-vercel-ip-country: process.env.DEV_COUNTRY ?? 'US'` and `x-real-ip: socket.remoteAddress`.
  - Route `/api/status|embed|answer`.
  - Pipe the `Response` status, headers, and streamed body back.

- [ ] **Step 1: Implement the files above.** No new logic: anything beyond wiring belongs in the tested handlers.
- [ ] **Step 2: Typecheck and run the full suite.** `npm run typecheck && npm test` should be green.
- [ ] **Step 3: Live verification** (needs the owner's `.env.local`). Start `npm run dev:api` in the background, then:
  - `curl -s localhost:8787/api/status` returns `{"region":"ok","builtInKey":"available"}`.
  - `curl -s -X POST localhost:8787/api/embed -H 'content-type: application/json' -d '{"text":"export controls"}' | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["vector"]))'` prints `2048`.
  - Get two NVDA Item 1A chunk ids from `npm run search -- "NVIDIA export controls China"`. Then `curl -N -X POST localhost:8787/api/answer -H 'content-type: application/json' -d '{"question":"How does NVIDIA describe export-control risk related to China?","chunkIds":[ID1,ID2],"model":"fast"}'` streams `delta` events with `[1]`/`[2]` citations and ends with `{"type":"done"}` within ~10 s.
  - Restart with `DEV_COUNTRY=DE npm run dev:api`: status shows `restricted`, and embed returns 403 `restricted_region`.
- [ ] **Step 4: Commit.** `feat(api): Vercel entry points, function config and local dev server`

---

## Plan 2 done when

- `npm test` and `npm run typecheck` are green.
- The local API streams a cited answer for the NVIDIA sample.
- A restricted country never reaches Google, as proven by tests and by `DEV_COUNTRY=DE`.
