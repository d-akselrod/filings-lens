import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PromptPassage } from '../src/core/prompt';
import type { CorpusFile, Manifest } from '../src/core/types';

export interface CorpusLookup {
  /** The manifest's corpus file name; chunk ids only mean something within one version. */
  version: string;
  get(id: number): Omit<PromptPassage, 'n'> | undefined;
}

/** The function builds prompts from its own copy of the corpus, so clients can only send chunk ids. */
export async function loadCorpusLookup(rootDir: string): Promise<CorpusLookup> {
  const dataDir = join(rootDir, 'public/data');
  const manifest = JSON.parse(await readFile(join(dataDir, 'manifest.json'), 'utf8')) as Manifest;
  const corpus = JSON.parse(await readFile(join(dataDir, manifest.corpus.file), 'utf8')) as CorpusFile;
  const tickerByCompany = new Map(corpus.companies.map(c => [c.id, c.ticker]));
  const filings = new Map(corpus.filings.map(f => [f.id, { ticker: tickerByCompany.get(f.companyId)!, fiscalYear: f.fiscalYear }]));
  const passages = new Map(corpus.chunks.map(c => {
    const filing = filings.get(c.filingId)!;
    return [c.id, { ticker: filing.ticker, fiscalYear: filing.fiscalYear, item: c.item, itemTitle: c.itemTitle, text: c.text }];
  }));
  return { version: manifest.corpus.file, get: id => passages.get(id) };
}
