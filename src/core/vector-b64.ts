import { decodeF16, encodeF16 } from './float16.js';

/** float16 little-endian bytes, base64-encoded (works in Node and browsers). */
export function encodeVectorB64(v: Float32Array): string {
  let binary = '';
  for (const byte of encodeF16(v)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeVectorB64(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return decodeF16(bytes);
}
