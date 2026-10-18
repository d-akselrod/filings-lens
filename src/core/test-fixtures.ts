/** Deterministic helpers for tests only. */
import { encodeF16 } from './float16';
import { seededRandom } from './random';
import type { CorpusFile } from './types';

export { seededRandom };

const FIXTURE_FILINGS = [
  { id: 0, companyId: 0, fiscalYear: 2025, periodEnd: '2025-01-26', filedAt: '2025-02-26', accession: '0001045810-25-000023', doc: 'nvda-20250126.htm', cik: 1045810 },
  { id: 1, companyId: 0, fiscalYear: 2024, periodEnd: '2024-01-28', filedAt: '2024-02-21', accession: '0001045810-24-000029', doc: 'nvda-20240128.htm', cik: 1045810 },
  { id: 2, companyId: 1, fiscalYear: 2025, periodEnd: '2025-09-27', filedAt: '2025-10-31', accession: '0000320193-25-000079', doc: 'aapl-20250927.htm', cik: 320193 },
];

const FIXTURE_CHUNKS: Array<[filingId: number, item: string, itemTitle: string, text: string]> = [
  [0, '1A', 'Risk Factors', 'Export controls restrict sales of data center products to China.'],
  [0, '7', "Management's Discussion and Analysis of Financial Condition and Results of Operations", 'Data center revenue grew strongly in fiscal 2025.'],
  [1, '1A', 'Risk Factors', 'New export restrictions may reduce demand in China.'],
  [2, '1A', 'Risk Factors', 'Supply chain disruptions in China could affect iPhone production.'],
  [2, '7', "Management's Discussion and Analysis of Financial Condition and Results of Operations", 'Services revenue reached a record.'],
  [2, '8', 'Financial Statements and Supplementary Data', 'Net sales by category are shown in the table below.'],
];

/** 2 companies, 3 filings, 6 one-chunk sections. */
export function fixtureCorpus(): CorpusFile {
  return {
    schemaVersion: 1,
    companies: [
      { id: 0, ticker: 'NVDA', name: 'NVIDIA', cik: '0001045810' },
      { id: 1, ticker: 'AAPL', name: 'Apple', cik: '0000320193' },
    ],
    filings: FIXTURE_FILINGS.map(f => ({
      id: f.id, companyId: f.companyId, form: '10-K' as const, fiscalYear: f.fiscalYear, periodEnd: f.periodEnd,
      filedAt: f.filedAt, accession: f.accession,
      url: `https://www.sec.gov/Archives/edgar/data/${f.cik}/${f.accession.replace(/-/g, '')}/${f.doc}`,
    })),
    chunks: FIXTURE_CHUNKS.map(([filingId, item, itemTitle, text], id) => ({
      id, key: `${FIXTURE_FILINGS[filingId]!.accession}:${item}:0`, filingId, item, itemTitle, ordinal: 0, text,
      tokenCount: Math.ceil(text.length / 4),
    })),
  };
}

/** Unit basis vector e_i for chunk i, as float32 (width 768). */
export function basisVector(i: number): Float32Array {
  const v = new Float32Array(768);
  v[i] = 1;
  return v;
}

/** float16 bytes of e_0..e_5. */
export function fixtureVectors(): Uint8Array {
  const all = new Float32Array(6 * 768);
  for (let i = 0; i < 6; i++) all.set(basisVector(i), i * 768);
  return encodeF16(all);
}

/** Gaussian (Box–Muller) vectors scaled to unit length. */
export function randomUnitVectors(n: number, dims: number, seed: number): Float32Array[] {
  const r = seededRandom(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  return Array.from({ length: n }, () => {
    const v = Array.from({ length: dims }, gauss);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return Float32Array.from(v, x => x / norm);
  });
}
