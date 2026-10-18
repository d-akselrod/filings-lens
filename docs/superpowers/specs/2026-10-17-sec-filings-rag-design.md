# Filings Lens: SEC filings RAG demo, design

Date: 2026-10-17 · Status: draft, awaiting owner approval
Working name: **Filings Lens** (placeholder, easy to rename)

Labels used below:
- **[owner]** decided by the project owner in conversation.
- **[my call]** proposed by the designer and not objected to. The owner should check these.
- **[builder]** deliberately left to whoever plans and builds it.

---

## 1. What this is and why

A portfolio project: a public demo website that answers questions about the annual reports (Form 10-K) of the largest U.S. tech companies. Every answer cites the exact passages it came from.

The point is to show recruiters and engineers that the owner can build retrieval-augmented generation (RAG) from first principles, not by wiring up a framework:
- hand-written vector distance math
- hand-written keyword search (BM25)
- hand-written merging of the two result lists
- a reranker
- a real database

All of it runs in the visitor's browser. The site costs nothing to host and nothing to run.

Visitors can change search and rerank settings and watch the results change. That transparency is the feature that sets it apart from the many "chat with a 10-K" demos.

## 2. Goals

1. **Cited answers.** Answer plain-English questions about the selected 10-Ks. Answers stream in with numbered citations to exact passages. [owner]
2. **Retrieval runs in the browser.**
   - The database is PGlite (Postgres compiled to WebAssembly). [owner]
   - Vector distance math (Euclidean/L2, cosine, dot product) is hand-written. [owner]
   - BM25 and result merging are hand-written. [owner, "built manually"]
   - No vector-search library, no RAG framework, and no hosted vector database.
3. **Hybrid search.** Vector search and BM25 are merged, then re-scored by a reranker that runs in the browser. [owner wanted a reranker; running it in the browser is my call]
4. **Live settings.** Search and rerank settings can be changed live. [owner] Changing a setting re-runs the search instantly with no API cost. [my call]
5. **Scorecard.** A fixed set of test questions with known source passages shows retrieval accuracy under the current settings. It runs in the browser with no API calls. [owner said yes; details are my call]
6. **$0 total cost:** the Gemini API free tier (Google AI Studio), the Vercel Hobby plan, and free public data. [owner]
7. **Look.** A clean, modern, enterprise-looking UI: "Layout A, modernized" (§7). [owner]

## 3. Non-goals (v1)

- Filing types other than 10-K (no 10-Q, 8-K, or proxy statements). Companies beyond the seven in §6.2. Live updates when new filings appear.
- User accounts, uploading your own documents, or saved history across visits.
- LLM-graded answer quality. It would spend API quota; it's a possible later addition.
- Any investment advice.
- LangChain, LlamaIndex, Orama, hosted vector databases, or pgvector's distance operators in the app's search path. pgvector may be used only in tests, as a correctness check (§6.3).

## 4. Anti-goals (a failure even if it technically works)

- Numbers or claims shown without a citation, or citations that don't support the claim. The live safeguard is the citation check in §6.4.
- The Gemini API key reachable from the browser in any form.
- The demo breaking silently (key blocked, quota used up, model error) instead of degrading gracefully with a clear message and a bring-your-own-key option.
- A control that appears to do nothing without an explanation. One example is the metric switch (§6.3).
- A first visit that looks broken. The site must show progress immediately and be usable within about 10 s on broadband. Everything except the reranker model should total at most ~15 MB compressed. The reranker loads lazily after first paint.

## 5. Constraints and verified facts

### Decided in conversation [owner]
- **Hosting:** Vercel, Hobby plan (free). Netlify was rejected because its free functions time out after ~10 s and its credit-based free plan pauses sites.
- **Frontend:** React. Not Astro, even though the owner's portfolio site uses Astro.
- **Database:** PGlite, running in the browser.
- **Distance math:** Euclidean (L2), cosine, and dot product, all hand-written.
- **Corpus:** SEC filings of mega-cap companies.
- **Models:**
  - Generation: Gemma 4 through the Gemini API free tier, using Google AI Studio keys.
  - Embeddings: `gemini-embedding-2`.
  - The owner switched away from `gemini-3.8-flash`, whose free tier is reportedly about 20 requests/day.
