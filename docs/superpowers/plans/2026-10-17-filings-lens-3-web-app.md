# Filings Lens — Plan 3 of 3: Web App, Scorecard & Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The public React site, deployed at $0 on Vercel. It is "Layout A, modernized": settings on the left, a streamed and cited answer in the middle, and evidence with per-stage scores on the right. A Web Worker runs PGlite, the hand-written search, and the reranker. Answers come from the Plan 2 API or from the visitor's own key. The site also has a Scorecard view.

**Architecture:**
- **The worker** (`src/worker/`):
  - fetches `/data/manifest.json` and the hashed data files
  - builds the in-memory PGlite database with Plan 1's `loadCorpus`
  - runs Plan 1's `SearchEngine` and scorecard
  - lazily loads a transformers.js cross-encoder
  - exposes all of this through Comlink
- **The React app** (`src/app/`) holds three zustand stores:
  - settings
  - keys (built-in key status and bring-your-own-key)
  - session (questions, searches, streamed answers with citation checks)
- **The UI** is built from shadcn/ui primitives styled with the mockup's tokens.

**Tech Stack:**
- React 19.3, Vite 8.3, `@vitejs/plugin-react` 6.1
- Tailwind 4.3 (`@tailwindcss/vite`) and shadcn/ui (Radix)
- lucide-react 1.59, zustand 5.0, comlink 4.4
- `@huggingface/transformers` 4.3.1
- `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` 5.3
- Vitest 5 with jsdom 30 and Testing Library 16; Playwright 1.64

**Spec:** `docs/superpowers/specs/2026-10-17-sec-filings-rag-design.md` · Mockup: `docs/design/layout-a-modern.html`
**Depends on:** Plan 1 (core and data files) and Plan 2 (API, prompt, citations, streaming).

**Deliberate deviation from the spec** (tell the owner at hand-off):
- **The reranker always runs on WASM with 8-bit weights** (`model_quantized.onnx`, 23.1 MB) instead of WebGPU-when-available.
- WebGPU would need a different weight file (fp16 is 45.6 MB, over the 40 MB cap; q4f16 is 30.3 MB but less accurate). That would make Scorecard numbers differ between devices.
- On WASM, 20 passages take well under a second, which is enough.

## Global Constraints

- **Cost and download budget:** $0. First visit ≤ ~15 MB compressed, excluding the reranker, which loads after the app is ready. Usable within ~10 s on broadband.
- **Data URLs:**
  - `/data/manifest.json` is fetched with `cache: 'no-cache'`.
  - Hashed files under `/data/v/` are immutable. The browser HTTP cache serves repeat visits.
  - PGlite runs in memory (`memory://`) inside the worker.
- **Keys:**
  - Nothing secret in client code, and no `VITE_*` secret variables.
  - The build fails if a key pattern or the string `GEMINI_API_KEY` appears in `dist/` (Task 12).
  - A visitor's own key is stored only in `sessionStorage['fl-byok']`, or in `localStorage['fl-byok']` when they tick "Remember on this device". It goes only to `generativelanguage.googleapis.com`.
- **Imports:** in `src/core`, `server`, `api`, and `pipeline`, use relative imports only. `src/app` may use the `@/` alias (shadcn), which maps to `src/app`.
- **Theme:**
  - The default preference is `system`. The toggle cycles `system → light → dark`, stored in `localStorage['fl-theme']`.
  - The resolved theme is set as `data-theme` on `<html>`.
  - Tailwind's dark variant is `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`.
- **Design tokens** (from the approved mockup):

| token | light | dark |
|---|---|---|
| `--fl-bg` | `#f7f7f8` | `#0b0b0e` |
| `--fl-panel` | `#ffffff` | `#121216` |
| `--fl-panel2` | `#f4f4f5` | `#1a1a20` |
| `--fl-line` | `#e7e7ea` | `#24242b` |
| `--fl-line2` | `#d4d4d8` | `#34343e` |
| `--fl-text` | `#18181b` | `#f4f4f5` |
| `--fl-muted` | `#6b6b76` | `#a1a1aa` |
| `--fl-faint` | `#a1a1aa` | `#6b6b76` |
| `--fl-acc` | `#4f46e5` | `#8b93ff` |
| `--fl-acc2` | `#7c3aed` | `#b48cff` |
| `--fl-hl` | `rgba(250,204,21,.38)` | `rgba(250,204,21,.24)` |
| `--fl-ok` | `#16a34a` | `#22c55e` |
| `--fl-warn` | `#d97706` | `#fbbf24` |

  - **Mapping to shadcn variables:**
    - `--background`=bg, `--foreground`=text, `--card`/`--popover`=panel
    - `--muted`=panel2, `--muted-foreground`=muted, `--border`/`--input`=line
    - `--primary`=acc, `--ring`=acc
    - `--accent`=`color-mix(in srgb, var(--fl-acc) 10%, transparent)`, `--accent-foreground`=acc
  - **Fonts and shape:**
    - Fonts: Inter Variable for text; JetBrains Mono Variable with `tabular-nums` for numbers, tickers, and scores.
    - Corner radius: 12 px on cards, 8 px on controls.
    - Shadow: `0 1px 2px rgba(16,24,40,.05), 0 10px 30px -14px rgba(16,24,40,.18)`.
- **Layout breakpoints:**
  - ≥1280 px: columns `280px | 1fr | 360px`.
  - 1024–1279 px: `248px | 1fr | 320px`.
  - <1024 px: the middle column only. The header shows "Tune search" (left panel in a Sheet) and "Sources" (right panel in a Sheet).
- **Copy:** every user-facing string lives in `src/app/copy.ts` (Task 10) and matches this plan exactly.
- **Conventions:** commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work happens on branch `plan-3-web-app`.

## Review Focus

1. **Built-in key unavailable** (restricted region, exhausted quota, missing key):
   - The matching banner appears, with no raw errors.
   - Sample questions still run full hybrid search, using precomputed vectors.
   - Typed questions run keyword-only, with a notice.
   - Bring-your-own-key is offered.
   - Tasks 5, 6, and 10, plus e2e.
