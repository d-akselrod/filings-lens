/**
 * npm run ingest [-- --parse-only] [--partial] [--batch 128] [--pace 3500]
 * --partial: when the daily quota stops embedding, still write data files for the filings that are fully embedded (dev use).
 * EDGAR → 10-K Items → chunks → Nemotron 3 Embed (OpenRouter) → public/data/. Resumable: rerun after a quota stop.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { documentText } from '../../src/core/embeddings';
import type { ChunkRow, CompanyRow, CorpusFile, FilingRow } from '../../src/core/types';
import { chunkSection } from '../chunk';
import { COMPANIES } from '../companies';
import { EdgarClient } from '../edgar';
import { embedWithCache, QuotaExhaustedError, readCachedVectors } from '../embed-runner';
import { subsetCorpus } from '../subset';
import { requireEnv } from '../env';
import { htmlToBlocks } from '../html-blocks';
import { splitItems } from '../parse10k';
import { FIRST_VISIT_BUDGET_BYTES, RUNTIME_ALLOWANCE_BYTES, writeDataFiles } from '../write-data';

const parseOnly = process.argv.includes('--parse-only');
const partial = process.argv.includes('--partial');
const batchArg = process.argv.indexOf('--batch');
// OpenRouter's free tier counts requests (50 a day), not texts: 128 chunks per request embeds the corpus in ~35.
const batchSize = batchArg === -1 ? 128 : Number(process.argv[batchArg + 1]);
const paceArg = process.argv.indexOf('--pace');
// Free models allow 20 requests a minute; one every 3.5 s stays under it.
const paceMs = paceArg === -1 ? 3_500 : Number(process.argv[paceArg + 1]);
const edgar = new EdgarClient({ userAgent: requireEnv('SEC_USER_AGENT'), cacheDir: 'data/.cache/edgar' });

const companies: CompanyRow[] = [];
const filings: FilingRow[] = [];
const chunks: ChunkRow[] = [];
const toEmbed: Array<{ key: string; text: string; recency: number }> = [];
const report: Array<{ ticker: string; fiscalYear: number; accession: string; items: Record<string, number>; chunks: number; missingRequired: string[] }> = [];

for (const [companyId, company] of COMPANIES.entries()) {
  const sub = await edgar.submissions(company.cik);
  if (!sub.name.toUpperCase().includes(company.edgarName)) {
    throw new Error(`CIK ${company.cik} belongs to "${sub.name}", expected ${company.edgarName}`);
  }
  companies.push({ id: companyId, ticker: company.ticker, name: company.name, cik: company.cik });
  for (const [recency, ref] of (await edgar.latestTenKs(company.cik, company.ticker, 3)).entries()) {
    const { sections, missingRequired } = splitItems(htmlToBlocks(await edgar.document(ref)));
    const filingId = filings.length;
    filings.push({ id: filingId, companyId, form: '10-K', fiscalYear: ref.fiscalYear, periodEnd: ref.periodEnd,
      filedAt: ref.filedAt, accession: ref.accession, url: ref.url });
    let count = 0;
    for (const section of sections) {
      const title = `${company.name} 10-K FY${ref.fiscalYear} — Item ${section.item} ${section.title}`;
      for (const chunk of chunkSection(section.blocks)) {
        const key = `${ref.accession}:${section.item}:${chunk.ordinal}`;
        chunks.push({ id: chunks.length, key, filingId, item: section.item, itemTitle: section.title,
          ordinal: chunk.ordinal, text: chunk.text, tokenCount: chunk.tokenCount });
        toEmbed.push({ key, text: documentText(title, chunk.text), recency });
        count++;
      }
    }
    report.push({ ticker: company.ticker, fiscalYear: ref.fiscalYear, accession: ref.accession,
      items: Object.fromEntries(sections.map(s => [s.item, s.chars])), chunks: count, missingRequired });
  }
}

await mkdir('data', { recursive: true });
await writeFile('data/parse-report.json', `${JSON.stringify(report, null, 2)}\n`);
console.table(report.map(r => ({ ticker: r.ticker, FY: r.fiscalYear, items: Object.keys(r.items).join(' '), chunks: r.chunks,
  missing: r.missingRequired.join(' ') || '—' })));
const failed = report.filter(r => r.missingRequired.length > 0);
if (failed.length > 0) {
  console.error(`Parsing failed for ${failed.length} filing(s); see data/parse-report.json. Fix parse10k.ts (with a failing test) and rerun.`);
  process.exit(1);
}
console.log(`${filings.length} filings, ${chunks.length} chunks`);
const projected = chunks.length * 768 * 2 + gzipSync(JSON.stringify({ schemaVersion: 1, companies, filings, chunks }), { level: 9 }).byteLength
  + RUNTIME_ALLOWANCE_BYTES;
console.log(`Projected first visit: ${projected} bytes (budget ${FIRST_VISIT_BUDGET_BYTES})`);
if (parseOnly) process.exit(0);

// Each company's newest 10-K first, so a partial run still covers every company's latest year.
const queue = toEmbed.map((item, i) => ({ item, i })).sort((a, b) => a.item.recency - b.item.recency || a.i - b.i).map(x => x.item);
let vectors: Map<string, Float32Array>;
let complete = true;
try {
  vectors = await embedWithCache(queue, {
    apiKey: requireEnv('OPENROUTER_API_KEY'),
    cacheDir: 'data/.cache/embeddings',
    batchSize,
    paceMs,
    onRetry: (reason, waitMs, message) =>
      console.log(`\n[${new Date().toISOString().slice(11, 19)}] ${reason}: waiting ${Math.round(waitMs / 1000)}s — ${message.slice(0, 300)}`),
    onProgress: (done, total) => process.stdout.write(`\rembedded ${done}/${total}`),
  });
  process.stdout.write('\n');
} catch (e) {
  if (!(e instanceof QuotaExhaustedError)) throw e;
  console.error(`\n${e.message}`);
  if (!partial) process.exit(2);
  complete = false;
  vectors = await readCachedVectors(toEmbed, 'data/.cache/embeddings');
}

let corpus: CorpusFile = { schemaVersion: 1, companies, filings, chunks };
if (!complete) {
  const done = new Set(filings.filter(f => chunks.every(c => c.filingId !== f.id || vectors.has(c.key))).map(f => f.id));
  corpus = subsetCorpus(corpus, done);
  console.log(`PARTIAL data: ${corpus.filings.length}/${filings.length} filings, ${corpus.chunks.length}/${chunks.length} chunks embedded so far`);
}
const manifest = await writeDataFiles(corpus, vectors, { publicDir: 'public/data' });
const firstVisit = manifest.vectors.bytes + manifest.corpus.gzipBytes + RUNTIME_ALLOWANCE_BYTES;
console.log(`corpus ${manifest.corpus.bytes} bytes (${manifest.corpus.gzipBytes} gzipped), vectors ${manifest.vectors.bytes} bytes`);
console.log(`Budget OK: ${firstVisit} bytes ≤ ${FIRST_VISIT_BUDGET_BYTES}`);
