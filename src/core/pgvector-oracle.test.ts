import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { expect, test } from 'vitest';
import { seededRandom } from './test-fixtures';
import { distance } from './vector';

const literal = (v: Float32Array) => `[${Array.from(v).join(',')}]`;

test('hand-written distances match pgvector operators', async () => {
  const db = await PGlite.create('memory://', { extensions: { vector } });
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector; CREATE TABLE v (id int PRIMARY KEY, e vector(768));');
  const r = seededRandom(11);
  const rows = Array.from({ length: 50 }, () => Float32Array.from({ length: 768 }, () => r() * 4 - 2));
  for (const [id, e] of rows.entries()) await db.query('INSERT INTO v VALUES ($1, $2)', [id, literal(e)]);
  const q = Float32Array.from({ length: 768 }, () => r() * 4 - 2);
  const res = await db.query<{ id: number; l2: number; cos: number; ip: number }>(
    'SELECT id, e <-> $1 AS l2, e <=> $1 AS cos, e <#> $1 AS ip FROM v ORDER BY id', [literal(q)]);
  expect(res.rows).toHaveLength(50);
  for (const row of res.rows) {
    const e = rows[row.id]!;
    for (const [metric, pg] of [['l2', row.l2], ['cosine', row.cos], ['dot', row.ip]] as const) {
      expect(Math.abs(distance(metric, e, q) - pg)).toBeLessThan(1e-4 * Math.max(1, Math.abs(pg)));
    }
  }
  await db.close();
});
