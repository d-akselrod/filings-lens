import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';

const script = fileURLToPath(new URL('./check-bundle.mjs', import.meta.url));
let dist: string;

beforeEach(async () => {
  dist = await mkdtemp(join(tmpdir(), 'dist-'));
  await mkdir(join(dist, 'assets'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><script type="module" src="/assets/index.js"></script>');
  await writeFile(join(dist, 'assets/index.js'), 'export const answer = 42;');
});
afterEach(async () => {
  await rm(dist, { recursive: true, force: true });
});

const check = (env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [script, dist], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });

test('a clean bundle passes', () => {
  const r = check();
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('bundle clean');
});

test('a Google API key in the bundle fails the build and names the file', async () => {
  await writeFile(join(dist, 'assets/chunk-abc.js'), `const k="AIza${'x'.repeat(35)}";`);
  const r = check();
  expect(r.status).toBe(1);
  expect(r.stdout + r.stderr).toContain('assets/chunk-abc.js');
});

test('the variable name, AQ.-style keys, source maps and the configured key value are caught too', async () => {
  await writeFile(join(dist, 'assets/a.js'), 'console.log(import.meta.env.GEMINI_API_KEY)');
  await writeFile(join(dist, 'assets/b.js.map'), `{"sources":["AQ.${'Ab8_-'.repeat(5)}"]}`);
  await writeFile(join(dist, 'assets/c.css'), '/* my-very-secret-key-value-123 */');
  const r = check({ GEMINI_API_KEY: 'my-very-secret-key-value-123' });
  expect(r.status).toBe(1);
  const out = r.stdout + r.stderr;
  for (const f of ['assets/a.js', 'assets/b.js.map', 'assets/c.css']) expect(out).toContain(f);
  expect(out).not.toContain('my-very-secret-key-value-123');
});
