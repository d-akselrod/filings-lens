/**
 * npm run ingest [-- --parse-only] [--batch 25]
 * EDGAR → 10-K Items → chunks → gemini-embedding-2 → public/data/. Resumable: rerun after a quota stop.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { documentText } from '../../src/core/gemini';
import type { ChunkRow, CompanyRow, CorpusFile, FilingRow } from '../../src/core/types';
import { chunkSection } from '../chunk';
import { COMPANIES } from '../companies';
import { EdgarClient } from '../edgar';
import { embedWithCache, QuotaExhaustedError } from '../embed-runner';
import { requireEnv } from '../env';
import { htmlToBlocks } from '../html-blocks';
import { splitItems } from '../parse10k';
import { FIRST_VISIT_BUDGET_BYTES, RUNTIME_ALLOWANCE_BYTES, writeDataFiles } from '../write-data';

const parseOnly = process.argv.includes('--parse-only');
const batchArg = process.argv.indexOf('--batch');
// Small batches keep each request under free-tier per-minute token limits (a 600-token chunk × 25 ≈ 15K tokens).
const batchSize = batchArg === -1 ? 25 : Number(process.argv[batchArg + 1]);
const edgar = new EdgarClient({ userAgent: requireEnv('SEC_USER_AGENT'), cacheDir: 'data/.cache/edgar' });

const companies: CompanyRow[] = [];
const filings: FilingRow[] = [];
const chunks: ChunkRow[] = [];
const toEmbed: Array<{ key: string; text: string }> = [];
const report: Array<{ ticker: string; fiscalYear: number; accession: string; items: Record<string, number>; chunks: number; missingRequired: string[] }> = [];

for (const [companyId, company] of COMPANIES.entries()) {
  const sub = await edgar.submissions(company.cik);
  if (!sub.name.toUpperCase().includes(company.edgarName)) {
    throw new Error(`CIK ${company.cik} belongs to "${sub.name}", expected ${company.edgarName}`);
  }
  companies.push({ id: companyId, ticker: company.ticker, name: company.name, cik: company.cik });
  for (const ref of await edgar.latestTenKs(company.cik, company.ticker, 3)) {
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
        toEmbed.push({ key, text: documentText(title, chunk.text) });
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

let vectors: Map<string, Float32Array>;
try {
  vectors = await embedWithCache(toEmbed, {
    apiKey: requireEnv('GEMINI_API_KEY'),
    cacheDir: 'data/.cache/embeddings',
    batchSize,
    onProgress: (done, total) => process.stdout.write(`\rembedded ${done}/${total}`),
  });
  process.stdout.write('\n');
} catch (e) {
  if (e instanceof QuotaExhaustedError) {
    console.error(`\n${e.message} (daily free-tier limits reset at midnight Pacific).`);
    process.exit(2);
  }
  throw e;
}

const corpus: CorpusFile = { schemaVersion: 1, companies, filings, chunks };
const manifest = await writeDataFiles(corpus, vectors, { publicDir: 'public/data' });
const firstVisit = manifest.vectors.bytes + manifest.corpus.gzipBytes + RUNTIME_ALLOWANCE_BYTES;
console.log(`corpus ${manifest.corpus.bytes} bytes (${manifest.corpus.gzipBytes} gzipped), vectors ${manifest.vectors.bytes} bytes`);
console.log(`Budget OK: ${firstVisit} bytes ≤ ${FIRST_VISIT_BUDGET_BYTES}`);
