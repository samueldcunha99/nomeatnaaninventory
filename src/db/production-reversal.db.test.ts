import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, asc, eq } from 'drizzle-orm';
import { db } from './client.ts';
import { dbReachable, closeDb } from './test-db.ts';
import { tenants, users, ingredients, recipes, menuItems, stockMovements, ingredientStock, productionRuns, productionReversals } from './schema.ts';
import { createIngredient } from './ingredients.ts';
import { saveRecipe, loadRecipeGraph } from './recipes.ts';
import { recordReceipt, recordCorrection } from './movements.ts';
import { recordMovements, recalculateStock } from './stock.ts';
import { stockRecipe, disableRecipeStockOutput, recordProductionRun, reverseProductionRun } from './production.ts';
import { getDailyReport } from './daily-report.ts';
import { isCheckViolation, pgError } from './errors.ts';
import { AuthzError, type Actor } from '../lib/auth.ts';

let reachable = false;
before(async () => { reachable = await dbReachable('production reversal tests'); });
after(closeDb);

async function fixture(stocked = true, priced = true) {
  const [tenant] = await db.insert(tenants).values({ name: `reversal test ${crypto.randomUUID()}` }).returning();
  const [user] = await db.insert(users).values({ tenantId: tenant.id, name: 'Owner', email: 'owner@example.test', passwordHash: 'x', role: 'owner' }).returning();
  const actor: Actor = { id: user.id, tenantId: tenant.id, role: 'owner' };
  const flour = await createIngredient(actor, { name: 'Flour', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, lowStockThresholdMilliBase: 0 });
  if (priced) await recordReceipt(actor, { lines: [{ ingredientId: flour.id, quantityMilliBase: 1_000_000n, totalCostPaise: 10_000n }] });
  const recipeId = await saveRecipe(actor, { name: 'Dough', yieldUnitType: 'weight', yieldQtyMilliBase: 100_000n,
    lines: [{ ingredientId: flour.id, entryUnitType: 'weight', quantityMilliBase: 100_000n }] });
  const shelf = stocked ? await stockRecipe(actor, recipeId) : null;
  return { actor, flour: flour.id, recipeId, shelf };
}
async function produce(f: Awaited<ReturnType<typeof fixture>>, output = 50_000n) {
  return recordProductionRun(f.actor, { recipeId: f.recipeId, producedOn: '2020-02-03', batchesMilli: 1000n, actualYieldMilliBase: output });
}
async function stock(actor: Actor, ingredientId: string) {
  const [row] = await db.select().from(ingredientStock).where(and(eq(ingredientStock.tenantId, actor.tenantId), eq(ingredientStock.ingredientId, ingredientId)));
  return row;
}
async function originals(actor: Actor, runId: string) {
  return db.select().from(stockMovements).where(and(eq(stockMovements.tenantId, actor.tenantId), eq(stockMovements.referenceType, 'production'), eq(stockMovements.referenceId, runId))).orderBy(asc(stockMovements.seq));
}

test('reversing the latest stocked batch restores its exact pre-batch quantity and weighted average', async t => {
  if (!reachable) return t.skip('no database');
  const f = await fixture();
  await recordReceipt(f.actor, { lines: [{ ingredientId: f.shelf!, quantityMilliBase: 250_000n, totalCostPaise: 2500n }] });
  const beforeFlour = await stock(f.actor, f.flour), beforeShelf = await stock(f.actor, f.shelf!);
  const run = await produce(f);
  assert.equal((await stock(f.actor, f.shelf!)).weightedAvgCostMillipaisePerBase, 11667);
  const rows = await originals(f.actor, run.runId);
  const correction = await reverseProductionRun(f.actor, { requestId: crypto.randomUUID(), productionRunId: run.runId, reason: 'Wrong batch entry' });
  const restoredFlour = await stock(f.actor, f.flour), restoredShelf = await stock(f.actor, f.shelf!);
  assert.equal(restoredFlour.qtyMilliBase, beforeFlour.qtyMilliBase);
  assert.equal(restoredFlour.weightedAvgCostMillipaisePerBase, beforeFlour.weightedAvgCostMillipaisePerBase);
  assert.equal(restoredShelf.qtyMilliBase, beforeShelf.qtyMilliBase);
  assert.equal(restoredShelf.weightedAvgCostMillipaisePerBase, 10000);
  const inverse = await db.select().from(stockMovements).where(and(eq(stockMovements.tenantId, f.actor.tenantId), eq(stockMovements.referenceId, correction.reversalId)));
  assert.equal(inverse.length, rows.length);
  for (const row of rows) {
    const cancelling = inverse.find(m => m.reversesMovementId === row.id)!;
    assert.equal(cancelling.quantityMilliBase, -row.quantityMilliBase);
    assert.equal(cancelling.ingredientId, row.ingredientId);
    assert.equal(cancelling.unitCostMillipaisePerBase, null);
  }
  assert.equal(restoredShelf.snapshotSeq, Math.max(...inverse.filter(m => m.ingredientId === f.shelf).map(m => m.seq)), 'watermark includes excluded inverse rows');
  await recordReceipt(f.actor, { lines: [{ ingredientId: f.shelf!, quantityMilliBase: 100_000n, totalCostPaise: 4000n }] });
  assert.equal((await stock(f.actor, f.shelf!)).weightedAvgCostMillipaisePerBase, 18571, 'next inflow starts from restored valuation');
  const rebuilt = await db.transaction(tx => recalculateStock(tx, f.actor.tenantId, f.shelf!, { rebuild: true }));
  assert.equal(rebuilt.qtyMilliBase, 350_000n);
  assert.equal(rebuilt.weightedAvgCostMillipaisePerBase, 18571n);
  assert.equal((await db.select().from(productionRuns).where(and(eq(productionRuns.tenantId, f.actor.tenantId), eq(productionRuns.id, run.runId)))).length, 1, 'original run remains');
});

