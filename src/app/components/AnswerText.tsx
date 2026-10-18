import type { SentenceCheck } from '../../core/citations';

type Segment = { kind: 'text'; text: string } | { kind: 'cite'; ns: number[] } | { kind: 'flag'; text: string };

const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/** Plain runs, citation groups and flagged numbers, in reading order. */
function segments(text: string, flagged: readonly string[]): Segment[] {
  const marks: Array<{ start: number; end: number; segment: Segment }> = [];
  for (const m of text.matchAll(CITATION)) {
    marks.push({ start: m.index!, end: m.index! + m[0].length, segment: { kind: 'cite', ns: m[1]!.split(',').map(n => Number(n.trim())) } });
  }
  let from = 0;
  for (const raw of flagged) {
    const at = text.indexOf(raw, from);
    if (at === -1) continue;
    marks.push({ start: at, end: at + raw.length, segment: { kind: 'flag', text: raw } });
    from = at + raw.length;
  }
  marks.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start < pos) continue;
    if (m.start > pos) out.push({ kind: 'text', text: text.slice(pos, m.start) });
    out.push(m.segment);
    pos = m.end;
  }
  if (pos < text.length) out.push({ kind: 'text', text: text.slice(pos) });
  return out;
}

/** The text after the last checked sentence: still streaming, so not checked yet. */
function unchecked(text: string, checks: readonly SentenceCheck[]): string {
  let pos = 0;
  for (const c of checks) {
    const at = text.indexOf(c.text, pos);
    if (at === -1) break;
    pos = at + c.text.length;
  }
  return text.slice(pos).trimStart();
}

const NO_INVALID: ReadonlySet<number> = new Set();

function Segments({ parts, onCite, invalid = NO_INVALID }: { parts: Segment[]; onCite(n: number): void; invalid?: ReadonlySet<number> }) {
  return parts.map((p, i) => {
    if (p.kind === 'text') return p.text;
    if (p.kind === 'flag') {
      return (
        <mark key={i} data-flag title="Not found in cited passage"
          className="rounded-[3px] bg-transparent text-inherit underline decoration-warn decoration-wavy decoration-1 underline-offset-[3px]">
          {p.text}
        </mark>
      );
    }
    return p.ns.map(n => invalid.has(n) ? (
      <button key={`${i}-${n}`} type="button" disabled data-invalid aria-label={`Source ${n} (not among the passages)`}
        title={`No passage [${n}] was sent to the model`}
        className="mx-px inline-flex h-4 min-w-4 -translate-y-px items-center justify-center rounded-[5px] border border-dashed border-warn px-1 align-middle font-mono text-[10px] leading-none font-semibold text-warn line-through">
        {n}
      </button>
    ) : (
      <button key={`${i}-${n}`} type="button" aria-label={`Source ${n}`} onClick={() => onCite(n)}
        className="mx-px inline-flex h-4 min-w-4 -translate-y-px items-center justify-center rounded-[5px] border border-accline bg-accent px-1 align-middle font-mono text-[10px] leading-none font-semibold text-primary hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
        {n}
      </button>
    ));
  });
}

export function AnswerText({ text, checks, streaming, onCite }: {
  text: string; checks: SentenceCheck[]; streaming: boolean; onCite(n: number): void;
}) {
  const tail = unchecked(text, checks);
  return (
    <p className="text-[14px] leading-[1.7] text-foreground">
      {checks.map((c, i) => (
        <span key={i}>
          {i > 0 && ' '}
          <Segments parts={segments(c.text, c.unsupportedNumbers)} onCite={onCite} invalid={new Set(c.invalidCitations)} />
          {c.missingCitation && (
            <span data-uncited title="This sentence has no citation" role="img" aria-label="No citation"
              className="ml-0.5 inline-block size-1.5 -translate-y-1.5 rounded-full bg-warn" />
          )}
        </span>
      ))}
      {tail && <>{checks.length > 0 && ' '}<Segments parts={segments(tail, [])} onCite={onCite} /></>}
      {streaming && <span data-caret aria-hidden className="ml-0.5 inline-block h-[14px] w-1.5 translate-y-0.5 animate-pulse rounded-[1px] bg-primary/75" />}
    </p>
  );
}
