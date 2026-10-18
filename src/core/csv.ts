const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

function field(value: string | number | Uint8Array | number[]): string {
  if (typeof value === 'number') return String(value);
  if (value instanceof Uint8Array) {
    let hex = '\\x';
    for (const byte of value) hex += HEX[byte];
    return hex;
  }
  if (Array.isArray(value)) return `"{${value.join(',')}}"`;
  return `"${value.replace(/"/g, '""')}"`;
}

/** One RFC 4180 row for `COPY … WITH (FORMAT csv)`; bytea as \x hex, int arrays as "{1,2}". */
export function csvRow(fields: Array<string | number | Uint8Array | number[]>): string {
  return fields.map(field).join(',') + '\n';
}
