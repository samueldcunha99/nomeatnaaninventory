import assert from 'node:assert/strict';
import { milliBaseToPurchaseUnits, purchaseUnitsToMilliBase } from '../../src/lib/units.ts';
import { explainRecipe, assertAcyclicWithinDepth } from '../../src/lib/costing.ts';

// Read-only reproductions of current behaviour; these do not connect to PostgreSQL.
const formatted = milliBaseToPurchaseUnits(1000n, 30);
assert.equal(formatted, '0.033333333');
assert.throws(() => purchaseUnitsToMilliBase(formatted, 30), /more precise/);
console.log('CONFIRMED: 1 unit displayed as a fraction of a 30-unit tray cannot round-trip.');

const ingredient = { ingredientId: 'flour', subRecipeId: null, quantityMilliBase: 1000n, wastageMillipercent: 0n };
const subLine = (id) => ({ ingredientId: null, subRecipeId: id, quantityMilliBase: 1000n, wastageMillipercent: 0n });
const recipe = (id, batchMinutes, lines) => ({ id, name: id, yieldUnitType: 'count', yieldQtyMilliBase: 1000n, batchMinutes, lines });
const rates = { labourPaisePerHour: 8000n, kitchenPaisePerHour: 3000n };
const graph = new Map([
  ['child', recipe('child', 60, [ingredient])],
  ['parent', recipe('parent', null, [subLine('child')])],
]);
const explanation = explainRecipe('parent', graph, () => 1000000n, rates);
assert.equal(explanation.overhead.applied, false);
assert.equal(explanation.totalBatchPaise, 12000n);
assert.equal(explanation.lines[0].children.overhead.applied, true);
console.log('CONFIRMED: untimed parent has overhead.applied=false but contains Rs 110 inherited overhead in its Rs 120 total.');

graph.set('child', recipe('child', null, [ingredient]));
graph.set('parent', recipe('parent', 60, [subLine('child')]));
const incomplete = explainRecipe('parent', graph, () => 1000000n, rates);
assert.equal(incomplete.overhead.applied, true);
assert.equal(incomplete.lines[0].children.overhead.applied, false);
console.log('CONFIRMED: timed parent has overhead.applied=true even when its child is untimed.');

const initial = new Map([['A', recipe('A', null, [ingredient])], ['B', recipe('B', null, [ingredient])]]);
const firstEdit = new Map(initial);
firstEdit.set('A', recipe('A', null, [subLine('B')]));
const secondEdit = new Map(initial);
secondEdit.set('B', recipe('B', null, [subLine('A')]));
for (const id of initial.keys()) {
  assertAcyclicWithinDepth(id, firstEdit);
  assertAcyclicWithinDepth(id, secondEdit);
}
const merged = new Map([['A', firstEdit.get('A')], ['B', secondEdit.get('B')]]);
assert.throws(() => assertAcyclicWithinDepth('A', merged), /contain itself/);
console.log('CONFIRMED: two individually valid graph edits combine into a cycle. Database interleaving still needs a live test.');

const stored = 9007199254740993n;
assert.notEqual(BigInt(Number(stored)), stored);
console.log('CONFIRMED: unbounded bigint-to-number persistence changes 9007199254740993 to 9007199254740992.');
