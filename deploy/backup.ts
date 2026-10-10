/** Native PostgreSQL dump plus counts from the SAME exported snapshot. */
import postgres from 'postgres';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { databaseConfig } from '../src/lib/database-config.ts';
import { checksum, withPostgresTools } from './postgres-tools.ts';

const connection = process.env.BACKUP_DATABASE_URL?.trim();
if (!connection) throw new Error('BACKUP_DATABASE_URL is required. Use the admin direct or session connection.');
const config = databaseConfig({ DATABASE_URL: connection, DATABASE_SSL_CA: process.env.DATABASE_SSL_CA, NODE_ENV: 'development' });
const sql = postgres(config.url, { ...config.options, max: 1 });
const directory = resolve(process.env.BACKUP_DIR?.trim() || 'backups');
const file = join(directory, `cafe-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
await mkdir(directory, { recursive: true });

try {
  await withPostgresTools(connection, process.env.DATABASE_SSL_CA, async (run) => {
    await sql.begin('isolation level repeatable read read only', async (tx) => {
      const [snapshot] = await tx`select pg_export_snapshot() as id`;
      const tables = await tx<{ schema: string; name: string }[]>`
        select schemaname as schema, tablename as name from pg_tables
        where schemaname in ('public', 'drizzle') order by schemaname, tablename`;
      if (!tables.some((table) => table.name === 'stock_movements')) throw new Error('Backup refused: no cafe ledger found.');
      const counts = [];
      for (const table of tables) {
        const [row] = await tx`select count(*)::text as count from ${tx(`${table.schema}.${table.name}`)}`;
        counts.push({ ...table, count: row.count });
      }
      await run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--schema=public', '--schema=drizzle',
        `--snapshot=${snapshot.id}`, `--file=${file}.partial`]);
      if ((await stat(`${file}.partial`)).size < 5120) throw new Error('Dump is implausibly small; kept as .partial for inspection.');
      const sha256 = await checksum(`${file}.partial`);
      await writeFile(`${file}.json.partial`, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), sha256, tables: counts }, null, 2), { mode: 0o600 });
      await rename(`${file}.partial`, file);
      await rename(`${file}.json.partial`, `${file}.json`);
    });
  });
  console.log(`Backup written: ${file}. Copy the dump and its .json manifest to off-site storage.`);
} finally {
  await sql.end({ timeout: 5 });
}
