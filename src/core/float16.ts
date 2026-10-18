const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** IEEE 754 binary32 → binary16 bits, round-to-nearest-even. */
function toHalfBits(value: number): number {
  f32[0] = value;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  let e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - e;
    return sign | ((mant + (1 << (shift - 1)) - 1 + ((mant >>> shift) & 1)) >>> shift);
  }
  const rounded = mant + 0xfff + ((mant >>> 13) & 1);
  if (rounded & 0x800000) {
    e += 1;
    return e >= 0x1f ? sign | 0x7c00 : sign | (e << 10);
  }
  return sign | (e << 10) | (rounded >>> 13);
}

let table: Float32Array | null = null;

function halfTable(): Float32Array {
  if (table) return table;
  table = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const sign = h & 0x8000 ? -1 : 1;
    const exp = (h >>> 10) & 0x1f;
    const mant = h & 0x3ff;
    table[h] = exp === 0 ? sign * mant * 2 ** -24
      : exp === 0x1f ? (mant ? NaN : sign * Infinity)
      : sign * (1 + mant / 1024) * 2 ** (exp - 15);
  }
  return table;
}

/** Little-endian float16 bytes, two per value. */
export function encodeF16(values: Float32Array): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  for (let i = 0; i < values.length; i++) {
    const h = toHalfBits(values[i]!);
    out[2 * i] = h & 0xff;
    out[2 * i + 1] = h >>> 8;
  }
  return out;
}

export function decodeF16(bytes: Uint8Array, out: Float32Array = new Float32Array(bytes.length >>> 1)): Float32Array {
  const t = halfTable();
  for (let i = 0; i < out.length; i++) out[i] = t[bytes[2 * i]! | (bytes[2 * i + 1]! << 8)]!;
  return out;
}
