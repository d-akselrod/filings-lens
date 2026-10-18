import type { CorpusFile } from '../src/core/types';

/** Keeps whole filings (and companies that still have one), renumbering ids densely; chunk keys are unchanged. */
export function subsetCorpus(corpus: CorpusFile, keepFilingIds: ReadonlySet<number>): CorpusFile {
  const filings = corpus.filings.filter(f => keepFilingIds.has(f.id));
  const companyIds = new Set(filings.map(f => f.companyId));
  const companies = corpus.companies.filter(c => companyIds.has(c.id));
  const companyId = new Map(companies.map((c, i) => [c.id, i]));
  const filingId = new Map(filings.map((f, i) => [f.id, i]));
  return {
    schemaVersion: 1,
    companies: companies.map((c, i) => ({ ...c, id: i })),
    filings: filings.map((f, i) => ({ ...f, id: i, companyId: companyId.get(f.companyId)! })),
    chunks: corpus.chunks
      .filter(c => filingId.has(c.filingId))
      .map((c, i) => ({ ...c, id: i, filingId: filingId.get(c.filingId)! })),
  };
}
