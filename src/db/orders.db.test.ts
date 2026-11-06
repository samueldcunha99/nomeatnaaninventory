import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, sql as raw } from 'drizzle-orm';
import { db } from './client.ts';
import { dbReachable, closeDb } from './test-db.ts';
import { tenants, users, orders, orderLines, orderLineDraws, stockMovements, ingredientStock } from './schema.ts';
import { getSalesReport } from './sales-report.ts';
import { getPublicTracking } from './tracking.ts';
import { istToday } from '../lib/time.ts';
import { createIngredient } from './ingredients.ts';
import { recordReceipt, recordOpeningStock } from './movements.ts';
import { saveRecipe, saveMenuItem } from './recipes.ts';
import { recordProductionRun, stockRecipe } from './production.ts';
import { lockIngredients, recordMovements } from './stock.ts';
import { createOrder, getOrder, listOrders, listKitchenOrders, listOrderMenu, changeOrderStatus, recordOrderPayment, saveSalesSettings } from './orders.ts';
import { AuthzError, type Actor, type Role } from '../lib/auth.ts';
import { pgError } from './errors.ts';

let reachable = false;
before(async () => { reachable = await dbReachable('order database regressions'); });
after(closeDb);

async function cafe(options: { priced?: boolean; stocked?: boolean; configure?: boolean } = {}) {
  const [tenant] = await db.insert(tenants).values({ name: `order test ${crypto.randomUUID()}` }).returning();
  const actors = {} as Record<Role, Actor>;
  for (const role of ['owner', 'manager', 'counter', 'kitchen'] as const) {
    const [u] = await db.insert(users).values({ tenantId: tenant.id, name: role, email: `${role}@example.test`, passwordHash: 'fixture-only', role }).returning();
    actors[role] = { id: u.id, tenantId: tenant.id, role };
  }
  const owner = actors.owner;
  const flour = await createIngredient(owner, { name: 'Flour', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, lowStockThresholdMilliBase: 0 });
  if (options.priced !== false) await recordReceipt(owner, { lines: [{ ingredientId: flour.id, quantityMilliBase: 5000000n, totalCostPaise: 50000n }] });
  const recipeId = await saveRecipe(owner, { name: 'Brownie tray', yieldUnitType: 'count', yieldQtyMilliBase: 10000n,
    lines: [{ ingredientId: flour.id, entryUnitType: 'weight', quantityMilliBase: 300000n }] });
  let shelf: string | null = null;
  if (options.stocked) {
    shelf = await stockRecipe(owner, recipeId);
    await recordProductionRun(owner, { requestId: crypto.randomUUID(), recipeId, producedOn: '2020-01-01', batchesMilli: 1000n, actualYieldMilliBase: 10000n });
  }
  const menuId = await saveMenuItem(owner, { recipeId, entryUnitType: 'count', name: 'Brownie', portionQtyMilliBase: 1000n,
    sellingPricePaise: 10000n, isActive: true, fulfillmentMode: options.stocked ? 'stocked' : 'made_to_order' });
  if (options.configure !== false) await saveSalesSettings(owner, { taxMode: 'none', taxRateMillipercent: 0n });
  return { ...actors, flour: flour.id, recipeId, menuId, shelf };
}
const input = (menuItemId: string, quantity = 2) => ({ requestId: crypto.randomUUID(), orderType: 'takeaway' as const,
  paymentMethod: 'unpaid' as const, lines: [{ menuItemId, quantity }] });
async function stock(actor: Actor, ingredientId: string) {
  const [row] = await db.select().from(ingredientStock).where(and(eq(ingredientStock.tenantId, actor.tenantId), eq(ingredientStock.ingredientId, ingredientId)));
  return row;
}
async function countOrders(actor: Actor) {
  return (await db.select({ id: orders.id }).from(orders).where(eq(orders.tenantId, actor.tenantId))).length;
}

