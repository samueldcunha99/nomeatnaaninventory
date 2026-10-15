import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProductionForm } from './production-form.ts';

function input(patch: Record<string, string> = {}) {
  const fields = { requestId: crypto.randomUUID(), recipeId: crypto.randomUUID(), recipeUpdatedAt: '2020-01-01T00:00:00.000Z',
    producedOn: '2020-02-03', batches: '1.5', actualYield: '2.933', actualUnit: 'kg', yieldUnitType: 'weight', note: '', ...patch };
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
const now = new Date('2020-02-04T12:00:00Z');

test('production entry converts fractional batches and metric output exactly', () => {
  const result = parseProductionForm(input(), now);
  assert.equal(result.batchesMilli, 1500n);
  assert.equal(result.actualYieldMilliBase, 2933000n);
  assert.equal(parseProductionForm(input({ actualYield: '0' }), now).actualYieldMilliBase, 0n);
});
test('production form rejects future/invalid days, unit mismatches and overprecision', () => {
  assert.throws(() => parseProductionForm(input({ producedOn: '2020-02-30' }), now), /valid production date/);
  assert.throws(() => parseProductionForm(input({ producedOn: '2020-02-05' }), now), /future/);
  assert.throws(() => parseProductionForm(input({ batches: '0' }), now), /positive batch/);
  assert.throws(() => parseProductionForm(input({ batches: '0.0001' }), now), /more precise/);
  assert.throws(() => parseProductionForm(input({ actualUnit: 'ml' }), now), /weight unit/);
  assert.throws(() => parseProductionForm(input({ actualYield: '-1' }), now), /negative/);
  assert.throws(() => parseProductionForm(input({ requestId: '' }), now));
});
