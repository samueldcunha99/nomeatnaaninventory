import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { db } from './client.ts';
import { dbReachable, closeDb } from './test-db.ts';
import { tenants, users, ingredientStock, stockMovements } from './schema.ts';
import { createIngredient } from './ingredients.ts';
import { recordOpeningStock, recordReceipt, recordCorrection } from './movements.ts';
import { loadCostLookup } from './recipes.ts';
import { countDeliveriesSince, listMovements } from './history.ts';
import { getDailyReport } from './daily-report.ts';
import { istToday } from '../lib/time.ts';
import { AuthzError, type Actor } from '../lib/auth.ts';

let reachable = false;
before(async () => { reachable = await dbReachable('opening stock tests'); });
after(closeDb);
async function fixture() {
  const [tenant] = await db.insert(tenants).values({ name: `opening test ${crypto.randomUUID()}` }).returning();
  const [user] = await db.insert(users).values({ tenantId: tenant.id, name: 'Owner', email: 'owner@example.test', passwordHash: 'fixture', role: 'owner' }).returning();
  const owner: Actor = { id: user.id, tenantId: tenant.id, role: 'owner' };
  const ingredient = await createIngredient(owner, { name: 'Butter', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, lowStockThresholdMilliBase: 0 });
  return { owner, ingredientId: ingredient.id };
}
const stock = async (actor: Actor, id: string) => (await db.select().from(ingredientStock).where(and(eq(ingredientStock.tenantId, actor.tenantId), eq(ingredientStock.ingredientId, id))))[0];

test('opening stock establishes a real value once and is excluded from new purchases and deliveries', async t => {
  if (!reachable) return t.skip('no database');
  const f = await fixture(); const data = { requestId: crypto.randomUUID(), note: 'Verified opening count and value',
    lines: [{ ingredientId: f.ingredientId, quantityMilliBase: 2000000n, totalCostPaise: 100000n }] };
  const results = await Promise.all([recordOpeningStock(f.owner, data), recordOpeningStock(f.owner, data)]);
  assert.equal(results.filter(r => !r.replayed).length, 1);
  assert.equal((await stock(f.owner, f.ingredientId)).qtyMilliBase, 2000000);
  assert.equal((await loadCostLookup(f.owner))(f.ingredientId), 50000n);
  assert.equal(await countDeliveriesSince(f.owner, new Date(0)), 0);
  const report = await getDailyReport(f.owner, istToday());
  assert.equal(report.purchases.length, 0); assert.equal(report.totalPaidPaise, 0n);
  const history = await listMovements(f.owner, { ingredientId: f.ingredientId });
  assert.equal(history.rows[0].referenceType, 'opening_stock');
});

test('valuing a positive unknown balance is quantity neutral and never rewrites earlier purchase or consumption history', async t => {
  if (!reachable) return t.skip('no database');
  const f = await fixture();
  await recordCorrection(f.owner, 'adjustment', { ingredientId: f.ingredientId, quantityMilliBase: 1000000n, reason: 'count_correction' });
  await recordReceipt(f.owner, { lines: [{ ingredientId: f.ingredientId, quantityMilliBase: 1000000n, totalCostPaise: 50000n }] });
  assert.equal((await stock(f.owner, f.ingredientId)).weightedAvgCostMillipaisePerBase, null);
  const data = { requestId: crypto.randomUUID(), lines: [{ ingredientId: f.ingredientId, quantityMilliBase: 2000000n, totalCostPaise: 120000n }] };
  await recordOpeningStock(f.owner, data); await recordOpeningStock(f.owner, data);
  const current = await stock(f.owner, f.ingredientId);
  assert.equal(current.qtyMilliBase, 2000000); assert.equal(current.weightedAvgCostMillipaisePerBase, 60000);
  const rows = await db.select().from(stockMovements).where(and(eq(stockMovements.tenantId, f.owner.tenantId), eq(stockMovements.ingredientId, f.ingredientId)));
  assert.equal(rows.length, 4); assert.equal(rows.reduce((sum, row) => sum + row.quantityMilliBase, 0), 2000000);
  const report = await getDailyReport(f.owner, istToday()); assert.equal(report.totalPaidPaise, 50000n);
});

test('opening valuation refuses duplicate ingredients, changed quantities and replacement of a known price', async t => {
  if (!reachable) return t.skip('no database');
  const f = await fixture(); const line = { ingredientId: f.ingredientId, quantityMilliBase: 1000000n, totalCostPaise: 50000n };
  await assert.rejects(() => recordOpeningStock(f.owner, { lines: [line, line] }), /each ingredient once/);
  await recordCorrection(f.owner, 'adjustment', { ingredientId: f.ingredientId, quantityMilliBase: 2000000n, reason: 'count_correction' });
  await assert.rejects(() => recordOpeningStock(f.owner, { lines: [line] }), /current positive quantity exactly/);
  await recordOpeningStock(f.owner, { lines: [{ ...line, quantityMilliBase: 2000000n, totalCostPaise: 0n }] });
  assert.equal((await stock(f.owner, f.ingredientId)).weightedAvgCostMillipaisePerBase, 0);
  await assert.rejects(() => recordOpeningStock(f.owner, { lines: [{ ...line, quantityMilliBase: 2000000n }] }), /already has a recorded cost/);
});

test('counter and kitchen cannot establish or replace opening inventory values', async t => {
  if (!reachable) return t.skip('no database');
  const f = await fixture();
  for (const role of ['counter', 'kitchen'] as const) await assert.rejects(() => recordOpeningStock({ ...f.owner, role }, {
    lines: [{ ingredientId: f.ingredientId, quantityMilliBase: 1000000n, totalCostPaise: 50000n }],
  }), AuthzError);
  assert.equal(await stock(f.owner, f.ingredientId), undefined);
});
