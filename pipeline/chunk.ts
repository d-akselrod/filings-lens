import type { Block } from './html-blocks';

export const CHUNK = { targetTokens: 500, maxTokens: 600, overlapTokens: 75 } as const;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface ChunkOut { ordinal: number; text: string; tokenCount: number }

interface Unit { text: string; block: number; row?: { header: boolean; headerText: string } }

function splitParagraph(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];
  const pieces: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/)) {
    if (estimateTokens(sentence) <= maxTokens) {
      pieces.push(sentence);
      continue;
    }
    let piece = '';
    for (const word of sentence.split(/\s+/)) {
      const next = piece ? `${piece} ${word}` : word;
      if (piece && estimateTokens(next) > maxTokens) {
        pieces.push(piece);
        piece = word;
      } else {
        piece = next;
      }
    }
    if (piece) pieces.push(piece);
  }
  return pieces;
}

function toUnits(blocks: Block[], maxTokens: number): Unit[] {
  return blocks.flatMap((b, block): Unit[] => {
    if (b.kind === 'para') return splitParagraph(b.text, maxTokens).map(text => ({ text, block }));
    const headerText = b.rows[0]?.join(' | ') ?? '';
    return b.rows.map((row, r) => ({ text: row.join(' | '), block, row: { header: r === 0, headerText } }));
  });
}

/** Units of the same block join with a line break; different blocks with a blank line. */
function render(units: Unit[]): string {
  return units.map((u, i) => (i === 0 ? '' : units[i - 1]!.block === u.block ? '\n' : '\n\n') + u.text).join('');
}

const tokensOf = (units: Unit[]) => estimateTokens(render(units));

/** Trailing units totaling ≥ overlapTokens: at least one, never all. */
function trailing(units: Unit[], overlapTokens: number): Unit[] {
  for (let k = 1; k < units.length; k++) {
    const tail = units.slice(-k);
    if (tokensOf(tail) >= overlapTokens) return tail;
  }
  return units.slice(1);
}

/** A chunk that opens inside a table repeats that table's header row first. */
function withHeader(start: Unit[]): Unit[] {
  const first = start[0];
  if (!first?.row || first.row.header) return start;
  return [{ text: first.row.headerText, block: first.block, row: { header: true, headerText: first.row.headerText } }, ...start];
}

export function chunkSection(blocks: Block[], o: { targetTokens: number; maxTokens: number; overlapTokens: number } = CHUNK): ChunkOut[] {
  const chunks: Unit[][] = [];
  let current: Unit[] = [];
  let added = 0;
  for (const unit of toUnits(blocks, o.maxTokens)) {
    if (added > 0 && (tokensOf(current) >= o.targetTokens || tokensOf([...current, unit]) > o.maxTokens)) {
      chunks.push(current);
      current = withHeader([...trailing(current, o.overlapTokens), unit]).slice(0, -1);
      if (tokensOf([...current, unit]) > o.maxTokens) current = withHeader([unit]).slice(0, -1);
      added = 0;
    }
    current.push(unit);
    added++;
  }
  if (added > 0) chunks.push(current);
  return chunks.map((units, ordinal) => {
    const text = render(units);
    return { ordinal, text, tokenCount: estimateTokens(text) };
  });
}
