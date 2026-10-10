import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSeparateRestore } from './restore-safety.ts';

test('restore refuses the live database even through a different role or port', () => {
  assert.throws(() => assertSeparateRestore('postgres://owner:pw@localhost:5432/cafe', 'postgres://other:pw@localhost:6543/cafe'), /same database/);
  assert.doesNotThrow(() => assertSeparateRestore('postgres://owner:pw@localhost/cafe', 'postgres://owner:pw@localhost/restore_check'));
});

test('Supabase direct and pooler aliases cannot bypass the restore guard', () => {
  const direct = 'postgres://postgres:pw@db.liveproject.supabase.co:5432/postgres';
  const pooled = 'postgres://cafe_app.liveproject:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
  assert.throws(() => assertSeparateRestore(direct, pooled), /same database/);
  assert.throws(() => assertSeparateRestore(pooled, direct), /same database/);
  assert.throws(() => assertSeparateRestore(direct, 'postgres://postgres:pw@aws-0-ap-south-1.pooler.supabase.com/postgres'), /cannot identify/);
  // Different projects can legitimately share the same pooler host.
  assert.doesNotThrow(() => assertSeparateRestore(direct, pooled.replace('liveproject', 'testproject')));
  assert.doesNotThrow(() => assertSeparateRestore(pooled, pooled.replace('liveproject', 'testproject')));
});