2. **Answer stream interrupted after partial text:** the text is kept, "Answer interrupted" and Retry are shown, and only finished sentences are checked. Tasks 6 and 7.
3. **Settings changed after an answer:** the search re-runs with **no** API request, and the answer is marked stale with Regenerate. Task 6, plus e2e.
4. **Zero passages** (filters exclude everything): no answer request is sent, and the no-matches message is shown. Task 6.
5. **Composer input over 500 characters, or empty/whitespace:** a long paste is cut at 500, submit is disabled when empty, and the counter appears past 400. Task 7.

---

## File Structure

```
index.html, vite.config.ts, components.json, playwright.config.ts
src/app/main.tsx, App.tsx, styles.css, theme.ts, copy.ts, highlight.ts, test-setup.ts
src/app/lib/utils.ts                    cn()
src/app/components/ui/*                 shadcn-generated primitives
src/app/layout/AppShell.tsx             header + 3 responsive columns + footer
src/app/state/settings.ts, keys.ts, session.ts, ui.ts
src/app/api/client.ts                   built-in API or BYOK direct to Google
src/app/engine.ts                       Comlink-wrapped worker singleton
src/app/components/Header.tsx, CommandMenu.tsx, ModelPicker.tsx, ViewSwitch.tsx,
  SettingsPanel.tsx, MetricHelp.tsx, AnswerColumn.tsx, AnswerCard.tsx, AnswerText.tsx,
  TimingBar.tsx, Composer.tsx, SuggestedQuestions.tsx, EvidencePanel.tsx, SourceCard.tsx,
  TraceTable.tsx, ScorecardView.tsx, LoadingScreen.tsx, Banners.tsx, Footer.tsx, ByokDialog.tsx
src/worker/protocol.ts, load-data.ts, reranker.ts, search.worker.ts
scripts/check-bundle.mjs
e2e/smoke.spec.ts
README.md
```

---

### Task 1: App foundation, theme, responsive shell

**Files:**
- Create: `index.html`, `vite.config.ts`, `components.json`, `src/app/{main.tsx,App.tsx,styles.css,theme.ts,test-setup.ts}`, `src/app/lib/utils.ts`, `src/app/layout/AppShell.tsx`, `src/app/components/ui/*`
- Modify: `vitest.config.ts`, `tsconfig.json`, `package.json`
- Test: `src/app/theme.test.tsx`, `src/app/layout/AppShell.test.tsx`

**Interfaces:**
- Produces:
```ts
export type ThemePref = 'system' | 'light' | 'dark';
export function useTheme(): { pref: ThemePref; resolved: 'light' | 'dark'; cycle(): void };
export function useMediaQuery(query: string): boolean;
export function AppShell(p: { header: ReactNode; left: ReactNode; main: ReactNode; right: ReactNode; footer: ReactNode;
  leftLabel?: string /* "Tune search" */; rightLabel?: string /* "Sources" */ }): JSX.Element;
```

- [ ] **Step 1: Install and configure**
```bash
npm i react@19.3.1 react-dom@19.3.1 zustand@5.0.15 comlink@4.4.2 lucide-react@1.59.0 @huggingface/transformers@4.3.1 @fontsource-variable/inter@5.3.0 @fontsource-variable/jetbrains-mono@5.3.0
npm i -D vite@8.3.4 @vitejs/plugin-react@6.1.2 tailwindcss@4.3.3 @tailwindcss/vite@4.3.3 jsdom@30.1.3 @testing-library/react@16.3.3 @testing-library/user-event @testing-library/jest-dom @types/react @types/react-dom
```
`vite.config.ts`:
```ts
plugins: [react(), tailwindcss()],
resolve: { alias: { '@': fileURLToPath(new URL('./src/app', import.meta.url)) } },
optimizeDeps: { exclude: ['@electric-sql/pglite'] },
worker: { format: 'es' },
server: { proxy: { '/api': 'http://localhost:8787' } },
```

`vitest.config.ts` becomes `mergeConfig(viteConfig, { test: {…same as Plan 1…, setupFiles: ['src/app/test-setup.ts'] } })`. UI test files start with `// @vitest-environment jsdom`. `test-setup.ts` imports `@testing-library/jest-dom/vitest` and stubs `matchMedia`.

`tsconfig.json` gains `"jsx": "react-jsx"` and `paths: { "@/*": ["src/app/*"] }`.

Scripts:
- `"dev": "vite"`
- `"build": "tsc --noEmit && vite build"`
- `"preview": "vite preview"`

Then run `npx shadcn@latest init`, choosing Vite, the zinc base color, and CSS variables, with components under `src/app/components/ui`. Then:

`npx shadcn@latest add button slider switch tabs toggle-group dialog tooltip sheet command badge scroll-area separator checkbox input textarea popover select progress collapsible`

- [ ] **Step 2: Write the failing tests**
- `useTheme`:
  - With `matchMedia('(prefers-color-scheme: dark)')` true and no stored preference, `resolved` is `'dark'` and `document.documentElement.dataset.theme` is `'dark'`.
  - `cycle()` steps through `light`, `dark`, `system`, and `localStorage['fl-theme']` follows.
- `AppShell` at 1300 px (stub `matchMedia('(min-width: 1024px)')` true) renders the left, main, and right slots.
- At 800 px it renders main plus the buttons "Tune search" and "Sources". Clicking "Sources" shows the right slot in a dialog role.
- [ ] **Step 3: Run to make sure they fail.** `npx vitest run src/app`: FAIL.
- [ ] **Step 4: Implement**
- `styles.css`: `@import "tailwindcss"`, the dark variant, both token sets (`:root` and `[data-theme=dark]`), the shadcn variable mapping, the font imports, and `.num { font-variant-numeric: tabular-nums; font-family: 'JetBrains Mono Variable', ui-monospace, monospace }`.
- `App.tsx` renders `AppShell` with placeholder slots for now.
- [ ] **Step 5: Run to make sure they pass.** Also run `npm run dev`: the page renders the shell in both themes.
- [ ] **Step 6: Commit.** `feat(app): Vite React foundation, design tokens, theme and responsive shell`

---

### Task 2: Data-loading worker and engine client

**Files:** Create `src/worker/{protocol.ts,load-data.ts,search.worker.ts}`, `src/app/engine.ts`; Test `src/worker/load-data.test.ts`, `src/worker/worker-api.test.ts`

