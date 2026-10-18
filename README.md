# Filings Lens

Ask questions about the Magnificent 7's annual reports and see exactly how the answer was found. Retrieval-augmented generation over SEC 10-K filings, with the search engine built by hand and running in your browser.

## Live demo

Not deployed yet. The link goes here once the full corpus is embedded and the Vercel deployment is verified.

## What it does

- Answers questions about the last three 10-K filings of Apple, Microsoft, NVIDIA, Alphabet, Amazon, Meta and Tesla (21 filings, 4,443 passages).
- Every sentence cites its passages. Numbers that don't appear in the cited passages are flagged, and sentences without a citation are marked.
- Every search setting can be changed live: distance metric, vector dimensions, BM25 `k1` and `b`, fusion mode and weights, reranking, filters. Changing one re-runs the search instantly in your browser, with no API call, and marks the old answer stale.
- The Sources tab shows every stage's score for each passage (BM25 rank, vector rank and distance, fused score, rerank score). The Trace tab shows the full ranking table and how far reranking moved each result.
- A Scorecard measures retrieval quality (Recall@5/10, MRR@10, nDCG@10) on reviewed test questions, for your settings and four baselines, entirely in the browser.

## Architecture

```
OFFLINE (owner's machine; re-runnable, cached, resumable)
EDGAR ─► fetch 10-K HTML ─► split into Items ─► chunk (≤600 tokens, 75 overlap)
      ─► embed (gemini-embedding-2, 768-d) ─► corpus.<hash>.json + vectors.<hash>.f16 (float16)
      ─► ship as static files under /data with a manifest

IN THE BROWSER (Web Worker)
download manifest, corpus and vectors ─► rebuild PGlite (Postgres in WASM) in memory
                                       ─► build BM25 postings tables
question ─► embed query (Vercel Function, or the visitor's own key)
        ─► vector scan (hand-written)  ┐
        ─► BM25 (hand-written SQL)      ┴► merge (RRF) ─► rerank (cross-encoder, WASM threads)
        ─► top passages ─► answer (Vercel Function or the visitor's own key), streamed, with citations

VERCEL FUNCTIONS (the built-in key never reaches the browser)
/api/status  region + key availability     /api/embed   query embedding
/api/answer  Gemma 4 answer over the passages the client names by chunk id, streamed as SSE
```

- The database is rebuilt in the browser from the data files rather than shipped as a Postgres snapshot: an empty PGlite data directory alone is 4.7 MB compressed.
- The functions hold their own copy of the corpus, so the browser sends chunk ids, never passage text, and an answer is refused if the browser's data version differs from the server's.

## How search works

- **Vector math.** Hand-written cosine, Euclidean (L2) and dot-product scans over float16 vectors in a typed array. Vectors can be shortened to 128/256/512 dimensions (Gemini's embeddings are Matryoshka-trained) and optionally re-normalized.
- **BM25 in SQL.** The keyword index is plain Postgres tables: a `terms` table of postings stored as integer arrays, plus per-chunk lengths. Scoring is one SQL query with tunable `k1` and `b`. The tokenizer (NFKC, stopwords, Porter stemming) is shared by indexing, querying and highlighting.
- **Fusion.** Reciprocal Rank Fusion with a tunable `k` and a vector weight α. Filters (company, fiscal year, section) apply before scoring in both searches.
- **Reranker.** `Xenova/ms-marco-MiniLM-L-6-v2` (8-bit, 23 MB) runs in the worker through transformers.js on WASM, scoring the top N fused results. The site is served cross-origin isolated (COOP/COEP) so the WASM runtime can use several threads: 20 passages take about 2 s instead of 7 s.

## Why the metric switch doesn't change the order (until you shorten the vectors)

Gemini's vectors are normalized to length 1. For unit vectors, Euclidean distance is a function of cosine similarity (‖a − b‖² = 2 − 2·cos θ), and the dot product *is* the cosine. So all three metrics put results in the same order; only the scores differ. Shorten the vectors with the Dimensions slider and turn off Re-normalize, and the vectors are no longer unit length, so the three metrics finally disagree.

## Scorecard

Pending: the reviewed test set is built after the full corpus is embedded (an LLM drafts about 80 candidate questions; the owner keeps and edits about 40). The table from a local Scorecard run goes here. If hybrid + rerank doesn't beat vector-only, this section will say so plainly. That's a finding, not a failure.

## Cost: $0

- Google AI Studio free tier: `gemini-embedding-2` for embeddings, Gemma 4 (`gemma-4-26b-a4b-it`, `gemma-4-31b-it`) for answers.
- Vercel Hobby: static hosting plus three functions.
- Upstash Redis free plan through the Vercel Marketplace, for daily limits.
- SEC EDGAR, Hugging Face (reranker weights) and jsDelivr (ONNX runtime) are free to use.

The first visit downloads about 15 MB (the database engine, passages and vectors); the reranker's 23 MB loads afterwards, in the background. Repeat visits come from the browser cache.

## Run it locally

Requires Node 22 or later.

```bash
npm install
cp .env.example .env.local   # then set GEMINI_API_KEY and SEC_USER_AGENT ("Your Name you@example.com")
npm run ingest -- --partial  # fetch, parse, chunk and embed; the free tier embeds ~1,000 passages a day, so rerun daily
npm run dev:api              # local stand-in for the Vercel functions on :8787 (DEV_COUNTRY=DE simulates a restricted visitor)
npm run dev                  # the app on :5173, proxying /api to :8787
```

- `npm test` runs the unit and integration tests; `npm run e2e` builds the site and runs the Playwright smoke test; `npm run build` ends with a scan that fails if anything that looks like an API key reached the bundle.
- `npm run search -- "your question"` searches the local data from the command line.
- Server variables (all optional locally): `ALLOWED_ORIGINS`, `IP_HASH_SALT`, `VISITOR_DAILY_REQUESTS`, `GLOBAL_DAILY_ANSWERS`, `GLOBAL_DAILY_EMBEDS`, and `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or the Marketplace's `KV_REST_API_URL` / `KV_REST_API_TOKEN`). Without Upstash the limits are kept in memory.

## Data and attribution

- Filings come from SEC EDGAR's public APIs, fetched with a descriptive User-Agent at fewer than 10 requests per second as the SEC's fair-access policy asks. Each source card links to the filing on sec.gov.
- Text and numbers are as filed. This project isn't affiliated with the SEC or any of the companies.
- Not financial advice.

## Limitations

- **Free tier.** Answers and query embeddings use Google's free tier, with per-minute and daily limits. When the built-in key runs out, search, the sample questions and the Scorecard keep working, and you can add your own free Gemini key, which stays in your browser and goes only to Google.
- **Regional rule.** The built-in key is never used for visitors in the EEA, the UK or Switzerland (an unknown country counts as restricted). Those visitors can still search (keyword search plus rerank), run the sample questions with full hybrid search, use the Scorecard, or bring their own key.
- **Questions go to Google.** Don't enter personal information.
- **Speed.** The database and reranker run on your device; on low-end phones the first load and reranking are slower. Reranking can be turned off.
- **Citations are checked, not guaranteed.** The number check catches figures that don't appear in the cited passages; it can't judge whether a sentence's reasoning is right.
