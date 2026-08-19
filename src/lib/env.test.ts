import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEnv, formatEnvReport, assertEnv } from './env.ts';

const base = { DATABASE_URL: 'postgres://cafe:cafe@db:5432/cafe', NODE_ENV: 'production', SEED_OWNER_PASSWORD: 'x' };

test('a complete production environment passes', () => {
  assert.equal(checkEnv(base).ok, true);
  assert.doesNotThrow(() => assertEnv(base));
});

test('every missing variable is named at once, not one per restart', () => {
  const report = checkEnv({ NODE_ENV: 'production' });
  assert.equal(report.ok, false);
  assert.ok(report.missing.some((m) => m.startsWith('DATABASE_URL')));
  assert.ok(report.missing.some((m) => m.startsWith('SEED_OWNER_PASSWORD')));
  assert.equal(report.missing.length, 2, 'both reported together');
});

test('SEED_OWNER_PASSWORD is only required outside development', () => {
  const dev = { DATABASE_URL: base.DATABASE_URL, NODE_ENV: 'development' };
  assert.equal(checkEnv(dev).ok, true, 'development may fall back to the documented default');

  // Unset NODE_ENV counts as not-development: a server is the place least likely to set it.
  const unset = { DATABASE_URL: base.DATABASE_URL };
  assert.equal(checkEnv(unset).ok, false);
});

test('a non-postgres DATABASE_URL is rejected', () => {
  const report = checkEnv({ ...base, DATABASE_URL: 'mysql://nope/x' });
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((p) => p.includes('postgres://')));
});

test('localhost in a production DATABASE_URL is caught, but only for a deployment', () => {
  // Inside a container localhost is the container. This is the classic compose mistake.
  const localhost = { ...base, DATABASE_URL: 'postgres://cafe:cafe@localhost:5432/cafe' };
  // A build on a developer machine legitimately points at localhost, so the check is
  // opt-in and off by default.
  assert.equal(checkEnv(localhost).ok, true, 'not flagged during a build');
  const report = checkEnv(localhost, { deployment: true });
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((p) => p.includes('compose service name')));

  // ...but it is perfectly normal in development.
  const dev = { DATABASE_URL: 'postgres://cafe:cafe@localhost:5432/cafe', NODE_ENV: 'development' };
  assert.equal(checkEnv(dev).ok, true);
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
