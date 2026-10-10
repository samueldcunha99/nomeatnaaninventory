/** CI-only rehearsal on disposable databases; exercises the actual deployment scripts. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { databaseConfig } from '../src/lib/database-config.ts';

if (process.env.CI !== 'true') throw new Error('Deployment rehearsal is CI-only. Use disposable databases.');
const directory = await mkdtemp(join(tmpdir(), 'cafe-deploy-check-'));
const environment = { ...process.env, BACKUP_DIR: directory,
  BOOTSTRAP_TENANT_NAME: 'Deployment rehearsal', BOOTSTRAP_OWNER_NAME: 'CI owner',
  BOOTSTRAP_OWNER_EMAIL: 'ci-owner@example.test', BOOTSTRAP_OWNER_PASSWORD: 'ci-owner-only-password' };
function run(file: string, args: string[] = [], expectedFailure?: RegExp) {
  const result = spawnSync(process.execPath, [file, ...args], { env: environment, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (!expectedFailure) {
    process.stdout.write(result.stdout);
    if (result.status !== 0) process.stderr.write(result.stderr);
    assert.equal(result.status, 0, `${file} failed`);
  } else {
    assert.notEqual(result.status, 0, `${file} unexpectedly succeeded`);
    assert.match(result.stderr, expectedFailure, `${file} failed for a different reason`);
  }
}

run('src/db/migrate.ts');
run('src/db/migrate.ts'); // Role provisioning and migration history must be idempotent.
run('deploy/bootstrap-owner.ts');
run('deploy/bootstrap-owner.ts', [], /a tenant already exists/); // Prove first-owner refuses an existing tenant.

const config = databaseConfig();
const sql = postgres(config.url, config.options);
try {
  const [owner] = await sql`select count(*)::text as count from public.users where role = 'owner'`;
  assert.equal(owner.count, '1');
  await assert.rejects(sql.begin(async (tx) => { await tx`create table public.runtime_probe (id integer)`; }), { code: '42501' });
  await assert.rejects(sql.begin(async (tx) => { await tx`alter table public.tenants add column runtime_probe integer`; }), { code: '42501' });
  await sql.begin(async (tx) => {
    await tx`update public.tenants set name = 'Runtime write verified'`;
    const [row] = await tx`select name from public.tenants`;
    assert.equal(row.name, 'Runtime write verified');
  });
  console.log('Runtime role reads/writes app data and cannot create or alter tables.');
} finally {
  await sql.end({ timeout: 5 });
}

run('deploy/backup.ts');
const dumps = (await readdir(directory)).filter((name) => name.endsWith('.dump'));
assert.equal(dumps.length, 1);
const dump = join(directory, dumps[0]);
run('deploy/restore-check.ts', [dump]);
run('deploy/restore-check.ts', [dump], /schemas are not empty/); // Prove the nonempty-target guard.
console.log('Deployment scripts rehearsed against native PostgreSQL.');