**Interfaces:**
- Consumes: from Plan 1, `openDb`, `loadCorpus`, `SearchEngine`, `runScorecard`, `decodeVectorB64`, `Manifest`, `EvalFile`, `SamplesFile`, `ScorecardResult`, `Facets`, `ChunkView`, `SearchSettings`, `SearchResponse`, and `RerankFn`.
- Produces:
```ts
// protocol.ts
export type LoadPhase = 'manifest' | 'download' | 'database' | 'keyword-index' | 'vectors' | 'ready';
export interface LoadProgress { phase: LoadPhase; loadedBytes?: number; totalBytes?: number }
export interface InitResult { manifest: Manifest; chunkCount: number; facets: Facets; hasEval: boolean }
export interface Sample { question: string; vector: Float32Array }
export interface WorkerApi {
  init(onProgress: (p: LoadProgress) => void): Promise<InitResult>;
  search(q: { text: string; vector: Float32Array | null }, s: SearchSettings): Promise<SearchResponse>;
  getChunks(ids: number[]): Promise<ChunkView[]>;
  samples(): Promise<Sample[]>;
  loadReranker(onProgress: (loaded: number, total: number) => void): Promise<void>;
  scorecard(s: SearchSettings, onProgress: (done: number, total: number) => void): Promise<ScorecardResult>;
}
// load-data.ts
export async function fetchWithProgress(url: string, onBytes: (loaded: number) => void, f?: typeof fetch): Promise<Uint8Array>;
export async function loadData(baseUrl: string, onProgress: (p: LoadProgress) => void, f?: typeof fetch):
  Promise<{ manifest: Manifest; corpus: CorpusFile; vectors: Uint8Array; evalFile: EvalFile | null; samplesFile: SamplesFile | null }>;
// search.worker.ts
export function createWorkerApi(d: { baseUrl: string; fetch?: typeof fetch; loadReranker?: (p: (l: number, t: number) => void) => Promise<RerankFn> }): WorkerApi;
// app/engine.ts
export function getEngine(): Remote<WorkerApi>;  // singleton over new Worker(new URL('../worker/search.worker.ts', import.meta.url), { type: 'module' })
```
**Behavior:**
- **`loadData`:**
  1. Fetch `manifest.json` (no-cache). A non-OK response throws `Error('Could not load manifest (STATUS)')`.
  2. Download the corpus and vectors in parallel, reporting `download` progress where `totalBytes = corpus.bytes + vectors.bytes` (decoded bytes).
  3. Then fetch the eval and samples files if the manifest lists them.
- **`init`:**
  1. `loadData`.
  2. `openDb()`.
  3. `loadCorpus`, mapping its steps to the `database` and `keyword-index` phases.
  4. `SearchEngine.open`, reported as the `vectors` phase.
  5. `facets()`, then report `ready`.
- **`search`:** passes the loaded reranker when one exists.
- **`scorecard`:** maps eval `goldKeys` to ids through the corpus keys and throws `Error('No evaluation set')` if there is none.
- **Comlink:** the module calls `Comlink.expose(createWorkerApi({ baseUrl: '/data', loadReranker }))` only when running in a worker scope (`typeof WorkerGlobalScope !== 'undefined'`). The app passes callbacks with `Comlink.proxy`.

- [ ] **Step 1: Write the failing tests** (Node environment)
- Build fixture data files in a temp directory with Plan 1's `writeDataFiles`, plus `eval`/`samples` files made with `encodeVectorB64`. Use a fake `fetch` that reads them, streaming each in 3 chunks.
- `init` reports phases in the order `manifest, download…, database, keyword-index, vectors, ready`. Download `loadedBytes` never decreases and ends at `totalBytes`.
- `search` returns results. `samples()` returns 768-length vectors.
- `scorecard` returns rows when an eval file exists.
- A manifest 404 rejects with `'Could not load manifest (404)'`.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(worker): load data files into in-memory PGlite and expose search over Comlink`

---

### Task 3: In-browser cross-encoder reranker

**Files:** Create `src/worker/reranker.ts`; Modify `src/worker/search.worker.ts` (default `loadReranker`); Test `src/worker/reranker.test.ts`

**Interfaces:**
- Produces:
```ts
export const RERANK_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';
export interface RerankerBackend {
  tokenize(queries: string[], passages: string[]): unknown;                     // text_pair, padding, truncation, max_length 512
  run(inputs: unknown): Promise<Float32Array | number[]>;                         // logits, one per pair
}
export async function loadReranker(onProgress?: (loaded: number, total: number) => void,
  load?: (onProgress?: (loaded: number, total: number) => void) => Promise<RerankerBackend>): Promise<RerankFn>;
```
- **Default `load`:** loads `AutoTokenizer.from_pretrained(RERANK_MODEL, { progress_callback })` and `AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, { dtype: 'q8', device: 'wasm', progress_callback })`.
  - Progress: sum the `loaded`/`total` values of `status: 'progress'` events across files.
  - `run` returns `(await model(inputs)).logits.data`.
- **`RerankFn`:** splits passages into batches of 8, runs the tokenizer with the query repeated once per passage, and returns `sigmoid(logit)` per passage in input order.

- [ ] **Step 1: Write the failing tests**
- A fake backend with logits `[2, -1, 0]` gives scores ≈ `[0.8808, 0.2689, 0.5]` (6 dp).
- 20 passages go out as batches of sizes `[8, 8, 4]`, in order.
- Progress events from two files sum correctly.
- A real-model test runs only when `RUN_MODEL_TESTS=1` (use `test.runIf`). For the query `How many people live in Berlin?`, the Berlin-population passage scores above the New York museum passage.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.** Also run `RUN_MODEL_TESTS=1 npx vitest run src/worker/reranker.test.ts` once, which downloads 23 MB.
- [ ] **Step 5: Commit.** `feat(worker): lazily loaded WASM cross-encoder reranker`

---

### Task 4: Settings store and left panel

**Files:** Create `src/app/state/settings.ts`, `src/app/components/{SettingsPanel.tsx,MetricHelp.tsx}`; Test `src/app/state/settings.test.ts`, `src/app/components/SettingsPanel.test.tsx`

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS`, `SearchSettings`, `SearchFilters`, `Facets`.
- Produces:
```ts
export interface SettingsState { settings: SearchSettings;
  set(p: Partial<Omit<SearchSettings, 'filters'>>): void; toggleFilter(k: keyof SearchFilters, v: string | number): void; reset(): void }
export const useSettings: UseBoundStore<StoreApi<SettingsState>>;
export function SettingsPanel(p: { facets: Facets | null; rerankerStatus: { state: 'idle' | 'loading' | 'ready' | 'error'; loaded?: number; total?: number } }): JSX.Element;
```
**Controls** (exact labels, in order):
- **Companies:** 7 toggle tiles in mono font. The header reads "All" when none are selected, otherwise "n of 7".
- **Fiscal year:** toggle buttons, one per facet year.
- **Sections:** a popover checklist with entries like "Item 1A · Risk Factors".
- **Vector search:**
  - "Metric" segmented control: Cosine (`cosine`), Euclidean (`l2`), Dot (`dot`), with `MetricHelp` next to it.
  - "Dimensions" slider snapping to 128, 256, 512, 768.
  - "Re-normalize" switch. It's disabled when the metric is cosine, with the tooltip "Cosine always normalizes".
  - "Candidates" slider, 10–100 in steps of 10.