- **API key:** the key must stay secret. It lives in a Vercel environment variable, used by one small Vercel Function. Visitors can bring their own key for extra usage.
- **Regional rule:** the built-in key is switched off for visitors in the EEA, the UK, and Switzerland. The owner chose this over paying for those visitors or accepting the terms risk. See §6.4.

### Verified on 2026-10-17 with the owner's free-tier key
- **`gemini-embedding-2`:**
  - Works. Returns 768-dim vectors when `outputDimensionality: 768` is passed, already normalized (norm = 1.0).
  - No `task_type` parameter; it uses text prefixes instead. Queries: `task: search result | query: {text}`. Documents: `title: {title} | text: {content}`.
  - Max 8,192 input tokens. Multimodal input is supported but not needed here.
- **`gemma-4-26b-a4b-it`** (mixture-of-experts): answered a tiny cited-answer prompt in **~4 s** (1 sample).
- **`gemma-4-31b-it`** (dense): the same prompt took **48 s and 84 s** (2 samples).
- **Both Gemma models:**
  - Accept a `systemInstruction`.
  - Always "think" first (~150 tokens). `thinkingBudget` returns HTTP 400 ("not supported for this model").
  - Neither lists `createCachedContent`.
- **Free tier:**
  - Google may use free-tier prompts and responses to improve its products.
  - Limits apply per Google Cloud project and reset at midnight Pacific.
  - Exact Gemma and embedding limits appear only in AI Studio (aistudio.google.com/rate-limit). Check them before setting the caps in §6.4.
