import { expect, test } from 'vitest';
import { seededRandom } from './test-fixtures';
import { decodeVectorB64, encodeVectorB64 } from './vector-b64';

test('base64 vector codec round-trips through float16', () => {
  const r = seededRandom(5);
  const v = Float32Array.from({ length: 768 }, () => r() * 2 - 1);
  const back = decodeVectorB64(encodeVectorB64(v));
  expect(back).toHaveLength(768);
  back.forEach((x, i) => expect(Math.abs(x - v[i]!)).toBeLessThan(1e-3));
});
