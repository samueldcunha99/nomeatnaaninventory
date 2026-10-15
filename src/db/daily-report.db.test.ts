import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { db } from './client.ts';
import { dbReachable, closeDb } from './test-db.ts';
import { tenants, users, ingredients, recipes, stockMovements, productionRuns } from './schema.ts';
import { saveRecipe } from './recipes.ts';
import { recordReceipt, recordCorrection } from './movements.ts';
import { recordProductionRun, stockRecipe, ProductionAlreadyRecordedError } from './production.ts';
import { getDailyReport } from './daily-report.ts';
import { istToday } from '../lib/time.ts';
import { AuthzError, type Actor, type Role } from '../lib/auth.ts';
import { UnitMismatchError } from '../lib/costing.ts';

let reachable = false;
before(async () => { reachable = await dbReachable('daily report tests'); });
after(closeDb);

async function fixture() {
  const [tenant] = await db.insert(tenants).values({ name: `daily test ${crypto.randomUUID()}` }).returning();
  const [user] = await db.insert(users).values({ tenantId: tenant.id, name: 'Owner', email: 'owner@example.test', passwordHash: 'x', role: 'owner' }).returning();
  const actor: Actor = { id: user.id, tenantId: tenant.id, role: 'owner' };
  const [ingredient] = await db.insert(ingredients).values({ tenantId: tenant.id, name: 'Flour', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000 }).returning();
  const recipeId = await saveRecipe(actor, { name: 'Bread', yieldUnitType: 'count', yieldQtyMilliBase: 10000n,
    lines: [{ ingredientId: ingredient.id, entryUnitType: 'weight', quantityMilliBase: 100000n }] });
  return { actor, ingredient, recipeId };
}

test('a backdated production day includes recorded draws and saved output, even after recipe edits', async t => {
  if (!reachable) return t.skip('no database');
  const { actor, ingredient, recipeId } = await fixture();
  await recordReceipt(actor, { lines: [{ ingredientId: ingredient.id, quantityMilliBase: 1000000n, totalCostPaise: 10000n }] });
  await recordProductionRun(actor, { recipeId, producedOn: '2020-02-03', batchesMilli: 1500n, actualYieldMilliBase: 14000n });
  await saveRecipe(actor, { id: recipeId, name: 'Bread', yieldUnitType: 'count', yieldQtyMilliBase: 90000n,
    lines: [{ ingredientId: ingredient.id, entryUnitType: 'weight', quantityMilliBase: 900000n }] });
  const report = await getDailyReport(actor, '2020-02-03');
  assert.equal(report.runs.length, 1);
  assert.equal(report.production[0].batchesMilli, 1500n);
  assert.equal(report.production[0].expectedMilliBase, 15000n);
  assert.equal(report.production[0].actualMilliBase, 14000n);
  assert.equal(report.production[0].costPaise, 1500n);
  assert.equal(report.usage[0].quantityMilliBase, 150000n);
  assert.equal(typeof report.usage[0].quantityMilliBase, 'bigint');
  assert.equal(report.runs[0].userName, 'Owner');
  assert.equal(report.purchases.length, 0, 'the receipt was entered today, not on the production day');
  const current = await getDailyReport(actor, istToday());
  assert.equal(current.usage.length, 0, 'the late entry must not put consumption on the entry day');
  assert.equal(current.purchases[0].quantityMilliBase, 1000000n);
  assert.equal(current.totalPaidPaise, 10000n);
});

test('recipe filtering uses ledger draws, preserves unknown costs, and never includes another tenant', async t => {
  if (!reachable) return t.skip('no database');
  const { actor, ingredient, recipeId } = await fixture();
  const other = await fixture();
  const second = await saveRecipe(actor, { name: 'Rolls', yieldUnitType: 'count', yieldQtyMilliBase: 5000n,
    lines: [{ ingredientId: ingredient.id, entryUnitType: 'weight', quantityMilliBase: 50000n }] });
  for (const [who, id, batches] of [[actor, recipeId, 1000n], [actor, second, 2000n], [other.actor, other.recipeId, 9000n]] as const) {
    await recordProductionRun(who, { recipeId: id, producedOn: '2020-02-03', batchesMilli: batches, actualYieldMilliBase: 8000n });
  }
  const all = await getDailyReport(actor, '2020-02-03');
  assert.equal(all.runs.length, 2);
  assert.equal(all.usage[0].quantityMilliBase, 200000n);
  assert.ok(all.production.every(r => r.costPaise === null));
  const filtered = await getDailyReport(actor, '2020-02-03', recipeId);
  assert.equal(filtered.runs.length, 1);
  assert.equal(filtered.usage[0].quantityMilliBase, 100000n);
  const hidden = await getDailyReport(other.actor, '2020-02-03', recipeId);
  assert.equal(hidden.runs.length, 0);
  assert.equal(hidden.usage.length, 0);
});

test('purchases use exact Kolkata day boundaries and extra waste stays separate', async t => {
  if (!reachable) return t.skip('no database');
  const { actor, ingredient } = await fixture();
  const common = { tenantId: actor.tenantId, ingredientId: ingredient.id, createdByUserId: actor.id,
    movementType: 'purchase' as const, quantityMilliBase: 1000, totalCostPaise: 1, unitCostMillipaisePerBase: 1000 };
  await db.insert(stockMovements).values([
    { ...common, createdAt: new Date('2020-02-02T18:29:59.999Z') },
    { ...common, createdAt: new Date('2020-02-02T18:30:00.000Z') },
    { ...common, createdAt: new Date('2020-02-03T18:29:59.999Z') },
    { ...common, createdAt: new Date('2020-02-03T18:30:00.000Z') },
  ]);
  await recordCorrection(actor, 'wastage', { ingredientId: ingredient.id, quantityMilliBase: -1000n, reason: 'burnt' });
  const report = await getDailyReport(actor, '2020-02-03');
  assert.equal(report.purchaseDetails.length, 2);
  assert.equal(report.purchases[0].quantityMilliBase, 2000n);
  assert.equal(report.totalPaidPaise, 2n);
  assert.equal(report.usage.length, 0);
  const current = await getDailyReport(actor, istToday());
  assert.equal(current.wastage.length, 1);
  assert.equal(current.wastage[0].quantityMilliBase, -1000n);
  assert.equal(current.usage.length, 0);
});