- **Keyword · BM25:** "k1" slider, 0–3 in steps of 0.1; "b" slider, 0–1 in steps of 0.05.
- **Fusion:**
  - "Mode" segmented control: Hybrid, Vector, Keyword.
  - "RRF k" slider, 1–120.
  - "Vector weight α" slider, 0–1 in steps of 0.05, shown only in Hybrid mode.
- **Rerank:**
  - "Rerank top N" switch, with an N slider from 5 to 50 in steps of 5.
  - Status line: "Reranker: loading 12.0 / 23.1 MB" or "Reranker: ready".
- **Answer:** "Passages sent to the model" slider, 3–10.
- **"Reset to defaults"** button.

**`MetricHelp` text (exact):** "Gemini's vectors are normalized (length 1). On normalized vectors, cosine, Euclidean and dot product always put results in the same order — only the scores differ. Shorten the vectors with the Dimensions slider and turn off Re-normalize to see them diverge."

- [ ] **Step 1: Write the failing tests**
- Store: the initial value equals `DEFAULT_SETTINGS`. `toggleFilter('tickers','AAPL')` twice returns to `[]`. `reset()` restores the defaults.
- Panel:
  - Clicking "Euclidean" sets `metric: 'l2'`.
  - Re-normalize is disabled when the metric is cosine.
  - Pressing → on the k1 slider sets `k1` to 1.3.
  - Choosing Keyword mode hides "Vector weight α".
  - Focusing the help icon shows the exact `MetricHelp` text.
  - "Reset to defaults" works.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(app): settings store and search settings panel`

---

### Task 5: Keys, API client, bring-your-own-key dialog

**Files:** Create `src/app/state/keys.ts`, `src/app/api/client.ts`, `src/app/components/ByokDialog.tsx`; Test `src/app/state/keys.test.ts`, `src/app/api/client.test.ts`, `src/app/components/ByokDialog.test.tsx`

**Interfaces:**
- Consumes: from Plan 2, `streamGenerate`, `ANSWER_MODELS`, `ModelChoice`, `SYSTEM_INSTRUCTION`, `buildUserPrompt`, `PromptPassage`, and `type ApiErrorCode` (`import type` from `server/handlers`). From Plan 1, `embedBatch`, `queryText`, `GeminiError`, and `decodeVectorB64`.
- Produces:
```ts
// keys.ts
export type BuiltinStatus = 'unknown' | 'available' | 'restricted' | 'exhausted' | 'missing';
export interface KeysState { builtin: BuiltinStatus; byokKey: string | null; remember: boolean;
  setByok(key: string, remember: boolean): void; clearByok(): void; markBuiltin(s: BuiltinStatus): void }
export const useKeys: UseBoundStore<StoreApi<KeysState>>;
export function activeSource(s: Pick<KeysState, 'builtin' | 'byokKey'>): 'byok' | 'builtin' | 'none'; // byok wins; builtin when 'available'|'unknown'
// client.ts
export type KeySource = { kind: 'builtin' } | { kind: 'byok'; key: string };
export type ClientErrorCode = ApiErrorCode | 'network' | 'byok_invalid' | 'byok_quota' | 'no_key';
export class ClientError extends Error { constructor(readonly code: ClientErrorCode, message: string) }
export async function fetchStatus(f?: typeof fetch): Promise<{ region: 'ok' | 'restricted'; builtInKey: 'available' | 'restricted' | 'missing' }>;
export async function embedQuestion(text: string, src: KeySource, f?: typeof fetch): Promise<Float32Array>;
export function streamAnswer(a: { question: string; chunkIds: number[]; passages: PromptPassage[]; model: ModelChoice;
  previousQuestion?: string; src: KeySource; signal?: AbortSignal }, f?: typeof fetch): AsyncGenerator<string>;
export function builtinStatusFor(code: ClientErrorCode): BuiltinStatus | null;
// restricted_region→'restricted'; visitor_cap|global_budget|upstream_quota→'exhausted'; missing_key→'missing'; else null
```
**Built-in path:**
- `POST /api/embed` returns `{vector}`, which is decoded with `decodeVectorB64`.
- `POST /api/answer` returns our SSE events: `delta` yields text, an `error` event throws `ClientError(code)`, and `done` ends the stream.
- A non-2xx response parses `{error:{code}}` and throws.

**Bring-your-own-key path:**
- Embedding calls `embedBatch(key, [queryText(text)])`.
- Answers call `streamGenerate(key, { model: ANSWER_MODELS[model], system: SYSTEM_INSTRUCTION, user: buildUserPrompt(question, passages, previousQuestion) })`.
- Error mapping:
  - `GeminiError` auth → `byok_invalid`
  - quota → `byok_quota`
  - network → `network`
  - anything else → `upstream_error`

**Storage:** `setByok` writes to exactly one of `sessionStorage`/`localStorage` (`fl-byok`) and removes the other. Storage exceptions (private mode) are ignored, and the key is kept in memory.

**`ByokDialog`** (exact copy):
- Title: "Use your own Gemini key".
- Body: "Your key stays in this browser and is sent only to Google. We never see it. Get a free key at Google AI Studio." The link text is "Google AI Studio", pointing to `https://aistudio.google.com/apikey`.
- A password input labeled "Gemini API key" (minimum 20 characters to enable saving).
- A checkbox "Remember on this device".
- Buttons "Save key", plus "Remove key" when a key is set.

