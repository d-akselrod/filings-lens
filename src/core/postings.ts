import { tokenize } from './tokenize';

export interface PostingsTable {
  terms: Array<{ id: number; term: string; df: number; chunkIds: number[]; tfs: number[] }>;
  lengths: Int32Array;
  n: number;
  avgdl: number;
}

/** BM25 inverted index; array index = chunk id. */
export function buildPostings(texts: string[]): PostingsTable {
  const index = new Map<string, { chunkIds: number[]; tfs: number[] }>();
  const lengths = new Int32Array(texts.length);
  texts.forEach((text, id) => {
    const tokens = tokenize(text);
    lengths[id] = tokens.length;
    const tf = new Map<string, number>();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    for (const [term, count] of tf) {
      let entry = index.get(term);
      if (!entry) index.set(term, (entry = { chunkIds: [], tfs: [] }));
      entry.chunkIds.push(id);
      entry.tfs.push(count);
    }
  });
  const terms = [...index.keys()].sort().map((term, id) => {
    const entry = index.get(term)!;
    return { id, term, df: entry.chunkIds.length, chunkIds: entry.chunkIds, tfs: entry.tfs };
  });
  const total = lengths.reduce((sum, len) => sum + len, 0);
  return { terms, lengths, n: texts.length, avgdl: texts.length ? total / texts.length : 0 };
}
