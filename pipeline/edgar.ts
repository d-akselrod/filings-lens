import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SubmissionsJson {
  cik: string;
  name: string;
  filings: { recent: { accessionNumber: string[]; filingDate: string[]; reportDate: string[]; form: string[]; primaryDocument: string[] } };
}

export interface FilingRef {
  ticker: string; cik: string; accession: string; filedAt: string; periodEnd: string;
  fiscalYear: number; primaryDocument: string; url: string;
}

/** All seven companies label a fiscal year by the calendar year in which it ends. */
export function fiscalYearOf(periodEnd: string): number {
  return Number(periodEnd.slice(0, 4));
}

export function archiveUrl(cik: string, accession: string, doc: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${doc}`;
}

export function latest10Ks(sub: SubmissionsJson, ticker: string, count: number): FilingRef[] {
  const r = sub.filings.recent;
  const cik = sub.cik.padStart(10, '0');
  return r.form
    .map((form, i) => ({ form, i }))
    .filter(x => x.form === '10-K')
    .sort((a, b) => r.filingDate[b.i]!.localeCompare(r.filingDate[a.i]!))
    .slice(0, count)
    .map(({ i }) => ({
      ticker, cik,
      accession: r.accessionNumber[i]!,
      filedAt: r.filingDate[i]!,
      periodEnd: r.reportDate[i]!,
      fiscalYear: fiscalYearOf(r.reportDate[i]!),
      primaryDocument: r.primaryDocument[i]!,
      url: archiveUrl(cik, r.accessionNumber[i]!, r.primaryDocument[i]!),
    }));
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** SEC fair access: identify yourself and stay under 10 requests/second. Responses are cached on disk. */
export class EdgarClient {
  private nextSlot = 0;

  constructor(private readonly o: { userAgent: string; cacheDir: string; minIntervalMs?: number; fetch?: typeof fetch }) {
    if (!o.userAgent.includes('@')) {
      throw new Error('SEC_USER_AGENT must include a contact email, e.g. "Jane Doe jane@example.com"');
    }
  }

  async submissions(cik: string): Promise<SubmissionsJson> {
    return JSON.parse(await this.cached(`CIK${cik}.json`, `https://data.sec.gov/submissions/CIK${cik}.json`)) as SubmissionsJson;
  }

  async document(ref: FilingRef): Promise<string> {
    return this.cached(`${ref.accession}.htm`, ref.url);
  }

  private async cached(file: string, url: string): Promise<string> {
    const path = join(this.o.cacheDir, file);
    try {
      return await readFile(path, 'utf8');
    } catch {
      // not cached yet
    }
    const text = await this.get(url);
    await mkdir(this.o.cacheDir, { recursive: true });
    await writeFile(`${path}.tmp`, text);
    await rename(`${path}.tmp`, path);
    return text;
  }

  private async get(url: string): Promise<string> {
    // Reserve a start slot synchronously so concurrent callers are spaced too.
    const slot = Math.max(Date.now(), this.nextSlot);
    this.nextSlot = slot + (this.o.minIntervalMs ?? 150);
    if (slot > Date.now()) await sleep(slot - Date.now());
    const res = await (this.o.fetch ?? fetch)(url, { headers: { 'User-Agent': this.o.userAgent } });
    if (!res.ok) throw new Error(`EDGAR returned ${res.status} for ${url}`);
    return res.text();
  }
}