- [ ] **Step 1: Write the failing tests**
- Cover every `activeSource` case.
- Storage: saving with remember off writes only `sessionStorage`; with remember on, only `localStorage`; `clearByok` removes both.
- Client: built-in 403 `{error:{code:'restricted_region'}}` → `ClientError` `restricted_region`.
- SSE: deltas then `done` → yields both. A `delta` then an `error` event → yields one, then throws `upstream_quota`.
- Bring-your-own-key calls only Google URLs, with `x-goog-api-key` equal to the key, and never `/api/*`.
- Verify the `builtinStatusFor` mapping.
- Dialog: Save with remember checked calls `setByok(key, true)`.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(app): key handling, API client and bring-your-own-key dialog`

---

### Task 6: Session controller

**Files:** Create `src/app/state/session.ts`; Test `src/app/state/session.test.ts`

**Interfaces:**
- Consumes: `WorkerApi` (Task 2), the client and keys (Task 5), the settings (Task 4), and `splitSentences`/`checkSentence`/`SentenceCheck` (Plan 2).
- Produces:
```ts
export interface AnswerState { text: string; status: 'idle' | 'streaming' | 'done' | 'interrupted' | 'error' | 'skipped';
  error?: ClientErrorCode; checks: SentenceCheck[]; model: ModelChoice; ms?: number }
export interface Turn { id: string; question: string; retrievalText: string; previousQuestion?: string;
  vector: Float32Array | null; vectorSource: 'api' | 'sample' | 'none'; embedMs?: number;
  search: SearchResponse | null; results: ChunkView[]; passages: ChunkView[]; settings: SearchSettings; stale: boolean; answer: AnswerState }
export interface SessionState { turns: Turn[]; model: ModelChoice; busy: boolean;
  ask(question: string, o?: { sampleVector?: Float32Array; followUp?: boolean }): Promise<void>;
  rerun(): Promise<void>; regenerate(): Promise<void>; setModel(m: ModelChoice): void; clear(): void }
export interface SessionDeps { engine: Pick<WorkerApi, 'search' | 'getChunks'>; embed: typeof embedQuestion; stream: typeof streamAnswer;
  keys: () => KeysState; settings: () => SearchSettings; now?: () => number }
export function createSession(d: SessionDeps): UseBoundStore<StoreApi<SessionState>>;
export const useSession: UseBoundStore<StoreApi<SessionState>>;   // createSession with the real deps
```
**Rules:**
1. **Inputs:** the question is trimmed (1–500 characters, otherwise a no-op).
   - When `followUp` is set and there is an earlier turn, `retrievalText` = `${last.question} ${question}`; otherwise it's the question.
   - `previousQuestion` is `last.question` only when `followUp` is set.
2. **Vector:** `sampleVector` gives `'sample'`.
   - When `activeSource` is `'none'`, the vector is `null` and the source is `'none'`.
   - Otherwise `embed(retrievalText, src)` gives `'api'`, timing it as `embedMs`.
   - On a `ClientError`, update the built-in status (built-in source only) with `builtinStatusFor`, and use a `null` vector.
3. **Search:** run `engine.search({ text: retrievalText, vector }, settings)`. Then `results = getChunks(all result ids)` and `passages = results.slice(0, contextPassages)`.
4. **Skipping the answer:** if there are no passages, set `skipped` (**Review Focus #4**). If `activeSource` is `'none'`, set `skipped` with error `restricted_region` when the built-in status is `restricted`, otherwise `no_key`. In both cases, never call `stream`.
5. **Streaming:**
   - Passages are numbered n = i + 1. Append each delta.
   - After each delta, check newly completed sentences from `splitSentences(text)` against a `Map(n → passage text)`.
   - At the end, run `splitSentences(text, true)` for the tail, then set `done` with `ms`.
   - A `ClientError` mid-stream: if any text has arrived, set `interrupted`, otherwise `error`. Store the code and update the built-in status (**Review Focus #2**).
6. **`rerun()`** (last turn only):
   - Search again with the stored vector and `retrievalText` under the current settings, and update the search, results, passages, and settings.
   - Set `stale = (answer.status === 'done' || answer.status === 'interrupted')`.
   - It never calls `embed` or `stream` (**Review Focus #3**).
7. **`regenerate()`:** re-streams the last turn with its current passages and sets `stale = false`.

- [ ] **Step 1: Write the failing tests** (fake deps)
1. `ask('Q')`: `embed` is called once with `'Q'`. `search` receives that vector. `stream` gets the first 8 passage ids, numbered `[1]`…`[8]`. The status ends `done`, with one check per sentence.
2. **Review Focus #3:** `rerun()` calls `search` again, and `embed`/`stream` call counts are unchanged. `stale` is true.
3. A follow-up: `retrievalText` is `'Q1 Q2'`, and the stream receives `previousQuestion: 'Q1'`.
4. `embed` throws `ClientError('restricted_region')`: the keys become `restricted`, search runs with `vector: null`, and the answer is `skipped` with error `restricted_region`.
5. `sampleVector`: `embed` is never called, and the source is `'sample'`.
6. **Review Focus #2:** the stream yields `'Revenue was $10.2 billion [1]. It gre'` and then throws `ClientError('upstream_quota')`. The status is `interrupted`, the text is kept, there's 1 check, and the keys become `exhausted`.
7. **Review Focus #4:** search returns no results. The answer is `skipped`, and `stream` is never called.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(app): session controller with streaming, citation checks and free re-search`

---

### Task 7: Answer column

**Files:** Create `src/app/components/{AnswerColumn,AnswerCard,AnswerText,TimingBar,Composer,SuggestedQuestions}.tsx`, `src/app/state/ui.ts`; Test `src/app/components/{AnswerText,Composer,TimingBar}.test.tsx`

