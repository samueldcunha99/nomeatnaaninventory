import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOrderTotals, allowedOrderStatuses, assertOrderTransition, planOrderLine, summarizePayments,
  MAX_ORDER_PAISE, type OrderMenuSnapshot } from './orders.ts';
import { MissingCostError, type Recipe } from './costing.ts';
import { valueDraws } from './production.ts';

const recipe: Recipe = { id: 'recipe', name: 'Three brownies', yieldUnitType: 'count', yieldQtyMilliBase: 3000n,
  stockIngredientId: null, lines: [{ ingredientId: 'flour', subRecipeId: null, quantityMilliBase: 1000000n, wastageMillipercent: 3000n }] };
const item: OrderMenuSnapshot = { id: 'menu', name: 'Brownie', recipeId: 'recipe', portionQtyMilliBase: 1000n,
  sellingPricePaise: 5000n, fulfillmentMode: 'made_to_order' };
const graph = new Map([[recipe.id, recipe]]);

test('order taxes use exact paise, inclusive prices decompose correctly, and ties round half-up once', () => {
  assert.deepEqual(calculateOrderTotals(10000n, 'exclusive', 5000n), { subtotalPaise: 10000n, taxPaise: 500n, totalPaise: 10500n });
  assert.deepEqual(calculateOrderTotals(10500n, 'inclusive', 5000n), { subtotalPaise: 10000n, taxPaise: 500n, totalPaise: 10500n });
  assert.deepEqual(calculateOrderTotals(10n, 'exclusive', 5000n), { subtotalPaise: 10n, taxPaise: 1n, totalPaise: 11n });
  assert.deepEqual(calculateOrderTotals(1n, 'inclusive', 100000n), { subtotalPaise: 0n, taxPaise: 1n, totalPaise: 1n });
  assert.deepEqual(calculateOrderTotals(0n, 'none', 0n), { subtotalPaise: 0n, taxPaise: 0n, totalPaise: 0n });
  assert.throws(() => calculateOrderTotals(100n, null, null), /Configure sales tax/);
  assert.throws(() => calculateOrderTotals(100n, 'none', 1n), /valid sales tax/);
  assert.throws(() => calculateOrderTotals(MAX_ORDER_PAISE, 'exclusive', 1n), /too large/);
});

test('made-to-order portions keep the exact recipe fraction instead of rounding an intermediate batch count', () => {
  const plan = planOrderLine(item, 1, graph);
  assert.equal(plan.draws[0].issuedMilliBase, 343333n, 'one third of 1000 g with 3% wastage, rounded once');
  assert.equal(plan.lineTotalPaise, 5000n);
  assert.equal(planOrderLine(item, 3, graph).draws[0].issuedMilliBase, 1030000n);
  const shelfGraph = new Map([[recipe.id, { ...recipe, stockIngredientId: 'brownie-shelf' }]]);
  assert.equal(planOrderLine({ ...item, fulfillmentMode: 'stocked' }, 2, shelfGraph).draws[0].ingredientId, 'brownie-shelf');
  assert.equal(planOrderLine({ ...item, fulfillmentMode: 'stocked' }, 2, shelfGraph).draws[0].issuedMilliBase, 2000n,
    'selling prepared stock never consumes flour a second time');
  assert.throws(() => planOrderLine(item, 1, shelfGraph), /held in prepared stock/);
});

