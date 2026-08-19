import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pgError, isUniqueViolation, isCheckViolation, translating } from './errors.ts';

/** The shape that actually arrives: Drizzle wrapping the postgres.js error. */
function drizzleWrapped(code: string, constraint_name: string) {
  const pg = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code,
    constraint_name,
  });
  return Object.assign(new Error('Failed query'), { cause: pg });
}

test('the driver error is found through the wrapper, not on the surface', () => {
  const err = drizzleWrapped('23505', 'ingredients_tenant_name_uq');
  // This is the bug that shipped: the code is not on the thrown error itself.
  assert.equal((err as { code?: string }).code, undefined);
  assert.equal(pgError(err)?.code, '23505');
  assert.equal(pgError(err)?.constraint_name, 'ingredients_tenant_name_uq');
});

test('a bare error, or none, resolves to null rather than throwing', () => {
  assert.equal(pgError(new Error('nope')), null);
  assert.equal(pgError(null), null);
  assert.equal(pgError(undefined), null);
  assert.equal(pgError('a string'), null);
});

test('a cause chain cannot loop forever', () => {
  const a: { cause?: unknown } = {};
  a.cause = a;
  assert.equal(pgError(a), null);
});

test('matching requires the constraint name, not just the code', () => {
  const err = drizzleWrapped('23505', 'ingredients_tenant_name_uq');
  assert.ok(isUniqueViolation(err, 'ingredients_tenant_name_uq'));
  // The whole point: a different unique constraint must not be mislabelled.
  assert.ok(!isUniqueViolation(err, 'users_tenant_email_uq'));
  assert.ok(!isCheckViolation(err, 'ingredients_tenant_name_uq'), 'wrong error class');
});

test('check violations are matched separately', () => {
  const err = drizzleWrapped('23514', 'stock_movements_cost_on_purchase_only');
  assert.ok(isCheckViolation(err, 'stock_movements_cost_on_purchase_only'));
  assert.ok(!isUniqueViolation(err, 'stock_movements_cost_on_purchase_only'));
});

test('translating swaps known violations and passes everything else through', async () => {
  class Friendly extends Error {}
  const t = [{ constraint: 'ingredients_tenant_name_uq', toError: () => new Friendly('that name is taken') }];

  await assert.rejects(
    () => translating(() => Promise.reject(drizzleWrapped('23505', 'ingredients_tenant_name_uq')), t),
    Friendly,
  );

  // An unrelated constraint must surface as itself - a surprise stays a surprise.
  await assert.rejects(
    () => translating(() => Promise.reject(drizzleWrapped('23505', 'something_else_uq')), t),
    (e: unknown) => !(e instanceof Friendly) && pgError(e)?.constraint_name === 'something_else_uq',
  );

  await assert.rejects(() => translating(() => Promise.reject(new Error('boom')), t), /boom/);
  assert.equal(await translating(() => Promise.resolve(42), t), 42);
});