**Interfaces:**
- Produces:
```ts
export interface UiState { view: 'ask' | 'scorecard'; highlighted: number | null; byokOpen: boolean;
  set(p: Partial<Omit<UiState, 'set'>>): void }
export const useUi: UseBoundStore<StoreApi<UiState>>;
export function AnswerText(p: { text: string; checks: SentenceCheck[]; streaming: boolean; onCite(n: number): void }): JSX.Element;
export function Composer(p: { onSubmit(q: string, followUp: boolean): void; hasTurns: boolean; busy: boolean }): JSX.Element;
export function TimingBar(p: { embedMs?: number; search?: SearchResponse['timings']; answerMs?: number }): JSX.Element;
```
**Rendering rules:**
- **`AnswerColumn`:** renders the latest turn: a small "Question" label above the question text (13.5 px, semibold), then `AnswerCard`, then `SuggestedQuestions`. The `Composer` is pinned to the bottom of the column. Earlier turns collapse into a one-line "Earlier: {question}" list above the latest.
- **`AnswerText`:**
  - Render the checked sentences, then the unchecked tail.
  - Each `[n]` becomes a chip `<button aria-label="Source n">n</button>` that calls `onCite(n)`.
  - Each unsupported number becomes `<mark data-flag title="Not found in cited passage">`.
  - A sentence with `missingCitation` ends with `<span data-uncited title="This sentence has no citation">`.
  - While streaming, a caret follows the text.
- **`AnswerCard`:**
  - Header: "Answer", "· n sources", the model label ("Gemma 4 · 26B" or "Gemma 4 · 31B"), a Copy button (plain text), and a Regenerate button.
  - Status lines, using `COPY` (Task 10): `interrupted` gets `COPY.interrupted` plus a "Retry" button; `error`/`skipped` gets the copy for its code; `stale` gets "Settings changed since this answer." plus "Regenerate".
- **`TimingBar`:** segments for embed (`#a78bfa`), search (`#38bdf8`, vector + keyword + fuse), rerank (`#f59e0b`), and answer (accent). Zero segments are hidden. The legend reads like `embed 180ms · search 9ms · rerank 410ms · answer 3.9s`.
- **`Composer`:**
  - A textarea with `maxLength={500}` that grows up to 4 lines.
  - Placeholder: "Ask about the 10-K filings…", or "Ask a follow-up…" once there are turns.
  - Active filters show as removable tokens.
  - A "Follow-up" toggle (on by default) appears when there are turns.
  - Enter submits; Shift+Enter inserts a newline.
  - Submit is disabled while busy or when the trimmed text is empty.
  - The counter `n/500` shows when n > 400.
- **`SuggestedQuestions`:**
  - With no turns: chips for all the samples.
  - After a turn: two samples that haven't been asked yet, under "Try also".
  - Clicking a chip calls `ask(q, { sampleVector })`.

- [ ] **Step 1: Write the failing tests**
- `AnswerText` with checks `[{text:'Revenue was $70 billion [1].', unsupportedNumbers:['$70 billion'], …}]` renders a chip "1", and a `mark[data-flag]` containing `$70 billion`. Clicking the chip calls `onCite(1)`.
- **Review Focus #5 (`Composer`):**
  - Pasting 600 characters leaves a value of length 500.
  - Whitespace-only text disables submit.
  - Enter submits the trimmed text; Shift+Enter doesn't submit.
  - The counter appears at 401 characters.
- `TimingBar`'s legend text is exact for `{embedMs:180, search:{vectorMs:5,keywordMs:3,fuseMs:1,rerankMs:410}, answerMs:3900}`.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(app): answer column with citation chips, flags, timing bar and composer`

---

### Task 8: Evidence panel (Sources and Trace)

**Files:** Create `src/app/highlight.ts`, `src/app/components/{EvidencePanel,SourceCard,TraceTable}.tsx`; Test `src/app/highlight.test.ts`, `src/app/components/{TraceTable,SourceCard}.test.tsx`

**Interfaces:**
- Produces:
```ts
export function highlightSegments(text: string, queryTerms: ReadonlySet<string>): Array<{ text: string; hit: boolean }>;
// split into word / non-word runs; a word is a hit when tokenize(word)[0] ∈ queryTerms
export function snippet(text: string, queryTerms: ReadonlySet<string>, maxChars?: number /* 280 */): string;
// window starting ~60 chars before the first hit; '…' added on cut sides; falls back to the opening text
export function rankDelta(r: RankedResult): number;   // r.fused.rank − r.finalRank (positive = moved up)
```
**Rendering rules:**
- **`SourceCard`:**
  - A `[n]` chip when the result is among the passages.
  - Ticker (mono, bold), "10-K · FY2025", and the title "Item 1A · Risk Factors".
  - The snippet, with `<mark>` on the hits.
  - Score pills: "BM25 #r", "Vec #r" (title `distance 0.1234`), "RRF .0323", and "Rerank .94" (accent).
  - A link "View filing on sec.gov ↗" with `target="_blank" rel="noopener noreferrer"`.
  - When `useUi.highlighted === n`: a ring, and `scrollIntoView({block:'nearest'})`.
- **`EvidencePanel`:**
  - Tabs: "Sources" (with a count badge) and "Trace".
  - Sources lists the passages first, then "More results" up to 20.
  - The Trace header reads `{n} results · {mode} · {metric} · {dims}d · k1 {k1} · b {b} · RRF k {rrfK}`.
- **`TraceTable`:** columns `#`, `Passage` (`TICKER FYyy · Item X`), `BM25`, `Vector` (rank · distance to 4 dp), `Fused` (4 dp), `Rerank` (2 dp), `Δ`. Δ shows "▲n" (ok color), "▼n" (destructive color), or "—".

