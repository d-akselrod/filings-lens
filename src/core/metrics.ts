/** Share of gold ids that appear in the top k. */
export function recallAtK(ranked: number[], gold: ReadonlySet<number>, k: number): number {
  if (gold.size === 0) return 0;
  return ranked.slice(0, k).filter(id => gold.has(id)).length / gold.size;
}

/** 1 / rank of the first gold id within the top k, else 0. */
export function mrrAtK(ranked: number[], gold: ReadonlySet<number>, k: number): number {
  const index = ranked.slice(0, k).findIndex(id => gold.has(id));
  return index === -1 ? 0 : 1 / (index + 1);
}

/** Binary-relevance nDCG with a log2(rank + 1) discount. */
export function ndcgAtK(ranked: number[], gold: ReadonlySet<number>, k: number): number {
  if (gold.size === 0) return 0;
  const dcg = ranked.slice(0, k).reduce((sum, id, i) => sum + (gold.has(id) ? 1 / Math.log2(i + 2) : 0), 0);
  let ideal = 0;
  for (let i = 0; i < Math.min(gold.size, k); i++) ideal += 1 / Math.log2(i + 2);
  return dcg / ideal;
}