test('an order consumes exact materials once and snapshots price, tax and material cost', async t => {
  if (!reachable) return t.skip('no database');
  const f = await cafe();
  const made = await createOrder(f.counter, input(f.menuId));
  const view = await getOrder(f.owner, made.orderId); assert.ok(view);
  assert.equal(view.orderNumber, 1); assert.equal(view.totalPaise, 20000n);
  assert.equal(view.lines[0].costSnapshotPaise, 600n);
  assert.equal((await stock(f.owner, f.flour)).qtyMilliBase, 4940000);
  await recordReceipt(f.owner, { lines: [{ ingredientId: f.flour, quantityMilliBase: 1000000n, totalCostPaise: 90000n }] });
  await saveMenuItem(f.owner, { id: f.menuId, recipeId: f.recipeId, entryUnitType: 'count', name: 'Brownie renamed',
    portionQtyMilliBase: 2000n, sellingPricePaise: 30000n, isActive: true, fulfillmentMode: 'made_to_order' });
  const historical = await getOrder(f.owner, made.orderId); assert.ok(historical);
  assert.equal(historical.lines[0].nameSnapshot, 'Brownie');
  assert.equal(historical.lines[0].costSnapshotPaise, 600n);
  assert.equal(historical.lines[0].unitPricePaise, 10000n);
  const counter = await getOrder(f.counter, made.orderId); assert.ok(counter);
  assert.equal(Object.hasOwn(counter.lines[0], 'costSnapshotPaise'), false);
});

test('unconfigured tax, stale price/tax quotes and unconfigured fulfillment refuse all writes', async t => {
  if (!reachable) return t.skip('no database');
  const f = await cafe({ configure: false }); const before = await stock(f.owner, f.flour);
  await assert.rejects(() => createOrder(f.counter, input(f.menuId)), /Configure sales tax/);
  await saveSalesSettings(f.owner, { taxMode: 'exclusive', taxRateMillipercent: 5000n });
  await assert.rejects(() => createOrder(f.counter, { ...input(f.menuId), expectedTaxMode: 'none', expectedTaxRateMillipercent: 0n }), /Sales tax settings changed/);
  await assert.rejects(() => createOrder(f.counter, { ...input(f.menuId), lines: [{ menuItemId: f.menuId, quantity: 1, expectedUnitPricePaise: 1n }] }), /changed since this form/);
  await saveMenuItem(f.owner, { id: f.menuId, recipeId: f.recipeId, entryUnitType: 'count', name: 'Brownie', portionQtyMilliBase: 1000n,
    sellingPricePaise: 10000n, isActive: true, fulfillmentMode: null });
  await assert.rejects(() => createOrder(f.counter, input(f.menuId)), /Choose whether/);
  assert.equal(await countOrders(f.owner), 0); assert.deepEqual(await stock(f.owner, f.flour), before);
});

test('menu stock policies prevent manual production and later stocking from consuming made-to-order materials twice', async t => {
  if (!reachable) return t.skip('no database');
  const f = await cafe();
  await assert.rejects(() => stockRecipe(f.owner, f.recipeId), /Disable that menu item/);
  await assert.rejects(() => recordProductionRun(f.owner, { requestId: crypto.randomUUID(), recipeId: f.recipeId,
    producedOn: '2020-01-01', batchesMilli: 1000n, actualYieldMilliBase: 10000n }), /made when ordered/);
  await saveMenuItem(f.owner, { id: f.menuId, recipeId: f.recipeId, entryUnitType: 'count', name: 'Brownie', portionQtyMilliBase: 1000n,
    sellingPricePaise: 10000n, isActive: false, fulfillmentMode: null });
  await recordProductionRun(f.owner, { requestId: crypto.randomUUID(), recipeId: f.recipeId,
    producedOn: '2020-01-01', batchesMilli: 1000n, actualYieldMilliBase: 10000n });
  await assert.rejects(() => saveMenuItem(f.owner, { id: f.menuId, recipeId: f.recipeId, entryUnitType: 'count', name: 'Brownie', portionQtyMilliBase: 1000n,
    sellingPricePaise: 10000n, isActive: true, fulfillmentMode: 'made_to_order' }), /manually recorded output/);
});