test('reversed runs remain in report history but disappear from effective production and material usage', async t => {
  if (!reachable) return t.skip('no database');
  const f = await fixture(false, false);
  const run = await produce(f);
  assert.equal((await stock(f.actor, f.flour)).qtyMilliBase, -100_000);
  await reverseProductionRun(f.actor, { requestId: crypto.randomUUID(), productionRunId: run.runId, reason: 'Entered twice by mistake' });
  assert.equal((await stock(f.actor, f.flour)).qtyMilliBase, 0);
  assert.equal((await stock(f.actor, f.flour)).weightedAvgCostMillipaisePerBase, null);
  const report = await getDailyReport(f.actor, '2020-02-03');
  assert.equal(report.runs.length, 1);
  assert.equal(report.runs[0].reversal?.reason, 'Entered twice by mistake');
  assert.equal(report.runs[0].reversal?.userName, 'Owner');
  assert.deepEqual(report.production, []);
  assert.deepEqual(report.usage, []);
});

test('later activity on any affected ingredient refuses correction without appending an event', async t => {
  if (!reachable) return t.skip('no database');
  for (const shelfActivity of [false, true]) {
    const f = await fixture(); const run = await produce(f);
    await recordReceipt(f.actor, { lines: [{ ingredientId: shelfActivity ? f.shelf! : f.flour, quantityMilliBase: 1000n, totalCostPaise: 100n }] });
    const before = await stock(f.actor, f.flour);
    await assert.rejects(() => reverseProductionRun(f.actor, { requestId: crypto.randomUUID(), productionRunId: run.runId, reason: 'Wrong batch' }), /later stock activity/);
    assert.equal((await stock(f.actor, f.flour)).qtyMilliBase, before.qtyMilliBase);
    assert.deepEqual(await db.select().from(productionReversals).where(eq(productionReversals.tenantId, f.actor.tenantId)), []);
  }
});

test('an unrelated ingredient movement does not block a latest-only reversal', async t => {
  if (!reachable) return t.skip('no database');
  const f = await fixture(); const run = await produce(f);
  const other = await createIngredient(f.actor, { name: 'Unrelated sugar', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, lowStockThresholdMilliBase: 0 });
  await recordReceipt(f.actor, { lines: [{ ingredientId: other.id, quantityMilliBase: 1000n, totalCostPaise: 100n }] });
  await reverseProductionRun(f.actor, { requestId: crypto.randomUUID(), productionRunId: run.runId, reason: 'Wrong batch' });
  assert.equal((await stock(f.actor, f.flour)).qtyMilliBase, 1_000_000);
});

test('concurrent retries reverse a production run exactly once and reject changed request details', async t => {
  if (!reachable) return t.skip('no database');
  const f = await fixture(); const run = await produce(f);
  const input = { requestId: crypto.randomUUID(), productionRunId: run.runId, reason: 'Miscounted batch' };
  const results = await Promise.all([reverseProductionRun(f.actor, input), reverseProductionRun(f.actor, input)]);
  assert.equal(results.filter(r => r.alreadyReversed).length, 1);
  assert.equal((await db.select().from(productionReversals).where(eq(productionReversals.tenantId, f.actor.tenantId))).length, 1);
  assert.equal((await stock(f.actor, f.flour)).qtyMilliBase, 1_000_000);
  await assert.rejects(() => reverseProductionRun(f.actor, { ...input, reason: 'Changed reason' }), /different details/);
  await assert.rejects(() => reverseProductionRun(f.actor, { ...input, requestId: crypto.randomUUID() }), /already been reversed/);
});