test('stocked preparations are consumed from their shelf without a second raw ingredient draw', async t => {
  if (!reachable) return t.skip('no database');
  const { actor, ingredient } = await fixture();
  await recordReceipt(actor, { lines: [{ ingredientId: ingredient.id, quantityMilliBase: 1000000n, totalCostPaise: 10000n }] });
  const dough = await saveRecipe(actor, { name: 'Dough', yieldUnitType: 'weight', yieldQtyMilliBase: 500000n,
    lines: [{ ingredientId: ingredient.id, entryUnitType: 'weight', quantityMilliBase: 500000n }] });
  const shelf = await stockRecipe(actor, dough);
  const rolls = await saveRecipe(actor, { name: 'Dough rolls', yieldUnitType: 'count', yieldQtyMilliBase: 5000n,
    lines: [{ subRecipeId: dough, entryUnitType: 'weight', quantityMilliBase: 200000n }] });
  await recordProductionRun(actor, { recipeId: dough, producedOn: '2020-02-03', batchesMilli: 1000n, actualYieldMilliBase: 500000n });
  await recordProductionRun(actor, { recipeId: rolls, producedOn: '2020-02-03', batchesMilli: 1000n, actualYieldMilliBase: 5000n });
  const all = await getDailyReport(actor, '2020-02-03');
  assert.equal(all.usage.find(r => r.ingredientId === ingredient.id)!.quantityMilliBase, 500000n);
  assert.equal(all.usage.find(r => r.ingredientId === shelf)!.quantityMilliBase, 200000n);
  assert.equal(all.usage.find(r => r.ingredientId === shelf)!.prepared, true);
  const onlyRolls = await getDailyReport(actor, '2020-02-03', rolls);
  assert.equal(onlyRolls.usage.length, 1);
  assert.equal(onlyRolls.usage[0].ingredientId, shelf);
  assert.equal(all.purchases.length, 0, 'production inflows are not purchases');
});

test('owner and manager can report, while counter and kitchen cannot', async t => {
  if (!reachable) return t.skip('no database');
  const { actor } = await fixture();
  for (const role of ['owner', 'manager'] as Role[]) await getDailyReport({ ...actor, role }, '2020-02-03');
  for (const role of ['counter', 'kitchen'] as Role[]) {
    await assert.rejects(() => getDailyReport({ ...actor, role }, '2020-02-03'), AuthzError);
  }
  await assert.rejects(() => getDailyReport(actor, '2020-02-30'), /valid calendar date/);
});

test('a retried production form consumes stock once, including concurrent submissions', async t => {
  if (!reachable) return t.skip('no database');
  const { actor, recipeId } = await fixture();
  const input = { requestId: crypto.randomUUID(), recipeId, producedOn: '2020-02-03', batchesMilli: 1000n, actualYieldMilliBase: 9000n };
  const results = await Promise.allSettled([recordProductionRun(actor, input), recordProductionRun(actor, input)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.some(r => r.status === 'rejected' && r.reason instanceof ProductionAlreadyRecordedError));
  const rows = await db.select().from(productionRuns).where(and(eq(productionRuns.tenantId, actor.tenantId), eq(productionRuns.id, input.requestId)));
  assert.equal(rows.length, 1);
  const report = await getDailyReport(actor, '2020-02-03');
  assert.equal(report.usage[0].quantityMilliBase, 100000n);
});

test('a stale production form is refused before writing any run or usage', async t => {
  if (!reachable) return t.skip('no database');
  const { actor, recipeId } = await fixture();
  await assert.rejects(() => recordProductionRun(actor, { recipeId, producedOn: '2020-02-03',
    batchesMilli: 1000n, actualYieldMilliBase: 9000n, recipeUpdatedAt: '1999-01-01T00:00:00.000Z' }), /recipe changed/);
  const report = await getDailyReport(actor, '2020-02-03');
  assert.equal(report.runs.length, 0);
  assert.equal(report.usage.length, 0);
});

test('a changed yield unit is refused without reinterpreting the measured output', async t => {
  if (!reachable) return t.skip('no database');
  const { actor, recipeId } = await fixture();
  await assert.rejects(() => recordProductionRun(actor, { recipeId, producedOn: '2020-02-03',
    batchesMilli: 1000n, actualYieldMilliBase: 9000n, yieldUnitType: 'weight' }), UnitMismatchError);
  assert.equal((await getDailyReport(actor, '2020-02-03')).runs.length, 0);
});

test('a production quantity outside exact number storage rolls back all writes', async t => {
  if (!reachable) return t.skip('no database');
  const { actor, recipeId } = await fixture();
  await assert.rejects(() => recordProductionRun(actor, { recipeId, producedOn: '2020-02-03',
    batchesMilli: 1000n, actualYieldMilliBase: 9007199254740992n }), /too large to record exactly/);
  const report = await getDailyReport(actor, '2020-02-03');
  assert.equal(report.runs.length, 0);
  assert.equal(report.usage.length, 0);
});
