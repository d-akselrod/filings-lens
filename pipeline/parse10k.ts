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

  // Each Item keeps the occurrence followed by the most text; table-of-contents lines are followed by almost none.
  const best = new Map<string, { index: number; code: string; span: number }>();
  candidates.forEach((c, k) => {
    const span = charsOf(blocks.slice(c.index + 1, candidates[k + 1]?.index ?? blocks.length));
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
      const sectionBlocks = blocks.slice(h.index + 1, Math.min(headings[i + 1]?.index ?? end, end));
      return { item: h.code, title: ITEM_TITLES[h.code]!, blocks: sectionBlocks, chars: charsOf(sectionBlocks) };
    })
    .filter(s => s.chars >= MIN_SECTION_CHARS);

  return { sections, missingRequired: REQUIRED_ITEMS.filter(code => !sections.some(s => s.item === code)) };
}