- [ ] **Step 1: Write the failing tests**
- `highlightSegments('Export controls restrict', new Set(['export','control']))` gives hits on `Export` and `controls`.
- `snippet` puts the first hit inside the window and prefixes `…` when cut.
- `rankDelta({fused:{rank:2}, finalRank:1})` = 1, and the row shows "▲1".
- The `SourceCard` link attributes are exact.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(app): evidence panel with highlighted sources and ranking trace`

---

### Task 9: Header, command menu, model picker, view switch

**Files:** Create `src/app/components/{Header,CommandMenu,ModelPicker,ViewSwitch}.tsx`; Test `src/app/components/{CommandMenu,Header}.test.tsx`

**Interfaces:**
- Produces: `Header(p: { ready: boolean; chunkCount: number | null; facets: Facets | null; samples: Sample[] })`.

**Rendering rules:**
- **`Header`:**
  - The logo mark (an 18 px gradient `acc → acc2`) and "Filings Lens".
  - The command trigger: "Search companies, sections…" with a `⌘K` hint (`Ctrl K` off macOS).
  - The status pill: a green dot and "Postgres · 3,812 passages" (number from `chunkCount`, formatted `en-US`) when ready, otherwise a spinner and "Loading…".
  - `ModelPicker`, the key button, the theme button, and `ViewSwitch`.
- **`ModelPicker`:** options "Gemma 4 · 26B (fast)" and "Gemma 4 · 31B (deep, slower)". Choosing 31B shows `COPY.deepNote`.
- **Key button:** the `KeyRound` icon with `aria-label="Use my own key"`, and a dot badge when a key of their own is set. It opens `ByokDialog`.
- **Theme button:** `aria-label` is `Theme: system|light|dark` and the click calls `cycle()`.
- **`ViewSwitch`:** segmented "Ask" / "Scorecard", which sets `useUi.view`.
- **`CommandMenu`:**
  - Opens on ⌘K or Ctrl+K.
  - Groups: "Sample questions" (asks with the sample vector), "Companies" (labeled like `NVIDIA (NVDA)`; toggles the filter), "Sections" (toggles the item filter), and "Actions" ("Reset search settings", "Use my own key", "Toggle theme").

- [ ] **Step 1: Write the failing tests**
- Ctrl+K opens the dialog.
- Choosing "NVIDIA (NVDA)" adds `NVDA` to the ticker filters.
- `ViewSwitch` sets the view to `scorecard`.
- Choosing 31B shows the deep note.
- The theme button's label cycles.
- The status pill reads "Postgres · 3,812 passages" for 3812.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(app): header, command menu, model picker and view switch`

---

### Task 10: Copy, loading screen, banners, footer, app wiring

**Files:** Create `src/app/copy.ts`, `src/app/components/{LoadingScreen,Banners,Footer}.tsx`; Modify `src/app/App.tsx`; Test `src/app/components/{LoadingScreen,Banners}.test.tsx`, `src/app/App.test.tsx`

**Interfaces:**
- Produces `COPY` (exact strings):
```ts
export const COPY = {
  footer: "Not financial advice. Questions are processed by Google's Gemini free tier — don't enter personal information. Data: SEC EDGAR.",
  restricted: "Answers with our built-in key aren't available in your region (EEA, UK and Switzerland). You can still search, try the sample questions, run the scorecard, or use your own Gemini key.",
  exhausted: "Today's free answers are used up. Search still works — add your own free Gemini key to keep getting answers.",
  missing: "Answers are temporarily unavailable. Search still works — or use your own Gemini key.",
  keywordOnly: "No question embedding is available, so this search is keyword-only. Sample questions still use full hybrid search.",
  noMatches: "No passages matched. Try removing some filters.",
  rerankerUnavailable: "The reranker is still loading, so these results aren't reranked yet.",
  interrupted: "Answer interrupted.",
  noKey: "Answers need a Gemini key. Search still works — or use your own Gemini key.",
  byokInvalid: "Google rejected that key. Check it in Google AI Studio.",
  byokQuota: "Your key's free quota is used up for today.",
  network: "Network error. Check your connection and try again.",
  upstreamError: "Google's API returned an error. Try again in a moment.",
  deepNote: "Deep answers use Gemma 4 31B and can take up to a minute.",
  loadFailed: "Couldn't load the filings data. Reload the page to try again.",
} as const;
```
**Rendering rules:**
- **`LoadingScreen`:** one label per phase:
  - `manifest`: "Fetching manifest"
  - `download`: "Downloading filings data — 1.0 / 8.0 MB" (MB = bytes / 1e6, 1 dp), plus a progress bar
  - `database`: "Building the database (PGlite)"
  - `keyword-index`: "Indexing keywords (BM25)"
  - `vectors`: "Loading vectors"
  - On error: `COPY.loadFailed` and a "Reload" button.
- **`Banners`:** show at most one, in priority order `restricted` > `exhausted` > `missing`, and only when no key of the visitor's own is set. Each has a "Use my own key" button. The evidence area shows `keywordOnly`, `noMatches`, or `rerankerUnavailable` based on the latest turn's `notes`/`vectorSource`.
- **`App`:**
  1. On mount, call `getEngine().init(proxy(onProgress))` and keep the progress.
  2. Run `fetchStatus()` and call `markBuiltin(builtInKey)`; on failure, leave the status `unknown`.
  3. Once ready, call `getEngine().loadReranker(proxy(…))` in the background, and load `samples()`.
  4. Subscribe to `useSettings`, debounced 150 ms, and call `useSession.getState().rerun()` when there are turns.
  5. Render `AppShell`: `Header`, `SettingsPanel`, `AnswerColumn` or `ScorecardView` (by `useUi.view`), `EvidencePanel`, `Banners`, and `Footer`.

- [ ] **Step 1: Write the failing tests**
- The `LoadingScreen` text for `{phase:'download', loadedBytes:1e6, totalBytes:8e6}` is exact.
- Banners priority: restricted over exhausted; nothing shows when a key of their own is set.
- The footer text equals `COPY.footer`.
- `App`, with a mocked engine module (`vi.mock('@/engine')`) and `fetchStatus` returning `restricted`, shows `COPY.restricted` after ready.
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Manual check.** Run `npm run dev:api` and `npm run dev`. The app loads the real data, the NVIDIA sample streams a cited answer, the reranker status reaches "ready", and both themes and the <1024 px layout look like the mockup. Also read `keywordMs` in the Trace tab for 5 typed questions. If the typical value is over 100 ms, apply Plan 1 Task 4's decision rule and move BM25 scoring to TypeScript.
- [ ] **Step 6: Commit.** `feat(app): loading screen, banners, footer and app wiring`

---

### Task 11: Scorecard view

**Files:** Create `src/app/components/ScorecardView.tsx`; Test `src/app/components/ScorecardView.test.tsx`

**Interfaces:**
- Consumes: `WorkerApi.scorecard`, `ScorecardResult`, `useSettings`, and the reranker status.

**Rendering rules:**
- Title "Scorecard".
- Subtitle (exact, with `{count}` from the eval file): "How well search finds the right passages for {count} reviewed test questions. Runs entirely in your browser with precomputed question embeddings; filters are ignored."
- A "Run scorecard" button. While the reranker isn't ready, its label is "Run (without rerank)" and the `hybrid+rerank` row reads "Waiting for reranker…".
- The progress line reads "{done} / {total} runs".
- The table has rows "Your settings", "Vector only", "Keyword only", "Hybrid", and "Hybrid + rerank", and columns Recall@5, Recall@10, MRR@10, and nDCG@10 (3 dp). The best value in each column is bold.
- A collapsible "Per question" list shows each question and the rank of its first correct passage for each baseline, or "—" if it isn't in the top 10.

