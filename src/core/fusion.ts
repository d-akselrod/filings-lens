import type { Hit } from './types';

export interface Fused { id: number; score: number; vectorRank?: number; keywordRank?: number }

/**
 * Weighted reciprocal rank fusion: score = α/(k + rank_vector) + (1 − α)/(k + rank_keyword).
 * Ranks are 1-based positions in each input list; a list that lacks the id adds nothing.
 */
export function fuseRrf(vector: Hit[], keyword: Hit[], o: { k: number; alpha: number }): Fused[] {
  const fused = new Map<number, Fused>();
  const entry = (id: number) => {
    let f = fused.get(id);
    if (!f) fused.set(id, (f = { id, score: 0 }));
    return f;
  };
  vector.forEach((hit, i) => {
    const f = entry(hit.id);
    f.vectorRank = i + 1;
    f.score += o.alpha / (o.k + i + 1);
  });
  keyword.forEach((hit, i) => {
    const f = entry(hit.id);
    f.keywordRank = i + 1;
    f.score += (1 - o.alpha) / (o.k + i + 1);
  });
  const bestRank = (f: Fused) => Math.min(f.vectorRank ?? Infinity, f.keywordRank ?? Infinity);
  return [...fused.values()].sort((a, b) => b.score - a.score || bestRank(a) - bestRank(b) || a.id - b.id);
}