test('production reversal checks role, tenant and mandatory reason before any stock changes', async t => {
  if (!reachable) return t.skip('no database');
  const f = await fixture(); const stranger = await fixture(); const run = await produce(f);
  const input = { requestId: crypto.randomUUID(), productionRunId: run.runId, reason: 'Correction' };
  for (const role of ['counter', 'kitchen'] as const) await assert.rejects(() => reverseProductionRun({ ...f.actor, role }, input), AuthzError);
  await assert.rejects(() => reverseProductionRun(stranger.actor, input), /no longer exists/);
  await assert.rejects(() => reverseProductionRun(f.actor, { ...input, reason: ' ' }), /correction reason/);
  await reverseProductionRun({ ...f.actor, role: 'manager' }, input);
});

test('the database refuses incomplete, mismatched and cross-tenant production reversals', async t => {
  if (!reachable) return t.skip('no database');
  const f = await fixture(); const other = await fixture(); const run = await produce(f);
  const [original] = await originals(f.actor, run.runId);
  await assert.rejects(() => db.insert(productionReversals).values({ tenantId: f.actor.tenantId, productionRunId: run.runId, reason: 'Incomplete', createdByUserId: f.actor.id }),
    error => isCheckViolation(error, 'production_reversals_all_movements'));
  for (const patch of [{ ingredientId: f.shelf! }, { quantityMilliBase: 1 }]) {
    await assert.rejects(() => db.transaction(async tx => {
      const id = crypto.randomUUID();
      await tx.insert(productionReversals).values({ id, tenantId: f.actor.tenantId, productionRunId: run.runId, reason: 'Invalid inverse', createdByUserId: f.actor.id });
      await tx.insert(stockMovements).values({ tenantId: f.actor.tenantId, ingredientId: original.ingredientId,
        movementType: 'reversal', quantityMilliBase: -original.quantityMilliBase, reversesMovementId: original.id,
        referenceType: 'production_reversal', referenceId: id, createdByUserId: f.actor.id, ...patch });
    }), error => isCheckViolation(error, 'stock_movements_reversal_matches_original'));
  }
  await assert.rejects(() => db.insert(stockMovements).values({ tenantId: other.actor.tenantId, ingredientId: other.flour,
    movementType: 'reversal', quantityMilliBase: -original.quantityMilliBase, reversesMovementId: original.id, createdByUserId: other.actor.id }),
    error => pgError(error)?.constraint_name === 'stock_movements_tenant_reverses_fk');
  const result = await reverseProductionRun(f.actor, { requestId: crypto.randomUUID(), productionRunId: run.runId, reason: 'Correct entry' });
  for (const operation of [() => db.update(productionReversals).set({ reason: 'Rewrite history' }).where(and(eq(productionReversals.tenantId, f.actor.tenantId), eq(productionReversals.id, result.reversalId))),
    () => db.delete(productionReversals).where(and(eq(productionReversals.tenantId, f.actor.tenantId), eq(productionReversals.id, result.reversalId)))]) {
    await assert.rejects(operation, error => pgError(error)?.code === '23001');
  }
});

