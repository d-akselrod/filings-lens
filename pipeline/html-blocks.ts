import * as cheerio from 'cheerio';

export type Block = { kind: 'para'; text: string } | { kind: 'table'; rows: string[][] };

interface DomNode { type: string; name?: string; data?: string; attribs?: Record<string, string>; children?: DomNode[] }

const BLOCK_TAGS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'section', 'article', 'blockquote', 'center', 'pre', 'body']);
const SKIP_TAGS = new Set(['head', 'title', 'noscript', 'ix:header']);
const FURNITURE = /^(table of contents|page \d+|\d{1,3})$/i;
const PREFIX_CELLS = new Set(['$', '(']);
const SUFFIX_CELLS = new Set([')', '%', ')%']);

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
const isHidden = (n: DomNode) => /display\s*:\s*none/i.test(n.attribs?.style ?? '');
// domhandler gives <script>/<style> their own node types; 'tag' and 'root' are the only containers we walk.
const isContainer = (n: DomNode) => n.type === 'tag' || n.type === 'root';

function textOf(node: DomNode): string {
  if (node.type === 'text') return node.data ?? '';
  if (!isContainer(node) || isHidden(node) || SKIP_TAGS.has(node.name ?? '')) return '';
  const inner = (node.children ?? []).map(textOf).join('');
  return node.name === 'br' || BLOCK_TAGS.has(node.name ?? '') ? ` ${inner} ` : inner;
}

function rowsOf(table: DomNode): DomNode[] {
  const rows: DomNode[] = [];
  const visit = (n: DomNode) => {
    for (const child of n.children ?? []) {
      if (child.type !== 'tag' || child.name === 'table') continue;
      if (child.name === 'tr') rows.push(child);
      else visit(child);
    }
  };
  visit(table);
  return rows;
}

function mergeCells(cells: string[]): string[] {
  const out: string[] = [];
  let prefix = '';
  for (const cell of cells) {
    if (PREFIX_CELLS.has(cell)) prefix += cell;
    else if (SUFFIX_CELLS.has(cell) && out.length > 0) out[out.length - 1] += cell;
    else {
      out.push(prefix + cell);
      prefix = '';
    }
  }
  return out;
}

function tableBlock(table: DomNode): Block | null {
  const rows = rowsOf(table)
    .map(tr => mergeCells((tr.children ?? [])
      .filter(c => c.type === 'tag' && (c.name === 'td' || c.name === 'th'))
      .map(c => collapse(textOf(c)))
      .filter(Boolean)))
    .filter(row => row.length > 0);
  const cells = rows.flat();
  if (cells.length === 0) return null;
  // Single-cell and single-row tables are layout (often an Item heading), not data.
  if (cells.length === 1 || rows.length === 1) return { kind: 'para', text: cells.join(' ') };
  return { kind: 'table', rows };
}

/** Flattens 10-K HTML into paragraphs and tables in document order. */
export function htmlToBlocks(html: string): Block[] {
  const $ = cheerio.load(html);
  const blocks: Block[] = [];
  let line = '';
  const pushPara = (raw: string) => {
    const text = collapse(raw);
    if (text && !FURNITURE.test(text)) blocks.push({ kind: 'para', text });
  };
  const flush = () => {
    pushPara(line);
    line = '';
  };
  const walk = (node: DomNode) => {
    if (node.type === 'text') {
      line += node.data ?? '';
      return;
    }
    if (!isContainer(node) || isHidden(node) || SKIP_TAGS.has(node.name ?? '')) return;
    if (node.name === 'table') {
      flush();
      const block = tableBlock(node);
      if (block?.kind === 'para') pushPara(block.text);
      else if (block) blocks.push(block);
      return;
    }
    if (node.name === 'br') {
      flush();
      return;
    }
    const isBlock = BLOCK_TAGS.has(node.name ?? '');
    if (isBlock) flush();
    for (const child of node.children ?? []) walk(child);
    if (isBlock) flush();
  };
  walk($.root()[0] as unknown as DomNode);
  flush();
  return blocks;
}
