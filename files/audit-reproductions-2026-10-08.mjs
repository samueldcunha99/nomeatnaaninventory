// Audit evidence only. These assertions pin the OBSERVED defects, not desired behaviour.
// Run from the repository root: node files/audit-reproductions-2026-10-08.mjs
// No database access, writes, or environment variables required.
import assert from 'node:assert/strict';
import { replayLedger } from '../src/lib/stock.ts';
import { explainRecipe, portionCostPaise } from '../src/lib/costing.ts';
import { planProductionRun } from '../src/lib/production.ts';
import { costPerPurchaseUnitPaise, formatINR } from '../src/lib/units.ts';

const stock = replayLedger([
  { movementType: 'adjustment', quantityMilliBase: 1_000_000n },
  { movementType: 'purchase', quantityMilliBase: 1_000_000n, unitCostMillipaisePerBase: 50_000n },
]);
assert.equal(stock.weightedAvgCostMillipaisePerBase, 25_000n);
console.log('Opening stock: 1 kg unpriced + 1 kg at Rs 500 produces',
  formatINR(costPerPurchaseUnitPaise(stock.weightedAvgCostMillipaisePerBase, 1000)), 'per kg.');

const line = (ingredientId, quantityMilliBase) => ({
  ingredientId, subRecipeId: null, quantityMilliBase, wastageMillipercent: 0n,
});
const graph = new Map([
  ['child', {
    id: 'child', name: 'Untimed dough', yieldUnitType: 'count', yieldQtyMilliBase: 1000n,
    batchMinutes: null, lines: [line('flour', 1000n)],
  }],
  ['parent', {
    id: 'parent', name: 'Timed roll', yieldUnitType: 'count', yieldQtyMilliBase: 1000n,
    batchMinutes: 60,
    lines: [{ ingredientId: null, subRecipeId: 'child', quantityMilliBase: 1000n, wastageMillipercent: 0n }],
  }],
]);
const explained = explainRecipe('parent', graph, () => 100_000n, {
  labourPaisePerHour: 6000n, kitchenPaisePerHour: 3000n,
});
assert.equal(explained.overhead.applied, true);
assert.equal(explained.lines[0].children.overhead.applied, false);
assert.equal(explained.totalBatchPaise, 9100n);
console.log('Incomplete overhead: parent says applied, child is untimed; total is', formatINR(explained.totalBatchPaise));

// Consequence of retaining a 100 g portion when a Rs 100 recipe switches
// from a 1000 g yield to a 10-unit yield. Save-time acceptance is source-reviewed.
assert.equal(portionCostPaise(10_000n, 100_000n), 1000n);
assert.equal(portionCostPaise(1_000_000n, 100_000n), 100_000n);
console.log('Retained menu portion: Rs 10 for 100 g becomes Rs 1000 for 100 units.');

const tiny = new Map([['spiced', {
  id: 'spiced', name: 'Spiced portion', yieldUnitType: 'count', yieldQtyMilliBase: 1000n,
  lines: [line('spice', 1n)],
}]]);
const plan = planProductionRun('spiced', tiny, () => 1000n, 250n, 250n);
assert.equal(plan.expectedYieldMilliBase, 250n);
assert.equal(plan.draws[0].issuedMilliBase, 0n);
console.log('Small batch: valid quarter-unit yield has a zero spice draw; DB writer would insert zero.');
