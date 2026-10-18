/**
 * npm run eval:draft — asks Gemma for one candidate question per sampled passage (resumable).
 * Output: data/eval/candidates.jsonl, for the owner to review into data/eval/questions.jsonl.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { GeminiError, generateText } from '../../src/core/gemini';
import { COMPANIES } from '../companies';
import { requireEnv } from '../env';
import { parseDraftReply, pickStratified, readJsonl } from '../eval';
import { readDataFiles } from '../node-data';

const OUT = 'data/eval/candidates.jsonl';
const MODEL = 'gemma-4-26b-a4b-it';
const SYSTEM = 'You write evaluation questions for a search engine over SEC Form 10-K filings.';
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const apiKey = requireEnv('GEMINI_API_KEY');
const { corpus } = await readDataFiles('public/data');
const tickerByFiling = new Map(corpus.filings.map(f => [f.id, corpus.companies.find(c => c.id === f.companyId)!.ticker]));
const yearByFiling = new Map(corpus.filings.map(f => [f.id, f.fiscalYear]));
const rows = corpus.chunks.map(c => ({ ...c, ticker: tickerByFiling.get(c.filingId)!, fiscalYear: yearByFiling.get(c.filingId)! }));
const picks = pickStratified(rows, COMPANIES.map(c => c.ticker), ['1', '1A', '7', '8'], 3, 2026);

await mkdir('data/eval', { recursive: true });
const done = new Set((await readJsonl(OUT).catch(() => [])).map(line => (line as { id: string }).id));
let written = 0;
let unparseable = 0;
for (const [i, chunk] of picks.entries()) {
  const id = `q${String(i + 1).padStart(2, '0')}`;
  if (done.has(id)) continue;
  const user = `Passage (from ${chunk.ticker} 10-K FY${chunk.fiscalYear}, Item ${chunk.item} ${chunk.itemTitle}):\n${chunk.text}\n\n` +
    'Write one specific question an analyst might ask that this passage answers. Do not copy long phrases verbatim. ' +
    'Reply only with JSON: {"question": "...", "answer": "...", "style": "number|risk|strategy|comparison|other"}';
  let reply = '';
  for (let attempt = 1; ; attempt++) {
    try {
      // Default thinking took 30–60 s per reply (and once an HTTP 500); 'minimal' answers in ~4 s.
      reply = await generateText(apiKey, { model: MODEL, system: SYSTEM, user, thinkingLevel: 'minimal' });
      break;
    } catch (e) {
      if (!(e instanceof GeminiError) || e.reason !== 'quota') throw e;
      if (attempt >= 5) {
        console.error(`\nFree-tier quota exhausted after ${written} new candidates; rerun later to continue.`);
        process.exit(2);
      }
      await sleep(e.retryAfterMs ?? 60_000);
    }
  }
  const parsed = parseDraftReply(reply);
  if (!parsed) {
    unparseable++;
    continue;
  }
  await appendFile(OUT, `${JSON.stringify({ id, ...parsed, ticker: chunk.ticker, item: chunk.item, goldKeys: [chunk.key] })}\n`);
  written++;
  process.stdout.write(`\rdrafted ${done.size + written}/${picks.length}`);
}
console.log(`\n${written} new candidates written to ${OUT}; ${unparseable} unparseable replies skipped.`);
