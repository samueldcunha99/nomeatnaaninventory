import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRuns, summarizePurchases, formatYieldVariance, type RecordedRun, type RecordedMovement } from './daily-report.ts';

const run = (patch: Partial<RecordedRun> = {}): RecordedRun => ({ id: crypto.randomUUID(), recipeId: 'cake',
  recipeName: 'Cake', producedOn: '2020-02-03', batchesMilli: 1000n, expectedYieldMilliBase: 9000n,
  actualYieldMilliBase: 8000n, yieldUnitType: 'count', batchCostPaise: 500n,
  note: null, userName: 'Owner', createdAt: new Date(), ...patch });

test('daily production sums saved quantities and keeps unknown cost unknown', () => {
  const [group] = summarizeRuns([run(), run({ batchesMilli: 1500n, expectedYieldMilliBase: 13500n,
    actualYieldMilliBase: 13000n, batchCostPaise: null })]);
  assert.equal(group.batchesMilli, 2500n);
  assert.equal(group.expectedMilliBase, 22500n);
  assert.equal(group.actualMilliBase, 21000n);
  assert.equal(group.costPaise, null);
  assert.equal(group.uncostedRuns, 1);
});
test('historic yield types remain separate even when the recipe ID is the same', () => {
  const groups = summarizeRuns([run({ yieldUnitType: 'weight' }), run({ yieldUnitType: 'volume' })]);
  assert.equal(groups.length, 2);
  assert.ok(groups.every(g => g.runs === 1));
});
test('daily sums stay exact beyond the safe JS number range', () => {
  const [group] = summarizeRuns([run({ actualYieldMilliBase: 9007199254740991n }), run({ actualYieldMilliBase: 5n })]);
  assert.equal(group.actualMilliBase, 9007199254740996n);
});
test('receipt summaries use money paid, preserve a real zero and exclude wastage', () => {
  const base: RecordedMovement = { id: 'a', referenceId: 'receipt', ingredientId: 'butter', ingredientName: 'Butter',
    unitType: 'weight', movementType: 'purchase', quantityMilliBase: 1000000n, totalCostPaise: 0n,
    supplierName: null, userName: 'Owner', reason: null, createdAt: new Date() };
  const [row] = summarizePurchases([base, { ...base, id: 'b', quantityMilliBase: 500000n, totalCostPaise: 25000n },
    { ...base, movementType: 'wastage', quantityMilliBase: -5000n, totalCostPaise: null }]);
  assert.equal(row.quantityMilliBase, 1500000n);
  assert.equal(row.paidPaise, 25000n);
  assert.equal(summarizePurchases([base])[0].paidPaise, 0n);
  assert.equal(summarizePurchases([{ ...base, totalCostPaise: null }])[0].paidPaise, null);
});
test('yield variance formats short, excess and zero-output batches without floats', () => {
  assert.equal(formatYieldVariance(8000n, 9000n), '-11.1%');
  assert.equal(formatYieldVariance(11000n, 10000n), '+10%');
  assert.equal(formatYieldVariance(0n, 10000n), '-100%');
  assert.equal(formatYieldVariance(10000n, 10000n), '0%');
});
