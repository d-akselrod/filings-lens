/** Deterministic helpers for tests only. */

/** mulberry32 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gaussian (Box–Muller) vectors scaled to unit length. */
export function randomUnitVectors(n: number, dims: number, seed: number): Float32Array[] {
  const r = seededRandom(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  return Array.from({ length: n }, () => {
    const v = Array.from({ length: dims }, gauss);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return Float32Array.from(v, x => x / norm);
  });
}
