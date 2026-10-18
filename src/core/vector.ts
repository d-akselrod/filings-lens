import type { Hit, Metric } from './types';

export interface VectorMatrix { data: Float32Array; count: number; width: 768 }

/** pgvector semantics: l2 = Euclidean distance, cosine = 1 − cos similarity, dot = −(a·b). Lower is better. */
export function distance(metric: Metric, a: Float32Array, b: Float32Array, dims = Math.min(a.length, b.length)): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  let sq = 0;
  for (let i = 0; i < dims; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
    sq += (x - y) * (x - y);
  }
  if (metric === 'dot') return -dot;
  if (metric === 'l2') return Math.sqrt(sq);
  return na === 0 || nb === 0 ? 1 : 1 - dot / Math.sqrt(na * nb);
}

export function prepareQuery(q: Float32Array, dims: number, renormalize: boolean): Float32Array {
  const out = Float32Array.from(q.subarray(0, dims));
  if (!renormalize) return out;
  let norm = 0;
  for (let i = 0; i < out.length; i++) norm += out[i]! * out[i]!;
  if (norm > 0) {
    const scale = 1 / Math.sqrt(norm);
    for (let i = 0; i < out.length; i++) out[i] = out[i]! * scale;
  }
  return out;
}

/** Exact top-k over the matrix rows; ascending distance, ties by id. allow[i] === 1 marks eligible rows. */
export function scan(m: VectorMatrix, q: Float32Array,
  o: { metric: Metric; dims: number; renormalize: boolean; k: number; allow: Uint8Array | null }): Hit[] {
  const dims = Math.min(o.dims, m.width, q.length);
  const normalize = o.metric === 'cosine' || o.renormalize;
  const query = prepareQuery(q, dims, normalize);
  const heap = new BestK(o.k);
  for (let i = 0; i < m.count; i++) {
    if (o.allow && o.allow[i] !== 1) continue;
    const base = i * m.width;
    let dot = 0;
    let nd = 0;
    let sq = 0;
    for (let j = 0; j < dims; j++) {
      const x = m.data[base + j]!;
      const y = query[j]!;
      dot += x * y;
      nd += x * x;
      sq += (x - y) * (x - y);
    }
    let score: number;
    if (normalize) {
      const cos = nd > 0 ? dot / Math.sqrt(nd) : 0;
      if (o.metric === 'cosine') score = nd > 0 ? 1 - cos : 1;
      else if (o.metric === 'dot') score = -cos;
      else score = Math.sqrt(Math.max(0, 2 - 2 * cos));
    } else {
      score = o.metric === 'dot' ? -dot : Math.sqrt(sq);
    }
    heap.offer(i, score);
  }
  return heap.sorted();
}

/** Bounded max-heap keeping the k best (smallest score, then smallest id) hits. */
class BestK {
  private readonly ids: number[] = [];
  private readonly scores: number[] = [];
  constructor(private readonly k: number) {}

  offer(id: number, score: number): void {
    if (this.k <= 0) return;
    if (this.ids.length < this.k) {
      this.ids.push(id);
      this.scores.push(score);
      this.siftUp(this.ids.length - 1);
    } else if (this.worse(0, score, id)) {
      this.ids[0] = id;
      this.scores[0] = score;
      this.siftDown(0);
    }
  }

  sorted(): Hit[] {
    return this.ids
      .map((id, i) => ({ id, score: this.scores[i]! }))
      .sort((a, b) => a.score - b.score || a.id - b.id);
  }

  /** Is the entry at heap index i worse than (score, id)? */
  private worse(i: number, score: number, id: number): boolean {
    const s = this.scores[i]!;
    return s > score || (s === score && this.ids[i]! > id);
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.worse(parent, this.scores[i]!, this.ids[i]!)) return;
      this.swap(i, parent);
      i = parent;
    }
  }

  private siftDown(i: number): void {
    for (;;) {
      let worst = i;
      for (const child of [2 * i + 1, 2 * i + 2]) {
        if (child < this.ids.length && this.worse(child, this.scores[worst]!, this.ids[worst]!)) worst = child;
      }
      if (worst === i) return;
      this.swap(i, worst);
      i = worst;
    }
  }

  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b]!, this.ids[a]!];
    [this.scores[a], this.scores[b]] = [this.scores[b]!, this.scores[a]!];
  }
}
