export interface NumberToken { raw: string; value: number; percent: boolean; halfUnit: number }
export interface SentenceCheck { text: string; citations: number[]; invalidCitations: number[]; missingCitation: boolean; unsupportedNumbers: string[] }

const ABBREVIATIONS = new Set(['u.s', 'u.k', 'e.u', 'inc', 'corp', 'co', 'ltd', 'no', 'vs', 'e.g', 'i.e', 'approx', 'mr', 'ms', 'dr', 'st']);
const CLOSERS = new Set(['"', "'", ')', ']', '”', '’']);
const CITATION_GROUPS = /^(\s*\[\d+(?:\s*,\s*\d+)*\])+/;
const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const NUMBER = /(?<![\w.])(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\s*(?:%|percent\b|thousand\b|million\b|billion\b|trillion\b))?/gi;
const LABEL_BEFORE = /(item|note|part|fy|fiscal(?: year)?|q[1-4])\s*$/i;
/** 10-K change columns write declines as "(27)%"; the parenthesis would otherwise cut the number off from its unit. */
const NEGATIVE_PERCENT = /\((\d[\d,]*(?:\.\d+)?)\)(?=\s*(?:%|percent\b))/gi;
const EXPONENT: Record<string, number> = { thousand: 3, million: 6, billion: 9, trillion: 12 };
const EXEMPT = /(provided filings|passages)\s+(?:don't|do not|doesn't|does not)\s+(?:answer|cover|contain)|investment advice/i;
const SCALES = [1e-9, 1e-6, 1e-3, 1, 1e3, 1e6, 1e9];

/** Splits streamed text into finished sentences (citation markers stay with their sentence) and the unfinished rest. */
export function splitSentences(text: string, final = false): { complete: string[]; rest: string } {
  const complete: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    if (ch === '.' && /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '')) continue;
    const before = /([A-Za-z.]+)$/.exec(text.slice(start, i))?.[1]?.toLowerCase();
    if (ch === '.' && before && ABBREVIATIONS.has(before)) continue;
    let j = i + 1;
    while (j < text.length && CLOSERS.has(text[j]!)) j++;
    j += CITATION_GROUPS.exec(text.slice(j))?.[0].length ?? 0;
    const atEnd = j >= text.length;
    const followed = /^\s+["$“\dA-Z]/.test(text.slice(j));
    if ((atEnd && final) || followed) {
      const sentence = text.slice(start, j).trim();
      if (sentence) complete.push(sentence);
      start = j;
      i = j - 1;
    }
  }
  const rest = text.slice(start).replace(/^\s+/, '');
  if (final && rest.trim()) return { complete: [...complete, rest.trim()], rest: '' };
  return { complete, rest };
}

export function extractCitations(s: string): number[] {
  const found = new Set<number>();
  for (const match of s.matchAll(CITATION)) for (const n of match[1]!.split(',')) found.add(Number(n.trim()));
  return [...found].sort((a, b) => a - b);
}

/** Numbers with their scale (thousand…trillion, %), skipping years, small counts and labels like "Item 7". */
export function extractNumbers(s: string): NumberToken[] {
  const text = s.replace(CITATION, ' ').replace(/\b10-[KQ]\b/g, ' ').replace(NEGATIVE_PERCENT, '$1');
  const out: NumberToken[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const [raw, dollar, int, frac, unitRaw] = m;
    const unit = unitRaw?.trim().toLowerCase() ?? '';
    const decimals = frac ? frac.length - 1 : 0;
    const integer = Number(int!.replace(/,/g, ''));
    if (!dollar && !frac && !unit && integer >= 1900 && integer <= 2100 && int!.length === 4) continue;
    if (!dollar && !frac && !unit && integer < 10) continue;
    if (LABEL_BEFORE.test(text.slice(Math.max(0, m.index! - 12), m.index!))) continue;
    const exponent = EXPONENT[unit] ?? 0;
    out.push({
      raw: raw!.trim(),
      value: Number(`${int!.replace(/,/g, '')}${frac ?? ''}e${exponent}`),
      percent: unit === '%' || unit === 'percent',
      halfUnit: Number(`5e${exponent - decimals - 1}`),
    });
  }
  return out;
}

function supported(a: NumberToken, candidates: NumberToken[]): boolean {
  return candidates.some(p => p.percent === a.percent && (a.percent ? [1] : SCALES).some(m =>
    Math.abs(a.value - p.value * m) <= Math.max(a.halfUnit, p.halfUnit * m)));
}

/** Deterministic check of one finished sentence against the passages it cites. */
export function checkSentence(s: string, passages: ReadonlyMap<number, string>): SentenceCheck {
  const citations = extractCitations(s);
  const valid = citations.filter(n => passages.has(n));
  const evidence = valid.flatMap(n => extractNumbers(passages.get(n)!));
  return {
    text: s,
    citations,
    invalidCitations: citations.filter(n => !passages.has(n)),
    missingCitation: valid.length === 0 && !EXEMPT.test(s),
    unsupportedNumbers: extractNumbers(s).filter(a => !supported(a, evidence)).map(a => a.raw),
  };
}
