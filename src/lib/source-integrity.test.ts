/**
 * Guards against characters that are invisible in an editor and break things anyway.
 *
 * Every check here exists because the failure actually happened on this project, and in
 * each case the build stayed green while the code was wrong:
 *
 * - **NUL byte.** A scripted edit wrote two into `src/db/stock.ts`. A LATER
 *   search-and-replace against that file then matched nothing, changed nothing, reported
 *   nothing, and `tsc` passed — an audit-log insert shipped as *absent* rather than as
 *   broken. A NUL also makes git treat the path as binary, so `git diff` showed
 *   "Bin 3728 -> 5294 bytes" for the file holding the weighted-average arithmetic.
 * - **UTF-8 BOM.** One sat immediately before `'use client'` in a component. A BOM ahead
 *   of a directive prologue can stop the directive being recognised, which silently turns
 *   a client component into a server one. `tsc` says nothing.
 * - **Zero-width characters.** Paste artefacts. They survive review because nobody can see
 *   them, and they corrupt identifiers and string comparisons.
 * - **CRLF.** `.gitattributes` declares `eol=lf` for source. A file checked in with CRLF
 *   fights that on every checkout and makes scripted edits searching for `\n` silently
 *   fail to match — which is how the NUL incident became a missing feature.
 *
 * The rule this file encodes: **anything that fails by silently producing no error is
 * worth a loud test.**
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Every offending character is built at runtime rather than written literally, so this
 * file passes its own test. An earlier draft embedded a NUL and failed on itself.
 */
const NUL = String.fromCharCode(0x00);
const BOM = String.fromCharCode(0xfeff);
const ZERO_WIDTH: Array<[string, string]> = [
  [String.fromCharCode(0x200b), 'zero-width space'],
  [String.fromCharCode(0x200c), 'zero-width non-joiner'],
  [String.fromCharCode(0x200d), 'zero-width joiner'],
  [String.fromCharCode(0x2060), 'word joiner'],
  [String.fromCharCode(0x00a0), 'non-breaking space'],
  [BOM, 'BOM / zero-width no-break space'],
];

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCANNED = ['src', 'app', 'scripts'];
const SKIP = new Set(['node_modules', '.next', '.git', 'dist']);
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|sql|yml|yaml)$/;

/** LF is required in source. Markdown is exempt: prose is not parsed by a script. */
const LF_REQUIRED = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|sql|yml|yaml)$/;

function* textFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* textFiles(full);
    else if (TEXT.test(entry)) yield full;
  }
}

function scan() {
  const files: Array<{ path: string; buf: Buffer; text: string; lfRequired: boolean }> = [];
  for (const dir of SCANNED) {
    for (const file of textFiles(join(ROOT, dir))) {
      const buf = readFileSync(file);
      files.push({
        path: relative(ROOT, file).replace(/\\/g, '/'),
        buf,
        text: buf.toString('utf8'),
        lfRequired: LF_REQUIRED.test(file),
      });
    }
  }
  return files;
}

const FILES = scan();

test('the scan reaches a real tree', () => {
  // Without this, a broken walker would scan nothing and every check below would pass.
  assert.ok(FILES.length > 25, `expected a real tree, only saw ${FILES.length} files`);
});

test('no source file contains a NUL byte', () => {
  const offenders = FILES.filter((f) => f.buf.indexOf(0) !== -1).map(
    (f) => `${f.path} (byte ${f.buf.indexOf(0)})`,
  );
  assert.deepEqual(
    offenders,
    [],
    'NUL bytes found. A scripted edit has corrupted these files: later search-and-replace ' +
      'against them will silently match nothing, and git will diff them as binary.\n  ' +
      offenders.join('\n  '),
  );
});

test('no source file starts with a UTF-8 BOM', () => {
  const offenders = FILES.filter((f) => f.text.startsWith(BOM)).map((f) => f.path);
  assert.deepEqual(
    offenders,
    [],
    "BOM found at the start of these files. A BOM before a directive such as 'use client' " +
      'can stop it being recognised, silently changing what the module is.\n  ' +
      offenders.join('\n  '),
  );
});

test('no source file contains a zero-width or non-breaking character', () => {
  const offenders: string[] = [];
  for (const f of FILES) {
    for (const [ch, name] of ZERO_WIDTH) {
      // A BOM at position 0 is reported by the BOM test; only flag it mid-file here.
      const at = f.text.indexOf(ch, ch === BOM ? 1 : 0);
      if (at !== -1) {
        const line = f.text.slice(0, at).split('\n').length;
        offenders.push(`${f.path}:${line} — ${name}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'Invisible characters found. These survive review because nobody can see them, and ' +
      'they corrupt identifiers and string comparisons.\n  ' + offenders.join('\n  '),
  );
});

test('source files use LF, not CRLF', () => {
  const offenders = FILES.filter((f) => f.lfRequired && f.text.includes('\r\n')).map((f) => {
    const count = f.text.split('\r\n').length - 1;
    return `${f.path} (${count} CRLF line ending${count === 1 ? '' : 's'})`;
  });
  assert.deepEqual(
    offenders,
    [],
    'CRLF found where .gitattributes declares eol=lf. Beyond fighting git on every ' +
      'checkout, a scripted edit searching for "\\n" silently fails to match a CRLF file — ' +
      'which is how a missing audit-log insert once shipped.\n  ' + offenders.join('\n  '),
  );
});

test('the guards actually detect what they claim to', () => {
  // A guard nobody has watched fail is not yet a guard.
  assert.notEqual(Buffer.from(`a${NUL}b`, 'utf8').indexOf(0), -1, 'NUL detection');
  assert.ok(`${BOM}'use client';`.startsWith(BOM), 'BOM detection');
  assert.notEqual(`const a${String.fromCharCode(0x200b)} = 1`.indexOf(String.fromCharCode(0x200b)), -1, 'zero-width detection');
  assert.ok('line one\r\nline two'.includes('\r\n'), 'CRLF detection');

  // ...and that clean source passes every one of them.
  const clean = "const key = `${a} ${b}`;\n";
  assert.equal(Buffer.from(clean, 'utf8').indexOf(0), -1);
  assert.ok(!clean.startsWith(BOM));
  assert.ok(!clean.includes('\r\n'));
  assert.ok(!ZERO_WIDTH.some(([ch]) => clean.includes(ch)));
});
