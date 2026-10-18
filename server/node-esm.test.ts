import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
let dir: string;

beforeAll(async () => {
  await mkdir(join(root, 'node_modules/.cache'), { recursive: true });
  dir = await mkdtemp(join(root, 'node_modules/.cache/esm-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * Vercel's Node runtime compiles each function file without bundling and runs the output as ES modules,
 * where every relative import needs its file extension. tsx and Vite forgive a missing one; Node does not.
 */
test('the compiled API functions load and answer under plain Node ES modules', async () => {
  const out = join(dir, 'out');
  await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({
    extends: join(root, 'tsconfig.json'),
    compilerOptions: { noEmit: false, outDir: out, rootDir: root, declaration: false, sourceMap: false },
    include: [join(root, 'api/*.ts')],
    exclude: [join(root, '**/*.test.ts')],
  }));
  await run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(dir, 'tsconfig.json')]).catch(() => {
    // Type errors still emit JavaScript; the import below is the real check.
  });
  await writeFile(join(out, 'package.json'), '{ "type": "module" }');

  const url = (p: string) => pathToFileURL(join(out, p)).href;
  const script = `
    const status = await import(${JSON.stringify(url('api/status.js'))});
    await import(${JSON.stringify(url('api/embed.js'))});
    await import(${JSON.stringify(url('api/answer.js'))});
    const res = await status.default.fetch(new Request('https://filings.example/api/status', { headers: { 'x-vercel-ip-country': 'US' } }));
    console.log(JSON.stringify({ status: res.status, body: await res.json() }));
  `;
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], { env: { PATH: process.env.PATH ?? '' } });
  expect(JSON.parse(stdout)).toEqual({ status: 200, body: { region: 'ok', builtInKey: 'missing' } });
}, 60_000);
