import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPostgresTools } from '../../deploy/postgres-tools.ts';

test('native DigitalOcean backup/restore refuses missing CA or pooled aliases before starting a tool', async () => {
  const direct = 'postgres://doadmin:private-test-password@cafe-do-user-123-0.g.db.ondigitalocean.com:25060/nomeatnaan';
  let ran = false;
  const work = async () => { ran = true; };
  await assert.rejects(() => withPostgresTools(direct, '', work), /DATABASE_SSL_CA/);
  await assert.rejects(() => withPostgresTools(direct.replace(':25060/', ':25061/'), 'test-ca', work), /direct database connection/);
  await assert.rejects(() => withPostgresTools(direct + '?sslmode=disable', 'test-ca', work), /verified TLS/);
  assert.equal(ran, false);
});
