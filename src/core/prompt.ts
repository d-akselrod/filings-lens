export const MAX_QUESTION_CHARS = 500;
export const MAX_PASSAGES = 10;

export interface PromptPassage { n: number; ticker: string; fiscalYear: number; item: string; itemTitle: string; text: string }

export const SYSTEM_INSTRUCTION = `You answer questions about SEC Form 10-K annual reports using ONLY the numbered passages provided.
Rules:
1. End every sentence that states a fact with citations like [1] or [2][3] pointing to the passages that support it.
2. Copy numbers exactly as written in the passages, with their units and fiscal period.
3. If the passages do not answer the question, reply exactly: "The provided filings don't answer this." Then stop.
4. Never give investment advice, price predictions, or opinions on buying or selling securities.
5. Answer in at most 6 sentences of plain prose. No headings, lists, or markdown.`;

/** Shared by the Vercel function and the bring-your-own-key path, so both send the same prompt. */
export function buildUserPrompt(question: string, passages: PromptPassage[], previousQuestion?: string): string {
  if (passages.length > MAX_PASSAGES) throw new RangeError(`at most ${MAX_PASSAGES} passages, got ${passages.length}`);
  if (question.length > MAX_QUESTION_CHARS) throw new RangeError(`question is ${question.length} characters; max ${MAX_QUESTION_CHARS}`);
  const context = previousQuestion ? `Previous question (context only): ${previousQuestion}\n\n` : '';
  const body = passages
    .map(p => `[${p.n}] ${p.ticker} 10-K FY${p.fiscalYear} — Item ${p.item} ${p.itemTitle}\n${p.text}\n\n`)
    .join('');
  return `${context}Passages:\n${body}Question: ${question}`;
}
