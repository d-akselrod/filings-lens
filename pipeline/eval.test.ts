import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { parseDraftReply, pickStratified, validateEval, writeEvalFiles } from './eval';

test('parseDraftReply reads fenced JSON and rejects replies without a question', () => {
  expect(parseDraftReply('```json\n{"question": " What drove revenue? ", "answer": "Data center.", "style": "number"}\n```'))
    .toEqual({ question: 'What drove revenue?', answer: 'Data center.', style: 'number' });
  expect(parseDraftReply('{"question": "Q?", "style": "vibes"}')).toEqual({ question: 'Q?', answer: '', style: 'other' });
  expect(parseDraftReply('I cannot help with that.')).toBeNull();
  expect(parseDraftReply('{"answer": "no question"}')).toBeNull();
});

const known = new Set(['k0', 'k1']);
const valid = { id: 'q1', question: 'How does NVIDIA describe export risk?', goldKeys: ['k0'], ticker: 'NVDA', item: '1A', style: 'risk' };

test('validateEval accepts valid lines and reports each problem with its line', () => {
  const { items, errors } = validateEval([
    valid,
    { ...valid, id: 'q2', goldKeys: ['nope'] },
    { ...valid, question: 'Duplicate id?' },
    { ...valid, id: 'q3', question: '   ' },
    { ...valid, id: 'q4', style: 'vibes' },
  ], known);
  expect(items).toEqual([valid]);
  expect(errors).toHaveLength(4);
  expect(errors[0]).toMatch(/line 2.*nope/);
  expect(errors[1]).toMatch(/line 3.*duplicate id "q1"/);
  expect(errors[2]).toMatch(/line 4.*question/);
  expect(errors[3]).toMatch(/line 5.*style/);
});

test('pickStratified takes n per (company, item) cell from long chunks, deterministically', () => {
  const chunks = Array.from({ length: 40 }, (_, i) => ({
    id: i, ticker: i % 2 ? 'AAPL' : 'NVDA', item: i % 4 < 2 ? '1A' : '7', tokenCount: i % 5 === 0 ? 100 : 400,
  }));
  const picked = pickStratified(chunks, ['NVDA', 'AAPL'], ['1A', '7'], 3, 2026);
  expect(picked).toHaveLength(12);
  expect(picked.every(c => c.tokenCount >= 300)).toBe(true);
  expect(pickStratified(chunks, ['NVDA', 'AAPL'], ['1A', '7'], 3, 2026).map(c => c.id)).toEqual(picked.map(c => c.id));
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'evalfiles-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('writeEvalFiles writes hashed files, removes stale ones, and updates the manifest', async () => {
  await mkdir(join(dir, 'v'), { recursive: true });
  await writeFile(join(dir, 'v', 'eval.00000000.json'), '{}');
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, chunkCount: 6 }));
  const manifest = await writeEvalFiles(dir,
    { schemaVersion: 1, questions: [{ ...valid, style: 'risk', vector: 'AAAA' }] },
    { schemaVersion: 1, samples: [{ question: 'Q?', vector: 'AAAA' }, { question: 'Q2?', vector: 'AAAA' }] });
  expect(manifest.eval).toMatchObject({ count: 1 });
  expect(manifest.samples).toMatchObject({ count: 2 });
  expect(manifest.chunkCount).toBe(6);
  const files = await readdir(join(dir, 'v'));
  expect(files).not.toContain('eval.00000000.json');
  expect(files).toContain(manifest.eval!.file.slice(2));
  expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))).toEqual(manifest);
});

test('before the reviewed questions exist, writeEvalFiles publishes the samples alone', async () => {
  await mkdir(join(dir, 'v'), { recursive: true });
  await writeFile(join(dir, 'v', 'eval.00000000.json'), '{}');
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, chunkCount: 6, eval: { file: 'v/eval.00000000.json', count: 3 } }));
  const manifest = await writeEvalFiles(dir, null, { schemaVersion: 1, samples: [{ question: 'Q?', vector: 'AAAA' }] });
  expect(manifest.eval).toBeUndefined();
  expect(manifest.samples).toMatchObject({ count: 1 });
  const files = await readdir(join(dir, 'v'));
  expect(files.filter(f => f.startsWith('eval.'))).toEqual([]);
  expect(files).toContain(manifest.samples!.file.slice(2));
  expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))).toEqual(manifest);
});