test('concurrent retries return one order, one payment and one stock deduction', async t => {
  if (!reachable) return t.skip('no database');
  const f = await cafe(); const data = { ...input(f.menuId), paymentMethod: 'cash' as const };
  const results = await Promise.all(Array.from({ length: 5 }, () => createOrder(f.counter, data)));
  assert.equal(new Set(results.map(r => r.orderId)).size, 1);
  assert.equal(results.filter(r => !r.alreadyRecorded).length, 1);
  const view = await getOrder(f.owner, results[0].orderId); assert.ok(view);
  assert.equal(view.payments.length, 1); assert.equal(view.paidPaise, 20000n);
  assert.equal((await stock(f.owner, f.flour)).qtyMilliBase, 4940000);
  await assert.rejects(() => createOrder(f.counter, { ...data, note: 'Changed retry' }), /already used for different details/);
  const another = await createOrder(f.counter, input(f.menuId)); assert.equal(another.orderNumber, 2);
});

test('prepared goods consume their shelf instead of their raw ingredients, and before-preparation cancellation restores it once', async t => {
  if (!reachable) return t.skip('no database');
  const f = await cafe({ stocked: true }); const flourBefore = await stock(f.owner, f.flour);
  const made = await createOrder(f.counter, input(f.menuId));
  assert.equal((await stock(f.owner, f.shelf!)).qtyMilliBase, 8000);
  assert.deepEqual(await stock(f.owner, f.flour), flourBefore);
  await changeOrderStatus(f.counter, { orderId: made.orderId, fromStatus: 'ordered', toStatus: 'cancelled', reason: 'Customer changed their mind' });
  assert.equal((await stock(f.owner, f.shelf!)).qtyMilliBase, 10000);
  const retry = await changeOrderStatus(f.counter, { orderId: made.orderId, toStatus: 'cancelled', reason: 'Retry' });
  assert.equal(retry.alreadyChanged, true); assert.equal((await stock(f.owner, f.shelf!)).qtyMilliBase, 10000);
});

test('after preparation starts cancellation retains materials, even after moving back to ordered', async t => {
  if (!reachable) return t.skip('no database');
  const f = await cafe(); const made = await createOrder(f.counter, input(f.menuId)); const used = await stock(f.owner, f.flour);
  await changeOrderStatus(f.kitchen, { orderId: made.orderId, toStatus: 'in_kitchen' });
  await changeOrderStatus(f.kitchen, { orderId: made.orderId, toStatus: 'ordered', reason: 'Correcting board status' });
  await changeOrderStatus(f.counter, { orderId: made.orderId, toStatus: 'cancelled', reason: 'Cancelled after work started' });
  assert.deepEqual(await stock(f.owner, f.flour), used);
  const view = await getOrder(f.owner, made.orderId); assert.ok(view);
  assert.equal(view.cancelledAfterPreparation, true); assert.equal(view.stockReversed, false);
});

test('later ingredient activity prevents a misleading before-preparation stock restoration', async t => {
  if (!reachable) return t.skip('no database');
  const f = await cafe(); const first = await createOrder(f.counter, input(f.menuId));
  await createOrder(f.counter, input(f.menuId));
  await assert.rejects(() => changeOrderStatus(f.counter, { orderId: first.orderId, toStatus: 'cancelled', reason: 'Late cancellation' }), /later activity/);
  assert.equal((await getOrder(f.owner, first.orderId))!.status, 'ordered');
});

test('unknown ingredient costs stay null while negative stock remains visible', async t => {
  if (!reachable) return t.skip('no database');
  const f = await cafe({ priced: false }); const made = await createOrder(f.counter, input(f.menuId, 1));
  const view = await getOrder(f.owner, made.orderId); assert.ok(view);
  assert.equal(view.lines[0].costSnapshotPaise, null); assert.equal((await stock(f.owner, f.flour)).qtyMilliBase, -30000);
  assert.equal((await stock(f.owner, f.flour)).weightedAvgCostMillipaisePerBase, null);
});

