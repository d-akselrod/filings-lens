import { compareItems } from '../src/core/types';
import type { Block } from './html-blocks';

export const ITEM_TITLES: Readonly<Record<string, string>> = {
  '1': 'Business',
  '1A': 'Risk Factors',
  '1B': 'Unresolved Staff Comments',
  '1C': 'Cybersecurity',
  '2': 'Properties',
  '3': 'Legal Proceedings',
  '4': 'Mine Safety Disclosures',
  '5': "Market for Registrant's Common Equity, Related Stockholder Matters and Issuer Purchases of Equity Securities",
  '6': '[Reserved]',
  '7': "Management's Discussion and Analysis of Financial Condition and Results of Operations",
  '7A': 'Quantitative and Qualitative Disclosures About Market Risk',
  '8': 'Financial Statements and Supplementary Data',
  '9': 'Changes in and Disagreements with Accountants on Accounting and Financial Disclosure',
  '9A': 'Controls and Procedures',
  '9B': 'Other Information',
  '9C': 'Disclosure Regarding Foreign Jurisdictions that Prevent Inspections',
  '10': 'Directors, Executive Officers and Corporate Governance',
  '11': 'Executive Compensation',
  '12': 'Security Ownership of Certain Beneficial Owners and Management and Related Stockholder Matters',
  '13': 'Certain Relationships and Related Transactions, and Director Independence',
  '14': 'Principal Accountant Fees and Services',
  '15': 'Exhibits and Financial Statement Schedules',
  '16': 'Form 10-K Summary',
};

export const REQUIRED_ITEMS: readonly string[] = ['1', '1A', '7', '8'];

export interface Section { item: string; title: string; blocks: Block[]; chars: number }

const HEADING = /^item\s+(\d{1,2}[a-c]?)\s*[.:\-–—]?\s*(.{0,200})$/i;
const EXHIBIT_ITEMS = new Set(['15', '16']);
const SIGNATURES = /^signatures?$/i;
const AUDITOR_REPORT = /^report of independent registered public accounting firm/i;
const EXHIBIT_INDEX = /^exhibit index$/i;
const PART_LINE = /^part\s+(i|ii|iii|iv)\.?$/i;
const MIN_SECTION_CHARS = 200;

export function blockChars(b: Block): number {
  return b.kind === 'para' ? b.text.length : b.rows.reduce((sum, row) => sum + row.join(' | ').length, 0);
}

const charsOf = (blocks: Block[]) => blocks.reduce((sum, b) => sum + blockChars(b), 0);

export function splitItems(blocks: Block[]): { sections: Section[]; missingRequired: string[] } {
  const candidates = blocks.flatMap((b, index) => {
    if (b.kind !== 'para') return [];
    const code = HEADING.exec(b.text)?.[1]?.toUpperCase();
    return code && code in ITEM_TITLES ? [{ index, code }] : [];
  });

  // Each Item keeps the occurrence followed by the most text before a *different* Item's heading:
  // table-of-contents lines are followed by almost none, and running page headers repeating the same Item don't count as ends.
  const best = new Map<string, { index: number; code: string; span: number }>();
  candidates.forEach((c, k) => {
    const next = candidates.slice(k + 1).find(o => o.code !== c.code)?.index ?? blocks.length;
    const span = charsOf(blocks.slice(c.index + 1, next));
    const current = best.get(c.code);
    if (!current || span > current.span) best.set(c.code, { ...c, span });
  });
  const kept = [...best.values()].sort((a, b) => a.index - b.index);

  const exhibitsAt = kept.find(h => EXHIBIT_ITEMS.has(h.code))?.index;
  const signaturesAt = blocks.findLastIndex(b => b.kind === 'para' && SIGNATURES.test(b.text));
  const end = exhibitsAt ?? (signaturesAt >= 0 ? signaturesAt : blocks.length);
  const headings = kept.filter(h => !EXHIBIT_ITEMS.has(h.code) && h.index < end);

  const sections = headings
    .map((h, i) => {
      const sectionBlocks = withoutRunningHeaders(blocks.slice(h.index + 1, Math.min(headings[i + 1]?.index ?? end, end)), h.code);
      return { item: h.code, title: ITEM_TITLES[h.code]!, blocks: sectionBlocks, chars: charsOf(sectionBlocks) };
    })
    .filter(s => s.chars >= MIN_SECTION_CHARS);

  // Some filers (e.g. NVIDIA) answer Item 8 with a cross-reference and file the audited statements under Item 15.
  const item15 = kept.find(h => h.code === '15');
  if (!sections.some(s => s.item === '8') && item15) {
    const relocated = statementsAfter(blocks, item15.index, [kept.find(h => h.code === '16')?.index ?? -1, signaturesAt]);
    if (charsOf(relocated) >= MIN_SECTION_CHARS) {
      sections.push({ item: '8', title: ITEM_TITLES['8']!, blocks: relocated, chars: charsOf(relocated) });
    }
  }
  sections.sort((a, b) => compareItems(a.item, b.item));

  return { sections, missingRequired: REQUIRED_ITEMS.filter(code => !sections.some(s => s.item === code)) };
}

/** From the auditor's report after the Item 15 heading up to the exhibit index (or Item 16 / signatures). */
function statementsAfter(blocks: Block[], item15Index: number, otherStops: number[]): Block[] {
  const isPara = (b: Block, re: RegExp) => b.kind === 'para' && re.test(b.text);
  const start = blocks.findIndex((b, i) => i > item15Index && isPara(b, AUDITOR_REPORT));
  if (start === -1) return [];
  const stops = [blocks.findIndex((b, i) => i > start && isPara(b, EXHIBIT_INDEX)), ...otherStops].filter(i => i > start);
  return withoutRunningHeaders(blocks.slice(start, stops.length > 0 ? Math.min(...stops) : blocks.length), '15');
}

/** Drops "PART II" lines and repeats of the section's own Item heading (page headers, the full-title heading line). */
function withoutRunningHeaders(blocks: Block[], code: string): Block[] {
  return blocks.filter(b => b.kind !== 'para' || !(PART_LINE.test(b.text) || HEADING.exec(b.text)?.[1]?.toUpperCase() === code));
}
