import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEnv, formatEnvReport, assertEnv } from './env.ts';
import { databaseConfig } from './database-config.ts';

const base = { DATABASE_URL: 'postgres://cafe_app.ref:secret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres', NODE_ENV: 'production', DATABASE_SSL_CA: 'test-ca' };
const local = { DATABASE_URL: 'postgres://cafe:cafe@localhost:5432/cafe', NODE_ENV: 'development' };

test('a complete production environment passes', () => {
  assert.equal(checkEnv(base).ok, true);
  assert.doesNotThrow(() => assertEnv(base));
});

test('every missing variable is named at once, not one per restart', () => {
  const report = checkEnv({ NODE_ENV: 'production' });
  assert.equal(report.ok, false);
  assert.ok(report.missing.some((m) => m.startsWith('DATABASE_URL')));
  assert.equal(report.missing.length, 1, 'runtime does not need seed credentials');
});

test('runtime needs no seed password, including outside development', () => {
  const dev = { ...base, NODE_ENV: 'development' };
  assert.equal(checkEnv(dev).ok, true);

  // Unset NODE_ENV counts as not-development: a server is the place least likely to set it.
  const unset = { DATABASE_URL: local.DATABASE_URL };
  assert.equal(checkEnv(unset).ok, true);
});

test('a non-postgres DATABASE_URL is rejected', () => {
  const report = checkEnv({ ...base, DATABASE_URL: 'mysql://nope/x' });
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((p) => p.includes('postgres://')));
});

test('managed hosting loopback URLs fail at startup; native local production is supported', () => {
  const localhost = { ...base, DATABASE_URL: 'postgres://cafe:cafe@localhost:5432/cafe' };
  // A build on a developer machine legitimately points at localhost, so the check is
  // opt-in and off by default.
  assert.equal(checkEnv(localhost).ok, true, 'not flagged during a build');
  assert.equal(checkEnv(localhost, { deployment: true }).ok, true);
  const report = checkEnv({ ...localhost, RENDER: 'true' }, { deployment: true });
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((p) => p.includes('Supabase connection')));
  assert.equal(checkEnv({ ...localhost, HOSTING_PROVIDER: 'netlify' }, { deployment: true }).ok, false);

  // ...but it is perfectly normal in development.
  const dev = { DATABASE_URL: 'postgres://cafe:cafe@localhost:5432/cafe', NODE_ENV: 'development' };
  assert.equal(checkEnv(dev).ok, true);
});

test('production migrations require separate credentials, with a development fallback', () => {
  assert.deepEqual(checkEnv(base, { purpose: 'migration' }).missing, ['DATABASE_MIGRATION_URL', 'APP_DB_PASSWORD']);
  assert.equal(checkEnv(local, { purpose: 'migration' }).ok, true);
  const config = databaseConfig({ ...base, DATABASE_MIGRATION_URL: base.DATABASE_URL.replace('cafe_app.ref', 'postgres.ref'), APP_DB_PASSWORD: 'runtime-secret' }, 'migration');
  assert.match(config.url, /postgres\.ref/);
  assert.equal(config.options.max, 1);
});

test('invalid URLs fail without exposing credentials', () => {
  for (const url of ['mysql://user:super-secret@host/db', 'broken-super-secret', 'postgres://host']) {
    const report = checkEnv({ ...base, DATABASE_URL: url });
    assert.equal(report.ok, false);
    assert.doesNotMatch(formatEnvReport(report), /super-secret/);
  }
});

test('both Supabase transaction poolers fail before opening a connection', () => {
  for (const host of ['aws-0-ap-south-1.pooler.supabase.com', 'db.ref.supabase.co']) {
    assert.throws(() => databaseConfig({ ...base, DATABASE_URL: `postgres://cafe_app:secret@${host}:6543/postgres` }), /Transaction mode is unsupported/);
  }
});

test('production Supabase runtime cannot use admin credentials', () => {
  assert.equal(checkEnv({ ...base, DATABASE_URL: base.DATABASE_URL.replace('cafe_app.ref', 'postgres.ref') }).ok, false);
  assert.equal(checkEnv({ ...base, DATABASE_URL: 'postgres://cafe_app:secret@db.ref.supabase.co:5432/postgres' }).ok, true);
});

test('Supabase TLS verifies certificates even when the URL requests require mode', () => {
  const config = databaseConfig({ ...base, DATABASE_URL: `${base.DATABASE_URL}?sslmode=require`, DATABASE_SSL_CA: 'certificate\\nline' });
  assert.deepEqual(config.options.ssl, { rejectUnauthorized: true, ca: 'certificate\nline' });
  assert.deepEqual(databaseConfig(base).options.ssl, { rejectUnauthorized: true, ca: 'test-ca' });
  assert.deepEqual(checkEnv({ ...base, DATABASE_SSL_CA: '' }).missing, ['DATABASE_SSL_CA']);
  assert.throws(() => databaseConfig({ ...base, DATABASE_URL: `${base.DATABASE_URL}?sslmode=disable` }), /cannot disable TLS/);
  assert.equal(databaseConfig(local).options.ssl, undefined);
});

test('pool size is bounded and defaults to five', () => {
  assert.equal(databaseConfig(local).options.max, 5);
  assert.equal(databaseConfig({ ...local, DATABASE_MAX_CONNECTIONS: '2' }).options.max, 2);
  for (const value of ['0', '21', '1.5', 'bad']) {
    assert.equal(checkEnv({ ...local, DATABASE_MAX_CONNECTIONS: value }).ok, false);
  }
});

test('whitespace is not a value', () => {
  assert.equal(checkEnv({ ...base, DATABASE_URL: '   ' }).ok, false);
});

test('the failure message names what to fix and where to look', () => {
  const msg = formatEnvReport(checkEnv({ NODE_ENV: 'production' }));
  assert.match(msg, /refusing to start/);
  assert.match(msg, /DATABASE_URL/);
  assert.match(msg, /\.env\.example/);
  assert.throws(() => assertEnv({ NODE_ENV: 'production' }), /refusing to start/);
});
