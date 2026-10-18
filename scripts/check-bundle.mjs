// Fails the build when anything that looks like a Gemini API key reaches the static bundle.
// Usage: node scripts/check-bundle.mjs [distDir=dist]
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const SCANNED = /\.(js|mjs|css|html|map|json)$/;
const PATTERNS = [/GEMINI_API_KEY/, /AIza[0-9A-Za-z_-]{35}/, /AQ\.[0-9A-Za-z_-]{20,}/];
const configured = process.env.GEMINI_API_KEY;
const literal = configured && configured.length >= 20 ? configured : null;

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (SCANNED.test(entry.name)) yield path;
  }
}

const offenders = [];
for await (const path of files(dist)) {
  const text = await readFile(path, 'utf8');
  if (PATTERNS.some(p => p.test(text)) || (literal && text.includes(literal))) offenders.push(relative(dist, path));
}

if (offenders.length > 0) {
  console.error(`Possible API key in the bundle (the matched text is not printed):\n${offenders.map(f => `  ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('bundle clean');