- [ ] **Step 1: Write the failing tests**
- With a fake engine whose `scorecard` resolves a fixed `ScorecardResult`, the rows render with exact labels and values, and the bold cell holds each column's maximum.
- The button calls `scorecard` with the current settings.
- The progress callback updates "3 / 10 runs".
- [ ] **Step 2: Run to make sure they fail.** **Step 3: Implement.** **Step 4: Run to make sure they pass.**
- [ ] **Step 5: Commit.** `feat(app): in-browser scorecard view`

---

### Task 12: Key-leak check, deployment, README, end-to-end smoke

**Files:**
- Create: `scripts/check-bundle.mjs`, `scripts/check-bundle.test.ts`, `playwright.config.ts`, `e2e/smoke.spec.ts`, `README.md`
- Modify: `vercel.json`, `package.json`

**Interfaces:**
- **`check-bundle.mjs`:**
  - Usage: `node scripts/check-bundle.mjs [distDir=dist]`.
  - Scans `**/*.{js,mjs,css,html,map,json}` for:
    - `GEMINI_API_KEY`
    - `/AIza[0-9A-Za-z_-]{35}/`
    - `/AQ\.[0-9A-Za-z_-]{20,}/`
    - the literal value of `process.env.GEMINI_API_KEY`, when that's set and at least 20 characters
  - Prints the offending files and exits 1; otherwise prints `bundle clean` and exits 0.
- **Scripts:** `"build": "tsc --noEmit && vite build && node scripts/check-bundle.mjs"`, `"e2e": "playwright test"`.
- **`vercel.json`:** add `"framework": "vite"`, `"buildCommand": "npm run build"`, `"outputDirectory": "dist"`, and:
```json
"headers": [
  { "source": "/data/manifest.json", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
  { "source": "/data/v/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
]
```

- [ ] **Step 1: Write the failing tests**
- `check-bundle.test.ts`:
  - A temp dist containing `const k="AIza` + 35 characters + `"` exits 1 and names the file.
  - A clean dist exits 0. Run it with `child_process.spawnSync`.
- `e2e/smoke.spec.ts`:
  - Run against `vite preview` on port 4173. Playwright's `webServer` runs `npm run build && npx vite preview --port 4173`.
  - Mock `/api/**` with `page.route`: status → `available`. Answer → the SSE body `data: {"type":"delta","text":"NVIDIA says export rules require licenses [1]."}` then `data: {"type":"done"}`.
  1. Within 60 s, the status pill matches `/Postgres · [\d,]+ passages/`.
  2. Clicking the first sample chip shows ≥5 source cards and an answer containing the `Source 1` chip.
  3. **Review Focus #3:** switching Metric to Euclidean makes "Settings changed since this answer." appear, and the `/api/answer` request count stays 1.
  4. With a fresh page where status is mocked `restricted`: `COPY.restricted` is visible. Asking a typed question shows `COPY.keywordOnly`, and no `/api/embed` request is made.
- [ ] **Step 2: Run to make sure they fail.** `npx vitest run scripts/check-bundle.test.ts` and `npx playwright install chromium && npm run e2e`: FAIL.
- [ ] **Step 3: Implement** the script, the config, and the README. Use exactly these README headings:
  - Filings Lens
  - Live demo
  - What it does
  - Architecture (the spec's ASCII diagram, updated for the in-browser rebuild)
  - How search works (vector math · BM25 in SQL · RRF · reranker)
  - Why the metric switch doesn't change the order (until you shorten the vectors)
  - Scorecard (table copied from a local Scorecard run). If hybrid + rerank doesn't beat vector-only, say so plainly; it's a finding, not a failure.
  - Cost: $0
  - Run it locally
  - Data and attribution (SEC EDGAR)
  - Limitations (free tier, regional rule)
- [ ] **Step 4: Run to make sure they pass.** `npm test && npm run build && npm run e2e` should all be green, ending with `bundle clean`.
- [ ] **Step 5: Commit.** `feat: key-leak build check, Vercel config, README and e2e smoke test`
- [ ] **Step 6 (owner actions, deployment; each needs the owner's go-ahead)**
  1. Push the repo to a public GitHub repository.
  2. Import it into Vercel (Hobby plan, framework Vite).
  3. Set these environment variables:
     - `GEMINI_API_KEY`: the new, dedicated key
     - `ALLOWED_ORIGINS`: the production URL(s)
     - `IP_HASH_SALT`: 32 random characters
     - `VISITOR_DAILY_REQUESTS`, `GLOBAL_DAILY_ANSWERS`, and `GLOBAL_DAILY_EMBEDS`: set below the per-day limits shown at aistudio.google.com/rate-limit for `gemma-4-26b-a4b-it` and `gemini-embedding-2`
  4. Storage → Marketplace → Upstash Redis (free plan), connected to the project.
  5. Firewall → New Rule "API rate limit":
     - If: path starts with `/api/`.
     - Then: Rate Limit, fixed window of 60 s, 20 requests, keyed by IP, with a 429 response. Hobby allows one rate-limit rule.
  6. Optional: add `rag.dakselrod.com` as a CNAME to `cname.vercel-dns.com`.
- [ ] **Step 7: Production verification**
- On a fresh private-window visit, DevTools shows ≤ ~15 MB transferred before the reranker starts, and the app is ready in ≤ ~10 s.
- The NVIDIA sample streams a cited answer.
- Changing settings sends no `/api` request.
- With rerank off, results visibly re-order within 300 ms of a setting change (compare `SearchResponse.timings` in the Trace tab).
- `curl -s https://<prod>/api/status` returns `available` from a US connection.
- Paste the measured transfer size and the Scorecard table into the README, then commit.
- [ ] **Step 8:** Use superpowers:finishing-a-development-branch to merge or open a PR.

---

## Plan 3 done when

- `npm test`, `npm run build` (ending in `bundle clean`), and `npm run e2e` are green.
- The production URL loads within budget and answers with citations.
- Restricted regions see the fallback experience.
- The README has real Scorecard numbers.
