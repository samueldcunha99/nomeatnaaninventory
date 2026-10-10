/** Restore only into an empty, separate database and compare exact snapshot counts. */
import postgres from 'postgres';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { databaseConfig } from '../src/lib/database-config.ts';
import { assertSeparateRestore } from '../src/lib/restore-safety.ts';
import { checksum, withPostgresTools } from './postgres-tools.ts';

const source = process.env.BACKUP_DATABASE_URL?.trim();
const target = process.env.RESTORE_DATABASE_URL?.trim();
const input = process.argv[2];
if (!source || !target || !input) throw new Error('Set BACKUP_DATABASE_URL and RESTORE_DATABASE_URL, then pass a dump path.');
assertSeparateRestore(source, target);
const file = resolve(input);
const manifest = z.object({ version: z.literal(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  tables: z.array(z.object({ schema: z.enum(['public', 'drizzle']), name: z.string().regex(/^[a-z_][a-z0-9_]*$/), count: z.string().regex(/^\d+$/) })).min(1),
}).parse(JSON.parse(await readFile(`${file}.json`, 'utf8')));
if (await checksum(file) !== manifest.sha256) throw new Error('Dump checksum does not match its manifest.');
const ca = process.env.RESTORE_DATABASE_SSL_CA;
const config = databaseConfig({ DATABASE_URL: target, DATABASE_SSL_CA: ca, NODE_ENV: 'development' });
const sql = postgres(config.url, { ...config.options, max: 1 });
const listFile = `${file}.restore-list`;
try {
  const [existing] = await sql`select count(*)::text as count from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'drizzle') and c.relkind in ('r', 'p', 'S', 'v', 'm', 'f')`;
  if (existing.count !== '0') throw new Error('Restore refused: target public/drizzle schemas are not empty.');
  const namespaces = await sql<{ name: string }[]>`select nspname as name from pg_namespace where nspname in ('public', 'drizzle')`;
  await withPostgresTools(target, ca, async (run) => {
    // Fresh PostgreSQL and Supabase projects already have public. Avoid recreating it.
    const list = await run('pg_restore', ['--list', file]);
    const filtered = list.split('\n').filter((line) => !namespaces.some(({ name }) => line.includes(` SCHEMA - ${name} `))).join('\n');
    await writeFile(listFile, filtered, { mode: 0o600 });
    await run('pg_restore', ['--dbname', config.url ? decodeURIComponent(new URL(config.url).pathname.slice(1)) : '',
      '--exit-on-error', '--no-owner', '--no-acl', `--use-list=${listFile}`, file]);
  });
  for (const table of manifest.tables) {
    const [row] = await sql`select count(*)::text as count from ${sql(`${table.schema}.${table.name}`)}`;
    if (row.count !== table.count) throw new Error(`Restore count mismatch for ${table.schema}.${table.name}: expected ${table.count}, got ${row.count}.`);
    console.log(`${table.schema}.${table.name}: ${row.count} rows, matches backup snapshot`);
  }
  for (const trigger of ['stock_movements_no_update', 'production_runs_no_update']) {
    const [row] = await sql`select count(*)::text as count from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and t.tgname = ${trigger} and t.tgenabled <> 'D'`;
    if (row.count !== '1') throw new Error(`Restored append-only trigger missing/disabled: ${trigger}`);
  }
  console.log('RESTORE OK. The test database remains available for inspection; do not point production at it.');
} finally {
  await sql.end({ timeout: 5 });
  await unlink(listFile).catch(() => {});
}
