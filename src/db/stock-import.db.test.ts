import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { db } from './client.ts';
import { dbReachable, closeDb } from './test-db.ts';
import { tenants, users, stockMovements, auditLog } from './schema.ts';
import { createIngredient, listIngredients } from './ingredients.ts';
import { recordReceipt } from './movements.ts';
import { saveStockImport } from './stock-import.ts';
import { getDailyReport } from './daily-report.ts';
import { istToday } from '../lib/time.ts';
import { AuthzError, type Actor } from '../lib/auth.ts';
import { STOCK_IMPORT_TEMPLATE, parseStockImport, matchStockImport, type StockImportMode } from '../lib/stock-import.ts';

let reachable = false;
before(async () => { reachable = await dbReachable('stock file import'); });
after(closeDb);
async function fixture() {
  const [tenant] = await db.insert(tenants).values({ name: `CSV QA ${crypto.randomUUID()}` }).returning();
  const [user] = await db.insert(users).values({ tenantId: tenant.id, name: 'Owner', email: 'csv@example.test', role: 'owner', passwordHash: 'fixture' }).returning();
  return { id: user.id, tenantId: tenant.id, role: 'owner' } as Actor;
}
async function submission(actor: Actor, csv: string, mode: StockImportMode = 'opening', reference = '') {
  const parsed = parseStockImport(csv); assert.deepEqual(parsed.issues, []);
  return { csv, mode, reference, expectedIds: matchStockImport(parsed.rows, await listIngredients(actor, { activeOnly: false })).map(row => row.ingredientId) };
}
const rowsFor = async (actor: Actor) => db.select().from(stockMovements).where(eq(stockMovements.tenantId, actor.tenantId));

test('stock file creates ingredients plus opening values atomically; concurrent retries and re-preview do not duplicate', async t => {
  if (!reachable) return t.skip('no database');
  const actor = await fixture();
  const csv = STOCK_IMPORT_TEMPLATE + 'Sugar,,weight,kg,1000,1.25,125,0.5\nMilk,,volume,L,1000,2,0,1';
  const data = await submission(actor, csv);
  const results = await Promise.all([saveStockImport(actor, data), saveStockImport(actor, data)]);
  assert.equal(results.filter(row => !row.replayed).length, 1);
  const ingredients = await listIngredients(actor);
  assert.equal(ingredients.length, 2);
  const sugar = ingredients.find(row => row.name === 'Sugar')!;
  assert.equal(sugar.qtyMilliBase, 1250000); assert.equal(sugar.weightedAvgCostMillipaisePerBase, 10000);
  assert.equal(sugar.lowStockThresholdMilliBase, 500000);
  assert.equal(ingredients.find(row => row.name === 'Milk')!.weightedAvgCostMillipaisePerBase, 0);
  assert.equal((await rowsFor(actor)).length, 2);
  assert.equal((await getDailyReport(actor, istToday())).purchases.length, 0);
  assert.equal((await saveStockImport(actor, await submission(actor, csv))).replayed, true);
  assert.equal((await rowsFor(actor)).length, 2);
});

test('a bad opening row rolls back earlier ingredient creation, stock and import audit', async t => {
  if (!reachable) return t.skip('no database');
  const actor = await fixture();
  const existing = await createIngredient(actor, { name: 'Known', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, lowStockThresholdMilliBase: 0 });
  await recordReceipt(actor, { lines: [{ ingredientId: existing.id, quantityMilliBase: 1000000n, totalCostPaise: 500n }] });
  const csv = STOCK_IMPORT_TEMPLATE + 'New sugar,,weight,kg,1000,1,10,\nKnown,,weight,kg,1000,1,20,';
  const input = await submission(actor, csv);
  await assert.rejects(() => saveStockImport(actor, input), /already has a recorded cost/);
  assert.equal((await listIngredients(actor)).length, 1); assert.equal((await rowsFor(actor)).length, 1);
  assert.equal((await db.select().from(auditLog).where(and(eq(auditLog.tenantId, actor.tenantId), eq(auditLog.action, 'stock.import')))).length, 0);
});

test('ingredient-only files create unknown-cost catalogue entries without stock or purchases', async t => {
  if (!reachable) return t.skip('no database');
  const actor = await fixture(); const csv = STOCK_IMPORT_TEMPLATE + 'Cardamom,,weight,kg,1000,,,0.1';
  assert.equal((await saveStockImport(actor, await submission(actor, csv))).stockLines, 0);
  const [row] = await listIngredients(actor);
  assert.equal(row.qtyMilliBase, 0); assert.equal(row.weightedAvgCostMillipaisePerBase, null);
  assert.equal((await rowsFor(actor)).length, 0);
});

test('delivery imports use saved existing settings; a different delivery reference allows a real identical purchase', async t => {
  if (!reachable) return t.skip('no database');
  const actor = await fixture(); const csv = STOCK_IMPORT_TEMPLATE + 'Sugar,,weight,kg,1000,1,100,0.5';
  await saveStockImport(actor, await submission(actor, csv, 'receipt', 'Invoice 1'));
  const [first] = await listIngredients(actor);
  await saveStockImport(actor, await submission(actor, csv, 'receipt', 'Invoice 2'));
  const [second] = await listIngredients(actor);
  assert.equal(first.id, second.id); assert.equal(second.qtyMilliBase, 2000000);
  assert.equal((await getDailyReport(actor, istToday())).totalPaidPaise, 20000n);
});

test('changed preview identity or pack refuses the entire import and cannot reference another cafe', async t => {
  if (!reachable) return t.skip('no database');
  const actor = await fixture(); const other = await fixture();
  const csv = STOCK_IMPORT_TEMPLATE + 'Sugar,,weight,kg,1000,1,100,0.5';
  const data = await submission(actor, csv, 'receipt');
  const existing = await createIngredient(actor, { name: 'Sugar', unitType: 'volume', purchaseUnit: 'kg', purchaseUnitInBase: 1000, lowStockThresholdMilliBase: 0 });
  await assert.rejects(() => saveStockImport(actor, data), /list changed/);
  await assert.rejects(() => saveStockImport(other, { ...data, expectedIds: [existing.id] }), /list changed/);
  assert.equal((await rowsFor(actor)).length, 0); assert.equal((await listIngredients(other)).length, 0);
});

test('malformed files, duplicate rows, unsafe amounts and staff without management permission never write', async t => {
  if (!reachable) return t.skip('no database');
  const actor = await fixture(); const csv = STOCK_IMPORT_TEMPLATE + 'Sugar,,weight,kg,1000,1,100,';
  const data = await submission(actor, csv);
  for (const role of ['counter', 'kitchen'] as const) await assert.rejects(() => saveStockImport({ ...actor, role }, data), AuthzError);
  for (const body of ['Sugar,,weight,kg,1000,1,,', 'Sugar,,weight,kg,1000,9007199254740.993,1,',
    'Sugar,,weight,kg,1000,1,1,\nsugar,,weight,kg,1000,1,1,']) {
    await assert.rejects(() => saveStockImport(actor, { ...data, csv: STOCK_IMPORT_TEMPLATE + body }), /Fix every file error/);
  }
  assert.equal((await listIngredients(actor)).length, 0); assert.equal((await rowsFor(actor)).length, 0);
});
