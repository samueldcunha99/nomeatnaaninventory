import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { databaseConfig } from '../src/lib/database-config.ts';
import { isSupabaseHost } from '../src/lib/env.ts';

export async function checksum(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Passwords go through child environment variables, never command arguments or logs. */
export async function withPostgresTools<T>(connection: string, certificate: string | undefined,
  work: (run: (command: string, args: string[]) => Promise<string>) => Promise<T>): Promise<T> {
  databaseConfig({ DATABASE_URL: connection, DATABASE_SSL_CA: certificate, NODE_ENV: 'development' });
  const url = new URL(connection);
  const ca = certificate?.trim().replace(/\\n/g, '\n');
  if (isSupabaseHost(url.hostname) && !ca) throw new Error('DATABASE_SSL_CA is required by the native Supabase backup/restore tools.');
  const directory = await mkdtemp(join(tmpdir(), 'cafe-pg-'));
  try {
    const env = { ...process.env, PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGCONNECT_TIMEOUT: '10',
      PGSSLMODE: ca ? 'verify-full' : (url.searchParams.get('sslmode') || 'prefer') };
    if (ca) {
      const path = join(directory, 'root.crt');
      await writeFile(path, ca, { mode: 0o600 });
      Object.assign(env, { PGSSLROOTCERT: path });
    }
    const run = (command: string, args: string[]) => new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, { env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
      // Native tools may print connection details. Report the failed operation only.
      child.stderr.resume();
      child.once('error', () => reject(new Error(`${command} could not start. Install PostgreSQL client tools and add them to PATH.`)));
      child.once('close', (code) => code === 0 ? resolve(output) : reject(new Error(`${command} failed (exit ${code}). Check the client version, credentials and database permissions.`)));
    });
    return await work(run);
  } finally {
    await rm(join(directory, 'root.crt'), { force: true });
    await rmdir(directory);
  }
}