test('orders consume prepared sub-recipes once and refuse unset stock modes or sub-resolution portions', () => {
  const child: Recipe = { id: 'child', name: 'Prepared filling', stockIngredientId: 'filling-shelf', yieldQtyMilliBase: 100000n,
    yieldUnitType: 'weight', lines: [{ ingredientId: 'butter', subRecipeId: null, quantityMilliBase: 100000n, wastageMillipercent: 0n }] };
  const parent: Recipe = { ...recipe, lines: [{ ingredientId: null, subRecipeId: child.id, quantityMilliBase: 60000n, wastageMillipercent: 0n }] };
  const recipes = new Map([[parent.id, parent], [child.id, child]]);
  assert.equal(planOrderLine(item, 1, recipes).draws[0].ingredientId, 'filling-shelf');
  assert.equal(planOrderLine(item, 1, recipes).draws[0].issuedMilliBase, 20000n);
  assert.throws(() => planOrderLine({ ...item, fulfillmentMode: null }, 1, recipes), /Choose whether/);
  assert.throws(() => planOrderLine(item, 0.5, recipes), /whole item quantity/);
  const tiny = new Map([[recipe.id, { ...recipe, lines: [{ ...recipe.lines[0], quantityMilliBase: 1n }] }]]);
  assert.throws(() => planOrderLine({ ...item, portionQtyMilliBase: 1n }, 1, tiny), /too small/i);
  recipes.set(child.id, { ...child, stockIngredientId: null });
  assert.throws(() => planOrderLine(item, 1, recipes), /Prepared filling/);
});

test('production and order materials share one final valuation and allocated rows add to the snapshot', () => {
  const draws = ['one', 'two'].map(ingredientId => ({ ingredientId, issuedMilliBase: 500n, source: { kind: 'ingredient' as const } }));
  const known = valueDraws(draws, () => 1000n);
  assert.equal(known.costPaise, 1n, 'two half-paise contributions become one paise, never two');
  assert.deepEqual(known.valuedDraws.map(draw => draw.costPaise), [1n, 0n]);
  assert.equal(known.valuedDraws.reduce((sum, draw) => sum + draw.costPaise!, 0n), known.costPaise);
  const unknown = valueDraws(draws, id => { throw new MissingCostError([{ ingredientId: id, name: id }]); });
  assert.equal(unknown.costPaise, null); assert.equal(unknown.missing.length, 2);
  assert.equal(valueDraws(draws, () => 0n).costPaise, 0n, 'a recorded free ingredient has a genuine zero cost');
});

test('order transitions enforce the pipeline, delivery-only states and reasons for backwards/cancel actions', () => {
  assert.ok(allowedOrderStatuses('ready', 'delivery').includes('out_for_delivery'));
  assert.ok(!allowedOrderStatuses('ready', 'takeaway').includes('out_for_delivery'));
  assert.throws(() => assertOrderTransition('ordered', 'baking', 'dine_in'), /not allowed/);
  assert.throws(() => assertOrderTransition('ordered', 'cancelled', 'dine_in'), /reason/);
  assert.throws(() => assertOrderTransition('baking', 'in_kitchen', 'dine_in'), /reason/);
  assert.equal(assertOrderTransition('baking', 'in_kitchen', 'dine_in', 'Sent to the oven too early').backward, true);
  assert.deepEqual(allowedOrderStatuses('completed', 'delivery'), []);
  assert.deepEqual(allowedOrderStatuses('cancelled', 'delivery'), []);
});

test('payment summaries distinguish partial settlement/refund, preserve free orders, and refuse impossible balances', () => {
  assert.equal(summarizePayments(10000n, []).paymentStatus, 'unpaid');
  const partial = summarizePayments(10000n, [{ eventType: 'payment', amountPaise: 4000n }]);
  assert.equal(partial.paymentStatus, 'part_paid'); assert.equal(partial.balancePaise, 6000n);
  const refund = summarizePayments(10000n, [{ eventType: 'payment', amountPaise: 10000n }, { eventType: 'refund', amountPaise: 2000n }]);
  assert.equal(refund.paymentStatus, 'part_refunded'); assert.equal(refund.paidPaise, 8000n);
  assert.equal(summarizePayments(10000n, [{ eventType: 'payment', amountPaise: 10000n }, { eventType: 'refund', amountPaise: 10000n }]).paymentStatus, 'refunded');
  assert.equal(summarizePayments(0n, []).paymentStatus, 'paid');
  assert.throws(() => summarizePayments(100n, [{ eventType: 'payment', amountPaise: 101n }]), /balance/);
  assert.throws(() => summarizePayments(100n, [{ eventType: 'refund', amountPaise: 1n }]), /balance/);
  assert.throws(() => summarizePayments(100n, [{ eventType: 'payment', amountPaise: -1n }]), /positive/);
});