- **Vercel Hobby:** free, for non-commercial use only. Includes 1M function invocations/month and a function max duration of 300 s.
- **Google's API-key guidance:** never ship keys in client code, because they can be extracted. Use a backend proxy instead.
- **Regional restriction** (found during the design review; from the Gemini API terms' use restrictions, effective 2026-03-23):
  - Apps made available to users in the EEA, the UK, or Switzerland may use only Paid Services.
  - Gemma 4 has no paid tier on the Gemini API.
  - See "Regional rule" in §6.4.

## 6. How it works

### 6.1 The two halves

```
OFFLINE (owner's machine, run once; re-runnable)
EDGAR ─► fetch 10-K HTML ─► split into Items ─► chunk ─► embed (gemini-embedding-2, 768-d)
      ─► build PGlite database (chunks, metadata, vectors, BM25 tables) ─► export snapshot
      ─► ship snapshot as a static asset with the site

IN THE BROWSER
load snapshot into PGlite (cached in IndexedDB) ─► load vectors into memory
question ─► embed query (Vercel Function, or the visitor's own key)
        ─► vector scan (hand-written)  ┐
        ─► BM25 (hand-written)          ┴► merge (RRF) ─► rerank (in-browser cross-encoder)
        ─► top passages ─► answer (Vercel Function or the visitor's own key), streamed, with citations
```

### 6.2 Corpus and ingestion

**Scope** [my call]
- Companies: Apple (AAPL), Microsoft (MSFT), NVIDIA (NVDA), Alphabet (GOOGL), Amazon (AMZN), Meta (META), and Tesla (TSLA).
- Filings: each company's three most recent 10-Ks at build time, 21 filings in all.
- Fiscal years end on different dates by company (NVIDIA's ends in late January, Microsoft's in June). Always label a filing by its own fiscal year and period-end date.

**Source**
- SEC EDGAR's free public APIs: the submissions JSON to find 10-K filings, and the EDGAR Archives for each filing's primary HTML document.
- Follow SEC fair-access rules: send a descriptive `User-Agent` with a contact email, and make at most 10 requests per second.

**Parsing**
- Convert the HTML to clean text.
- Split it into the standard 10-K Items (1, 1A, 1B, 1C, 2, 3, 5, 7, 7A, 8, 9A, …).
- Convert tables to plain-text rows so the numbers survive.
- Drop the cover page, signatures, and exhibit index.
- Expect each company's HTML to have quirks. The pipeline must report anything it couldn't parse, never skip it silently.

**Chunking** [my call; sizes are for the builder to tune]
- Chunks never cross a section boundary.
- Target about 400–600 tokens per chunk with about 15% overlap. Never split a table row.
- Each chunk stores:
  - company name, ticker, and form type
  - fiscal year, period end, filing date, and accession number
  - Item number and title, and its position within the section
  - a link to the filing on sec.gov

**Embedding**
- Model: `gemini-embedding-2` at 768 dimensions.
- Each chunk uses the document prefix, with a title like "NVIDIA 10-K FY2025 — Item 1A Risk Factors".
- Cache embeddings on disk, keyed by content hash, so reruns cost nothing and the job can resume.
- Back off and resume on HTTP 429. The free tier may spread this job over hours or days.
- Expected size: roughly 1–2M tokens, or about 3–4K chunks.

**Output**
- A PGlite data-directory snapshot (PGlite can export and import one) plus small JSON manifests.
- A Vercel build must never need secrets or network access to EDGAR or Gemini. The snapshot is either committed or produced locally and uploaded with the deploy. [builder]

**Language:** TypeScript on Node, in the same repo. [my call]

### 6.3 Search engine (in the browser)

Everything here runs in a Web Worker, so the UI never freezes.

**Storage**
- PGlite holds companies, filings, chunks, vectors, BM25 postings, and corpus statistics.
- It persists to IndexedDB, so return visits skip the download.
- The schema should make sense to an engineer reading the repo: real tables, keys, and indexes.

**Vector search** (hand-written TypeScript) [owner: hand-written math; implementation details my call]
- At startup, read every vector out of PGlite into one contiguous `Float32Array`, plus small metadata arrays (company, year, section) for filtering.
- **Metrics:**
  - Euclidean (L2) distance
  - cosine distance
  - dot product
- **Dimensions setting:** use the first N of the 768 stored dimensions (Matryoshka truncation), with N ∈ {128, 256, 512, 768}. A **re-normalize** toggle sits next to it.
- **The UI must explain the metric behavior** (anti-goal: controls that seem to do nothing).
  - On normalized vectors, all three metrics produce the *same ranking*; only the scores differ.
  - They diverge once vectors are truncated *without* re-normalizing.
  - That explanation is part of the demo's value.
- **Algorithm:** a brute-force exact scan over the chunks that pass the filters (a few thousand × 768 floats, which takes milliseconds). It returns the top "candidates" (setting, default 50).
- **Correctness tests:** unit tests compare our three distance functions against pgvector's `<->`, `<=>`, and `<#>` operators in PGlite (which runs in Node), within float tolerance. pgvector appears *only* in tests. [my call]

**Keyword search (BM25)**, hand-written [owner: manual; SQL placement is my call]
- **Tokenizer:**
  - Lowercase. Split on anything that isn't a letter or digit.
  - Keep numbers and tickers. Apply a stopword list.
  - Stemming is optional. [builder]
  - The offline pipeline and the browser must share exactly the same tokenizer code.
- **Storage:** postings live in PGlite: term → chunk → term frequency, plus each chunk's length and corpus-level statistics.
- **Scoring:** the BM25 formula is written by hand in SQL, with `k1` and `b` passed in as parameters. This gives PGlite a real job and shows SQL skill.
- **Fallback:** if that measures slower than ~100 ms for typical queries, the builder may move scoring to TypeScript with an in-memory inverted index. Record which way it went and why in the README.

**Merging (fusion)**
- Reciprocal Rank Fusion with parameter `k` (default 60).
- An optional weight α between the vector list and the keyword list. [my call]
- Modes: vector only, keyword only, hybrid.

**Reranker**
- A small cross-encoder running in the browser through transformers.js. It uses WebGPU when available and falls back to WASM.
- It should be a model on the order of ms-marco-MiniLM-L-6-v2, at most ~40 MB. It loads lazily after first paint, and the browser caches it.
- It re-scores the top N merged results. Settings: on/off, and N (default 20).
- Exact model choice [builder], judged on quality, size, and speed. It must run in the browser.

**Filters:** company, fiscal year, and section, applied before scoring in both searches.

**When no query embedding is available** [my call]
- This covers three cases: the built-in quota is used up, the visitor has no key of their own, or the built-in key isn't allowed in the visitor's region.
- New questions then run keyword search (BM25) plus rerank only. The vector and hybrid controls show a short notice explaining why.
- The suggested sample questions ship with precomputed query embeddings, so the full hybrid pipeline still runs for them.
- The scorecard is unaffected, because its embeddings are precomputed too.
- No second, in-browser embedding model in v1.

**Defaults** (tunable later): cosine, 768 dimensions, 50 candidates per search, `k1` = 1.2, `b` = 0.75, RRF `k` = 60, rerank on with top 20, 6–8 passages sent to the model.

### 6.4 Answer generation

**One Vercel Function (Node), with two operations** [owner: function holds the key; operation design is my call]
1. **embed:** takes the question (capped at ~500 characters) and returns a 768-dimension vector.
2. **answer:**
   - Takes the question, the chosen chunk IDs (at most ~10), the model choice, and optionally the previous question.
   - It looks up the chunk text itself, from a copy of the corpus text bundled with the function.
   - It builds the prompt with a fixed system instruction, calls Gemma, and streams the answer back.
- **Why IDs instead of text:** the endpoint must not double as a free, general-purpose LLM proxy. The only free text it accepts is the capped question.

**Models**
- Default: `gemma-4-26b-a4b-it` ("Fast").
- Optional: `gemma-4-31b-it` ("Deep"), with a visible warning that it can take a minute. [owner asked for 31B; 26B as default is my call, based on measured latency]

**Prompt rules**
- Answer only from the provided passages, and cite them as [n].
- Say plainly when the passages don't cover the question.
- Give no investment advice.
- Quote numbers as they appear, along with their period and units.

**Citation check** [my call]
- Answers still stream token by token. As each sentence finishes, a deterministic checker runs on it. The same module serves the function path and the bring-your-own-key path.
- It checks two things:
  - The sentence carries at least one valid [n]. Sentences that make no factual claim are exempt, such as "The passages don't cover this."
  - Every number in the sentence appears in at least one passage that sentence cites. Numbers are compared after normalizing commas, %, $, and words like "billion".
- Violations are **flagged in place, not removed**: a subtle warning mark with the tooltip "not found in cited passage". The Trace tab lists the check results.
- Unit tests cover the checker.

**Streaming:** stream tokens to the browser. If the Gemini API doesn't support streaming for Gemma, show staged progress and render the answer when it's complete. [builder: verify]

**Follow-ups:** the search query for a follow-up is the previous question plus the follow-up. This costs no extra API call. The function also gets the previous question as context. [my call]

**Abuse limits** (free-tier tools only)
- A per-visitor daily cap.
- A global daily budget set below the project's free quota.
- An `Origin` check and input-size limits.
- How it's implemented is [builder]. One option is Vercel's firewall rate limiting, if the Hobby plan offers it; otherwise a free Upstash Redis database through the Vercel Marketplace.
- Exact numbers wait until the AI Studio quotas are checked.

**Regional rule** [owner]
- The built-in key is never used for visitors in the EEA (the 27 EU members plus Iceland, Liechtenstein, and Norway), the UK, or Switzerland.
- The function reads the visitor's country from Vercel's geolocation header (`x-vercel-ip-country`) and refuses both operations for those countries. It returns a distinct, machine-readable reason, not a generic error.
- If the country is unknown, it's treated as restricted, so the check fails closed. [my call]
- Those visitors see a short, polite explanation. They can still use:
  - keyword search plus rerank
  - the sample questions (full hybrid search, precomputed)
  - the scorecard
  - bring-your-own-key
- [builder] decides how the UI learns the restriction: up front through a lightweight status call at load, or from the first refusal.
- Test: requests with a spoofed restricted-country header never reach Google on the built-in key.

**Bring your own key** [owner]
- When the built-in quota runs out (HTTP 429) or the key fails, the UI offers a field for the visitor's own free Gemini key, with a link explaining how to get one.
- The key is stored in `sessionStorage`, or in `localStorage` only if the visitor ticks "remember on this device".
- It's sent only directly from the browser to Google, never to our function.
- In this mode the browser builds the prompt itself, using the chunk text it already has in PGlite. The prompt code is a module shared with the function, so both paths behave the same.

**Key hygiene** [my call]
- Create a new key in a dedicated Google Cloud project, restricted to the Gemini API.
- Store it only in Vercel environment variables and a git-ignored `.env.local`.
- The key that was pasted into the design chat must be retired.
- Add a test or build check that fails if the key string or variable name ends up in the client bundle.

### 6.5 Scorecard [owner: include it; details my call]

- **Test set:** about 40 test questions, each with one or more known "gold" passages (chunk IDs). They span all seven companies, several sections, and several styles: numbers, risks, strategy, and comparisons.
- **How it's built:** offline. An LLM drafts candidate questions from chosen passages, and the owner reviews them, keeping and editing about 40 (every kept question is checked by a human). FinanceBench, an open benchmark of analyst questions over 10-Ks, can be borrowed from where it overlaps with these companies and years.
- **No API calls:** the test questions' embeddings are computed offline and shipped with the site.
- **Metrics:**
  - Recall@5, Recall@10, MRR@10, and nDCG@10 under the current settings.
  - A comparison table of four baselines: vector only, keyword only, hybrid, and hybrid + rerank.
  - With rerank on, a run can take tens of seconds on WASM, so show progress.
- **Where:** a "Scorecard" view, switched from the header. The left settings panel stays visible, so changing a setting updates the numbers.
- **Honesty:** if hybrid + rerank doesn't beat vector-only, the README says so. That's a finding, not a failure.

## 7. UI: Layout A, modernized [owner chose; details my call]

Reference mockups: `.superpowers/brainstorm/75632-1792278100/content/layout-v2.html`. The first round of options is in `layout.html`; the owner chose A and asked for it to look more modern.

**Header**
- Product name.
- ⌘K quick search to jump to a company or section.
- Database status pill, e.g. "Postgres · 3,812 passages".
- Model picker (Fast/Deep).
- Key button (bring your own key).
- Theme toggle.
- Ask / Scorecard switch.

**Left panel**
- Company toggle tiles.
- Fiscal year.
- Vector search: metric segmented control, dimensions slider with the re-normalize toggle, candidates.
- Keyword: `k1` and `b` sliders.
- Merge: mode, RRF `k`, and weight.
- Rerank: on/off switch and top N.
- Reset to defaults.

**Middle**
- The question.
- An answer card with:
  - citation chips
  - copy and regenerate buttons
  - a timing bar for each step (embed, search, rerank, answer)
- Suggested follow-ups.
- An input pinned to the bottom, with the active filters shown as tokens.

**Right panel**
- **Sources tab:**
  - the top passages, with keyword matches highlighted
  - score pills for BM25 rank, vector rank, merged score, and rerank score
  - clicking a citation chip highlights the matching card
  - each card links to the filing on sec.gov
- **Trace tab:** the full ranking table across stages, with rank movement.

**Theme:** follows the visitor's system setting, with a toggle. Both light and dark must look finished.

**First load:** a progress screen that names what's loading (database, vectors, reranker).

**Mobile:** the side panels become drawers. The main screen keeps the question, the answer, and the sources.

**Notices:**
- "Not financial advice."
- "Questions are processed by Google's Gemini free tier. Don't enter personal information."
- Credit to SEC EDGAR as the data source.

**Visual style:**
- Neutral grays with one indigo accent.
- Inter for text, plus a monospace font for numbers.
- Rounded cards, subtle shadows, and calm density.
- The component library is [builder]; Tailwind with Radix/shadcn-style primitives would fit.

## 8. Stack [my call unless marked]

- React [owner] + TypeScript + Vite.
- Tailwind, plus accessible component primitives.
- PGlite [owner] inside a Web Worker, persisted to IndexedDB.
- transformers.js for the reranker.
- `@google/genai` (or plain REST) in the function and in the bring-your-own-key path.
- Vercel [owner]: a static site plus one function.
- Vitest for unit tests (distance math, BM25, RRF, metrics, tokenizer parity). One Playwright smoke test is optional.
- A public GitHub repo. The README covers the architecture diagram, scorecard results, design choices (including the metric-equivalence note), and the $0 cost breakdown.
- **Domain:** Vercel's default domain. Optionally a subdomain of the owner's site, such as `rag.dakselrod.com`; the main portfolio site stays on GitHub Pages.

## 9. Success criteria

- **Free and open:** the live site works for a first-time visitor with no login, at $0 cost.
- **Answer speed:** a question gets a streamed, cited answer within ~10 s on the default model, not counting the first load.
- **Instant settings:** changing any search setting visibly re-ranks results in under ~300 ms with rerank off, and the change is shown.
- **Scorecard:** it runs fully in the browser and reports all four baselines.
- **Correct math:** the distance functions match pgvector within tolerance in tests.
- **No key in the client:** an automated check confirms the key is absent from the client bundle.
- **Regional rule:** visitors from the EEA, the UK, Switzerland, or an unknown country never cause a call on the built-in key. Tests prove it, and those visitors get the fallback experience in §6.4.
- **Graceful failure:** when the quota runs out or the key fails, the visitor sees a clear message and the bring-your-own-key path, never a raw error. Keyword search, the sample questions, and the scorecard keep working (§6.3).

## 10. Left to the builder

- Exact reranker model.
- Tokenizer and stemmer details.
- Final chunk size and overlap.
- Storage precision of the vectors (float32 vs float16) within the download budget.
- How the snapshot is produced and shipped.
- Rate-limit mechanism and exact caps.
- Component library.
- What ⌘K searches.
- Whether BM25 scoring stays in SQL, decided by measured speed.
- Exact visual polish, within §7.

## 11. Known risks

- **10-K HTML parsing quirks:** the biggest data risk. The pipeline must report failures clearly.
- **Unknown free-tier quotas:** embedding the corpus may take days, which is why the pipeline is resumable.
- **Live quota:** the per-visitor cap and bring-your-own-key protect the demo.
- **Gemma streaming:** support through the Gemini API is unverified.
- **Free-tier changes:** Google may change the free tier at any time. Keyword search, the sample questions, and the scorecard keep working without any API, and bring-your-own-key covers the rest.
- **Phones:** PGlite plus the reranker may be slow on low-end phones. Keep the reranker optional and lazy-loaded.

## 12. Changes made during planning (2026-10-17)

These come from measurements taken while writing the build plans. The plans in `docs/superpowers/plans/` carry the details.

- **No PGlite snapshot file.** An empty PGlite snapshot alone is 4.7 MB gzipped. Instead, the site ships compact data files (corpus JSON plus float16 vectors), and the browser rebuilds the database at load; this took ~2 s in Node. PGlite still holds every table, including the vectors and the BM25 index.
- **In-memory PGlite instead of IndexedDB.** Return visits still skip the download, because the data files are hash-named and cached by the browser. This also avoids multi-tab locking.
- **The reranker always runs on WASM** with 8-bit weights (23 MB). WebGPU would need a different weight file and would make Scorecard numbers differ between devices.
- **Three tiny API entry points** (`status`, `embed`, `answer`) share one handler module. `status` lets the UI show the regional or key state before anyone asks a question.
- **The restricted-region list has 32 country codes, plus a few territories.** The count is EU 27 + Iceland, Liechtenstein, Norway + Switzerland + UK.
- **Embeddings moved to NVIDIA Nemotron 3 Embed 1B on OpenRouter's free tier** [owner, during the build]. Gemini's free embedding quota counts each text (1,000 a day), so the corpus would have taken five days. OpenRouter's free tier counts requests (50 a day), so the whole corpus embedded in one run of 34 batched requests. Vectors are sliced from 2,048 to 768 dimensions and re-normalized (the model card allows this), keeping the download budget. Queries use the `query: ` prefix and passages `passage: `. The browser always embeds questions through `/api/embed`; a visitor's own Gemini key now only affects answers. Trade-off: typed questions get vector search for at most 50 requests a day across the site, then fall back to keyword search; sample questions are unaffected.
- **Answers use Gemma 4 26B only** [owner, after launch]. The optional 31B ("Deep") model and the header's model menu are gone; the header now just names the model. The answer API still takes `model: "fast"` and rejects anything else, including the old `"deep"`.
