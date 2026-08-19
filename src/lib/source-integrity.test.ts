/**
 * Guards against the worst failure this project has hit: a scripted edit wrote a NUL
 * byte into a source file, which then made a LATER search-and-replace silently no-op -
 * it matched nothing, changed nothing, reported nothing, and `tsc` passed. The missing
 * code (an audit-log insert) shipped as absent rather than as broken.
 *
 * A NUL in a text file also makes git treat it as binary, so diffs stop being readable
 * exactly when you most need to read them.
 *
 * Anything that fails by silently producing no error is worth a loud test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Built at runtime, never written as a raw byte: this file must pass its own test.
const NUL = String.fromCharCode(0);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCANNED = ['src', 'app', 'scripts'];
const SKIP = new Set(['node_modules', '.next', '.git', 'dist']);
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|sql|yml|yaml)$/;

function* textFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* textFiles(full);
    else if (TEXT.test(entry)) yield full;
  }
}

test('no source file contains a NUL byte', () => {
  const offenders: string[] = [];
  let scanned = 0;

  for (const dir of SCANNED) {
    for (const file of textFiles(join(ROOT, dir))) {
      scanned++;
      const at = readFileSync(file).indexOf(0);
      if (at !== -1) offenders.push(`${relative(ROOT, file)} (byte ${at})`);
    }
  }

  // Without this, a broken walker would scan nothing and pass forever.
  assert.ok(scanned > 20, `expected to scan a real tree, only saw ${scanned} files`);
  assert.deepEqual(
    offenders,
    [],
    'NUL bytes found. A scripted edit has corrupted these files, and later ' +
      'search-and-replace against them will silently match nothing:\n  ' +
      offenders.join('\n  '),
  );
});

test('the guard actually detects a NUL byte', () => {
  // The exact shape of the corruption that happened: the separator inside a template
  // literal replaced by NUL. Without this check a broken detector passes everything.
  const corrupted = Buffer.from(`const key = \`\${a}${NUL}\${b}\`;`, 'utf8');
  assert.notEqual(corrupted.indexOf(0), -1, 'a NUL must be detected');
  assert.equal(Buffer.from('const key = `${a} ${b}`;', 'utf8').indexOf(0), -1, 'clean source passes');
});