test('reversal waits for the ingredient writer before checking later activity', async t => {
  if (!reachable) return t.skip('no database');
  const f = await fixture(); const run = await produce(f);
  let written!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { written = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const receipt = db.transaction(async tx => {
    await recordMovements([{ tenantId: f.actor.tenantId, ingredientId: f.flour, movementType: 'purchase', quantityMilliBase: 1000,
      unitCostMillipaisePerBase: 10000, totalCostPaise: 10, createdByUserId: f.actor.id }], tx);
    written(); await held;
  });
  await ready;
  const reversing = reverseProductionRun(f.actor, { requestId: crypto.randomUUID(), productionRunId: run.runId, reason: 'Racing correction' });
  const rejected = assert.rejects(reversing, /later stock activity/);
  await new Promise(resolve => setTimeout(resolve, 150));
  release();
  await Promise.all([receipt, rejected]);
});

test('disabling shelf output requires zero balance and no parent references, and reuses its shelf on re-enable', async t => {
  if (!reachable) return t.skip('no database');
  const f = await fixture();
  await recordReceipt(f.actor, { lines: [{ ingredientId: f.shelf!, quantityMilliBase: 1000n, totalCostPaise: 10n }] });
  await assert.rejects(() => disableRecipeStockOutput(f.actor, f.recipeId), /still has stock/);
  await recordCorrection(f.actor, 'adjustment', { ingredientId: f.shelf!, quantityMilliBase: -2000n, reason: 'count_correction' });
  await assert.rejects(() => disableRecipeStockOutput(f.actor, f.recipeId), /still has stock/, 'negative shelf is not empty');
  await recordCorrection(f.actor, 'adjustment', { ingredientId: f.shelf!, quantityMilliBase: 1000n, reason: 'count_correction' });
  const parentId = await saveRecipe(f.actor, { name: 'Parent roll', yieldUnitType: 'count', yieldQtyMilliBase: 1000n,
    lines: [{ subRecipeId: f.recipeId, entryUnitType: 'weight', quantityMilliBase: 1000n }] });
  await assert.rejects(() => disableRecipeStockOutput(f.actor, f.recipeId), /still used by/);
  await saveRecipe(f.actor, { id: parentId, name: 'Parent roll', yieldUnitType: 'count', yieldQtyMilliBase: 1000n,
    lines: [{ ingredientId: f.flour, entryUnitType: 'weight', quantityMilliBase: 1000n }] });
  await disableRecipeStockOutput(f.actor, f.recipeId);
  const [disabled] = await db.select().from(recipes).where(and(eq(recipes.tenantId, f.actor.tenantId), eq(recipes.id, f.recipeId)));
  assert.equal(disabled.stockOutputEnabled, false);
  assert.equal(disabled.stockIngredientId, f.shelf, 'historical shelf link stays');
  assert.equal((await loadRecipeGraph(f.actor)).get(f.recipeId)?.stockIngredientId, null, 'planner sees effective mode');
  await assert.rejects(() => saveRecipe(f.actor, { id: f.recipeId, name: 'Dough', yieldUnitType: 'count', yieldQtyMilliBase: 1000n,
    lines: [{ ingredientId: f.flour, entryUnitType: 'weight', quantityMilliBase: 1000n }] }), /held in stock|historical shelf/);
  assert.equal(await stockRecipe(f.actor, f.recipeId), f.shelf);
  assert.equal((await loadRecipeGraph(f.actor)).get(f.recipeId)?.stockIngredientId, f.shelf);
  assert.equal((await db.select().from(ingredients).where(and(eq(ingredients.tenantId, f.actor.tenantId), eq(ingredients.name, 'Dough')))).length, 1);
});

test('active made-to-order sales configuration refuses manual production before a second material deduction', async t => {
  if (!reachable) return t.skip('no database');
  const f = await fixture(false);
  await db.insert(menuItems).values({ tenantId: f.actor.tenantId, recipeId: f.recipeId, name: 'Dough serving',
    portionQtyMilliBase: 100_000, sellingPricePaise: 1000, fulfillmentMode: 'made_to_order', isActive: true });
  await assert.rejects(() => produce(f), /Record it through Orders/);
  assert.equal((await stock(f.actor, f.flour)).qtyMilliBase, 1_000_000);
  assert.deepEqual(await db.select().from(productionRuns).where(eq(productionRuns.tenantId, f.actor.tenantId)), []);
});

test('direct prepared-ingredient references and active stocked menu items also prevent disabling their shelf', async t => {
  if (!reachable) return t.skip('no database');
  const f = await fixture();
  const parent = await saveRecipe(f.actor, { name: 'Ingredient reference', yieldUnitType: 'count', yieldQtyMilliBase: 1000n,
    lines: [{ ingredientId: f.shelf!, entryUnitType: 'weight', quantityMilliBase: 1000n }] });
  await assert.rejects(() => disableRecipeStockOutput(f.actor, f.recipeId), /still used by/);
  await saveRecipe(f.actor, { id: parent, name: 'Ingredient reference', yieldUnitType: 'count', yieldQtyMilliBase: 1000n,
    lines: [{ ingredientId: f.flour, entryUnitType: 'weight', quantityMilliBase: 1000n }] });
  await db.insert(menuItems).values({ tenantId: f.actor.tenantId, recipeId: f.recipeId, name: 'Stocked serving',
    portionQtyMilliBase: 1000, sellingPricePaise: 1000, fulfillmentMode: 'stocked', isActive: true });
  await assert.rejects(() => disableRecipeStockOutput(f.actor, f.recipeId), /sold from stock/);
});
