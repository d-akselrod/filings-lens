import { tokenize } from '../core/tokenize';
import type { RankedResult } from '../core/types';

/** Word runs (numbers keep their inner "." and ",") and the non-word runs between them. */
const RUNS = /[\p{L}\p{N}]+(?:[.,]\p{N}+)*|[^\p{L}\p{N}]+/gu;
const WORD = /^[\p{L}\p{N}]/u;

const isHit = (run: string, terms: ReadonlySet<string>) => WORD.test(run) && terms.has(tokenize(run)[0] ?? '');

/** Splits text into runs, marking words that tokenize (stemmed, as BM25 sees them) to a query term. */
export function highlightSegments(text: string, queryTerms: ReadonlySet<string>): Array<{ text: string; hit: boolean }> {
  const out: Array<{ text: string; hit: boolean }> = [];
  for (const [run] of text.matchAll(RUNS)) {
    const hit = isHit(run, queryTerms);
    const previous = out.at(-1);
    if (previous && !previous.hit && !hit) previous.text += run;
    else out.push({ text: run, hit });
  }
  return out;
}

/** A window of about maxChars that starts ~60 characters before the first hit, with "…" on each cut side. */
export function snippet(text: string, queryTerms: ReadonlySet<string>, maxChars = 280): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  let first = -1;
  let pos = 0;
  for (const [run] of clean.matchAll(RUNS)) {
    if (isHit(run, queryTerms)) {
      first = pos;
      break;
    }
    pos += run.length;
  }
  let start = first === -1 ? 0 : Math.max(0, Math.min(first - 60, clean.length - maxChars));
  if (start > 0) {
    const space = clean.indexOf(' ', start);
    if (space !== -1 && (first === -1 || space < first)) start = space + 1;
  }
  let end = Math.min(clean.length, start + maxChars);
  if (end < clean.length) {
    const space = clean.lastIndexOf(' ', end);
    if (space > start + maxChars / 2) end = space;
  }
  return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`;
}

/** Positive when reranking moved the result up from its fused position. */
export function rankDelta(r: RankedResult): number {
  return r.fused.rank - r.finalRank;
}
