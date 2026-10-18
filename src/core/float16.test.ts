import { expect, test } from 'vitest';
import { decodeF16, encodeF16 } from './float16';
import { seededRandom } from './test-fixtures';

const bits = (x: number) => Array.from(encodeF16(new Float32Array([x])));

test('exact bit patterns', () => {
  expect(bits(1)).toEqual([0x00, 0x3c]);
  expect(bits(-2)).toEqual([0x00, 0xc0]);
  expect(bits(65504)).toEqual([0xff, 0x7b]);
  expect(bits(2 ** -14)).toEqual([0x00, 0x04]);
  expect(bits(2 ** -24)).toEqual([0x01, 0x00]);
  expect(bits(70000)).toEqual([0x00, 0x7c]);
  expect(bits(0)).toEqual([0, 0]);
});

test('rounds half to even', () => {
  expect(bits(1 + 2 ** -11)).toEqual([0x00, 0x3c]);
  expect(bits(1 + 3 * 2 ** -11)).toEqual([0x02, 0x3c]);
});

test('round-trips within 1e-3 relative', () => {
  const r = seededRandom(1);
  const v = Float32Array.from({ length: 1000 }, () => r() * 2 - 1);
  decodeF16(encodeF16(v)).forEach((x, i) => {
    if (Math.abs(v[i]!) > 1e-3) expect(Math.abs(x - v[i]!) / Math.abs(v[i]!)).toBeLessThan(1e-3);
  });
});

test('decodes subnormals, signs and infinity', () => {
  expect(Array.from(decodeF16(Uint8Array.from([0x01, 0x00, 0x00, 0xc0, 0x00, 0x7c])))).toEqual([2 ** -24, -2, Infinity]);
});