test('manual payments/refunds are role scoped, bounded and retry safe', async t => {
  if (!reachable) return t.skip('no database');
  const f = await cafe(); const made = await createOrder(f.counter, input(f.menuId, 1));
  const data = { orderId: made.orderId, requestId: crypto.randomUUID(), method: 'cash' as const, amountPaise: 4000n };
  await Promise.all([recordOrderPayment(f.counter, data), recordOrderPayment(f.counter, data)]);
  assert.equal((await getOrder(f.owner, made.orderId))!.paidPaise, 4000n);
  await assert.rejects(() => recordOrderPayment(f.counter, { ...data, requestId: crypto.randomUUID(), amountPaise: 7000n }), /exceeds/);
  await assert.rejects(() => recordOrderPayment(f.counter, { ...data, requestId: crypto.randomUUID(), eventType: 'refund' }), AuthzError);
  await recordOrderPayment(f.manager, { ...data, requestId: crypto.randomUUID(), amountPaise: 1000n, eventType: 'refund' });
  assert.equal((await getOrder(f.owner, made.orderId))!.paidPaise, 3000n);
  await assert.rejects(() => recordOrderPayment(f.owner, { ...data, amountPaise: 3999n }), /already used/);
});

test('tenant and kitchen guards protect private orders while the board omits prices and contact details', async t => {
  if (!reachable) return t.skip('no database');
  const f = await cafe(); const other = await cafe();
  const made = await createOrder(f.counter, { ...input(f.menuId), customerPhone: 'private-phone', customerName: 'Private customer' });
  assert.equal(await getOrder(other.owner, made.orderId), null);
  await assert.rejects(() => createOrder(other.counter, input(f.menuId)), /no longer available/);
  await assert.rejects(() => createOrder(f.kitchen, input(f.menuId)), AuthzError);
  await assert.rejects(() => getOrder(f.kitchen, made.orderId), AuthzError);
  await assert.rejects(() => saveSalesSettings(f.counter, { taxMode: 'none', taxRateMillipercent: 0n }), AuthzError);
  await assert.rejects(() => changeOrderStatus(f.kitchen, { orderId: made.orderId, toStatus: 'cancelled', reason: 'Denied' }), AuthzError);
  const board = JSON.stringify(await listKitchenOrders(f.kitchen));
  assert.ok(board.includes('Brownie')); assert.ok(!board.includes('private-phone')); assert.ok(!board.includes('costSnapshotPaise'));
  assert.equal((await listOrders(other.owner)).length, 0); assert.equal((await listOrderMenu(f.counter)).length, 1);
});

test('financial snapshots are append-only and database constraints reject mixed tax configuration', async t => {
  if (!reachable) return t.skip('no database');
  const f = await cafe(); const made = await createOrder(f.counter, input(f.menuId));
  const [line] = await db.select().from(orderLines).where(and(eq(orderLines.tenantId, f.owner.tenantId), eq(orderLines.orderId, made.orderId)));
  await assert.rejects(() => db.update(orderLines).set({ lineTotalPaise: 1 }).where(and(eq(orderLines.tenantId, f.owner.tenantId), eq(orderLines.id, line.id))), e => pgError(e)?.code === '23001');
  await assert.rejects(() => db.update(orders).set({ totalPaise: 1 }).where(and(eq(orders.tenantId, f.owner.tenantId), eq(orders.id, made.orderId))), e => pgError(e)?.code === '23001');
  await assert.rejects(() => db.update(tenants).set({ salesTaxMode: null, salesTaxRateMillipercent: 0 }).where(eq(tenants.id, f.owner.tenantId)), e => pgError(e)?.constraint_name === 'tenants_sales_tax_config');
  assert.equal((await getOrder(f.owner, made.orderId))!.totalPaise, 20000n);
});

test('order material valuation reads prices only after obtaining the ingredient lock', async t => {
  if (!reachable) return t.skip('no database');
  const f = await cafe(); let release!: () => void, ready!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const locked = new Promise<void>(resolve => { ready = resolve; });
  const writer = db.transaction(async tx => {
    await lockIngredients(tx, f.owner.tenantId, [f.flour]); ready(); await gate;
    await recordMovements([{ tenantId: f.owner.tenantId, ingredientId: f.flour, createdByUserId: f.owner.id,
      movementType: 'purchase', quantityMilliBase: 5000000, unitCostMillipaisePerBase: 20000, totalCostPaise: 100000 }], tx);
  });
  await locked; const pending = createOrder(f.counter, input(f.menuId)); let waited = false;
  try {
    for (let i = 0; i < 100; i++) {
      const [row] = await db.execute<{ n: number }>(raw`select count(*)::int n from pg_locks where locktype='advisory' and not granted
        and ((classid::bigint << 32) | objid::bigint) = hashtextextended(${`${f.owner.tenantId}:${f.flour}`},0)`);
      if (row.n > 0) { waited = true; break; } await new Promise(resolve => setTimeout(resolve, 20));
    }
  } finally { release(); await writer; }
  const made = await pending; assert.equal(waited, true);
  assert.equal((await getOrder(f.owner, made.orderId))!.lines[0].costSnapshotPaise, 900n);
});

