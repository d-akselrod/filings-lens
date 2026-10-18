import { stemmer } from 'stemmer';
import { STOPWORDS } from './stopwords';

const THOUSANDS_SEPARATOR = /(\d),(?=\d{3}(?:\D|$))/g;
const NON_TOKEN = /[^a-z0-9.]+/;
const EDGE_DOTS = /^\.+|\.+$/g;

/** The single tokenizer shared by the pipeline, the browser, and the BM25 index. */
export function tokenize(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase().replace(THOUSANDS_SEPARATOR, '$1');
  const tokens: string[] = [];
  for (const raw of normalized.split(NON_TOKEN)) {
    const token = raw.replace(EDGE_DOTS, '');
    if (!token || STOPWORDS.has(token)) continue;
    if (token.length === 1 && !/^\d$/.test(token)) continue;
    tokens.push(/^[a-z]+$/.test(token) ? stemmer(token) : token);
  }
  return tokens;
}