test('public tracking requires the correct tenant and opaque token and returns no private fields', async t => {
  if (!reachable) return t.skip('no database');
  const f = await cafe(), other = await cafe();
  const made = await createOrder(f.counter, { ...input(f.menuId), customerName: 'Private customer', customerPhone: 'private-contact', note: 'private-note' });
  const order = (await getOrder(f.owner, made.orderId))!;
  const publicView = await getPublicTracking(f.owner.tenantId, order.trackingToken); assert.ok(publicView);
  assert.deepEqual(Object.keys(publicView).sort(), ['cafeName', 'createdAt', 'events', 'items', 'orderNumber', 'status']);
  assert.deepEqual(Object.keys(publicView.items[0]).sort(), ['name', 'quantity']);
  assert.deepEqual(Object.keys(publicView.events[0]).sort(), ['at', 'status']);
  assert.ok(!JSON.stringify(publicView).includes('private-'));
  assert.equal(await getPublicTracking(other.owner.tenantId, order.trackingToken), null);
  assert.equal(await getPublicTracking(f.owner.tenantId, crypto.randomUUID()), null);
  assert.equal(await getPublicTracking(f.owner.tenantId, 'bad'), null);
  await changeOrderStatus(f.kitchen, { orderId: made.orderId, toStatus: 'in_kitchen' });
  assert.equal((await getPublicTracking(f.owner.tenantId, order.trackingToken))!.status, 'in_kitchen');
});

test('sales reports retain historical costs, require owner/manager and separate payment dates from sale dates', async t => {
  if (!reachable) return t.skip('no database');
  const f = await cafe(), other = await cafe(); const made = await createOrder(f.counter, input(f.menuId));
  for (const toStatus of ['in_kitchen', 'baking', 'out_of_oven', 'ready', 'completed'] as const) await changeOrderStatus(f.kitchen, { orderId: made.orderId, toStatus });
  await recordOrderPayment(f.counter, { orderId: made.orderId, requestId: crypto.randomUUID(), method: 'cash', amountPaise: 20000n });
  await db.transaction(async tx => {
    await tx.execute(raw`set local app.ledger_maintenance = 'on'`);
    await tx.update(orders).set({ createdAt: new Date('2020-01-01T18:29:59Z') }).where(and(eq(orders.tenantId, f.owner.tenantId), eq(orders.id, made.orderId)));
  });
  await recordReceipt(f.owner, { lines: [{ ingredientId: f.flour, quantityMilliBase: 1000000n, totalCostPaise: 90000n }] });
  const old = await getSalesReport(f.manager, '2020-01-01', '2020-01-01');
  assert.equal(old.completedCount, 1); assert.equal(old.revenuePaise, 20000n); assert.equal(old.costPaise, 600n); assert.equal(old.marginPaise, 19400n);
  assert.equal(old.receivedPaise, 0n);
  const afterMidnight = await getSalesReport(f.owner, '2020-01-02', '2020-01-02'); assert.equal(afterMidnight.completedCount, 0);
  const today = await getSalesReport(f.owner, istToday(), istToday()); assert.equal(today.completedCount, 0); assert.equal(today.receivedPaise, 20000n);
  assert.equal((await getSalesReport(other.owner, '2020-01-01', '2020-01-01')).completedCount, 0);
  for (const role of ['counter', 'kitchen'] as const) await assert.rejects(() => getSalesReport(f[role], '2020-01-01', '2020-01-01'), AuthzError);
  await assert.rejects(() => getSalesReport(f.owner, '2020-02-30', '2020-03-01'), RangeError);
  await assert.rejects(() => getSalesReport(f.owner, '2020-01-01', '2021-01-01'), RangeError);
});
