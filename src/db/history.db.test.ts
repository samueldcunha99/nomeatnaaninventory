/**
 * Movement history and low stock, against a live Postgres.
 *
 * The load-bearing test here is the running balance under a date filter: the obvious
 * implementation computes the window over the filtered rows, which restarts the balance
 * at the start of the range and reads like a stock level while being a subtotal.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db } from './client.ts';
import { dbReachable, closeDb } from './test-db.ts';
import { tenants, users, ingredients, stockMovements } from './schema.ts';
import {
  listMovements,
  listLowStock,
  countDeliveriesSince,
  HISTORY_PAGE_SIZE,
} from './history.ts';
import { recordReceipt, recordCorrection } from './movements.ts';
import { AuthzError, type Actor, type Role } from '../lib/auth.ts';

let reachable = false;
let owner: Actor;
let kitchen: Actor;

async function makeActor(role: Role, tenantId: string): Promise<Actor> {
  const [u] = await db
    .insert(users)
    .values({ tenantId, name: role, email: `${role}-${crypto.randomUUID()}@example.test`, passwordHash: 'x', role })
    .returning();
  return { id: u.id, tenantId: u.tenantId, role };
}

before(async () => {
  reachable = await dbReachable('database history tests');
  if (!reachable) return;
  const [t] = await db.insert(tenants).values({ name: `hist test ${crypto.randomUUID()}` }).returning();
  owner = await makeActor('owner', t.id);
  kitchen = await makeActor('kitchen', t.id);
});

after(closeDb);

async function makeIngredient(name: string, thresholdMilliBase = 0, tenantId = owner.tenantId) {
  const [row] = await db
    .insert(ingredients)
    .values({
      tenantId,
      name: `${name} ${crypto.randomUUID().slice(0, 8)}`,
      unitType: 'weight',
      purchaseUnit: 'kg',
      purchaseUnitInBase: 1000,
      lowStockThresholdMilliBase: thresholdMilliBase,
    })
    .returning();
  return row.id;
}

test('history is newest first, in seq order, with a running balance', async (t) => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Balance');

  await recordReceipt(owner, { lines: [{ ingredientId: ing, quantityMilliBase: 5_000_000n, totalCostPaise: 250_000n }] });
  await recordCorrection(owner, 'wastage', { ingredientId: ing, quantityMilliBase: -200_000n, reason: 'burnt' });
  await recordReceipt(owner, { lines: [{ ingredientId: ing, quantityMilliBase: 3_000_000n, totalCostPaise: 165_000n }] });

  const { rows, showBalance } = await listMovements(owner, { ingredientId: ing });
  assert.equal(showBalance, true);
  assert.equal(rows.length, 3);

  // Newest first.
  assert.ok(rows[0].seq > rows[1].seq && rows[1].seq > rows[2].seq, 'ordered by seq, descending');

  // Balance is the stock after each movement, oldest to newest: 5000, 4800, 7800 g.
  assert.equal(rows[2].balanceMilliBase, 5_000_000);
  assert.equal(rows[1].balanceMilliBase, 4_800_000);
  assert.equal(rows[0].balanceMilliBase, 7_800_000);

  assert.equal(rows[0].movementType, 'purchase');
  assert.equal(rows[1].movementType, 'wastage');
  assert.equal(rows[1].reason, 'burnt');
  assert.equal(rows[0].userName, 'owner', 'who did it');
  assert.ok(rows[0].createdAt instanceof Date, 'when');
});

test('a date filter narrows the rows but must NOT restart the balance', async (t) => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Filtered');

  await recordReceipt(owner, { lines: [{ ingredientId: ing, quantityMilliBase: 5_000_000n, totalCostPaise: 250_000n }] });
  // Backdate the opening receipt so it sits before the filter window.
  await db.update(stockMovements).set({ createdAt: new Date('2026-01-01T00:00:00Z') }).where(eq(stockMovements.ingredientId, ing));

  await recordCorrection(owner, 'adjustment', {
    ingredientId: ing,
    quantityMilliBase: -150_000n,
    reason: 'count_correction',
  });

  const { rows } = await listMovements(owner, { ingredientId: ing, from: new Date('2026-06-01T00:00:00Z') });

  assert.equal(rows.length, 1, 'the backdated receipt is filtered out of the rows');
  // ...but its quantity is still in the balance. 5000 g - 150 g = 4850 g.
  assert.equal(
    rows[0].balanceMilliBase,
    4_850_000,
    'the balance must be the real stock level, not a subtotal of the filtered range',
  );
});

test('the balance is withheld when no single ingredient is chosen', async (t) => {
  if (!reachable) return t.skip('no database');
  const a = await makeIngredient('MixedA');
  const b = await makeIngredient('MixedB');
  await recordReceipt(owner, {
    lines: [
      { ingredientId: a, quantityMilliBase: 1_000_000n, totalCostPaise: 40_000n },
      { ingredientId: b, quantityMilliBase: 2_000_000n, totalCostPaise: 90_000n },
    ],
  });

  const { showBalance, rows } = await listMovements(owner, {});
  assert.equal(showBalance, false, 'adding grams of one thing to millilitres of another is meaningless');
  assert.ok(rows.length >= 2);
});

test('multi-line receipts share a reference_id so they can be grouped', async (t) => {
  if (!reachable) return t.skip('no database');
  const a = await makeIngredient('GroupA');
  const b = await makeIngredient('GroupB');
  const { referenceId } = await recordReceipt(owner, {
    lines: [
      { ingredientId: a, quantityMilliBase: 1_000_000n, totalCostPaise: 40_000n },
      { ingredientId: b, quantityMilliBase: 2_000_000n, totalCostPaise: 90_000n },
    ],
  });

  const { rows } = await listMovements(owner, {});
  const group = rows.filter((r) => r.referenceId === referenceId);
  assert.equal(group.length, 2);
  assert.ok(group.every((r) => r.referenceType === 'receipt'));
});

test('lines within a single receipt group display in entry order (ascending seq)', async (t) => {
  if (!reachable) return t.skip('no database');
  const first = await makeIngredient('First');
  const second = await makeIngredient('Second');
  const third = await makeIngredient('Third');
  const { referenceId } = await recordReceipt(owner, {
    lines: [
      { ingredientId: first, quantityMilliBase: 1_000_000n, totalCostPaise: 10_000n },
      { ingredientId: second, quantityMilliBase: 2_000_000n, totalCostPaise: 20_000n },
      { ingredientId: third, quantityMilliBase: 3_000_000n, totalCostPaise: 30_000n },
    ],
  });

  const { rows } = await listMovements(owner, {});
  const group = rows.filter((r) => r.referenceId === referenceId);
  assert.equal(group.length, 3);
  assert.equal(group[0].ingredientId, first, 'first entered line displays first');
  assert.equal(group[1].ingredientId, second, 'second entered line displays second');
  assert.equal(group[2].ingredientId, third, 'third entered line displays third');
  assert.ok(group[0].seq < group[1].seq && group[1].seq < group[2].seq, 'lines within receipt group are ascending seq');
  assert.equal(group[0].purchaseUnit, 'kg', 'purchaseUnit is populated');
});

test('history pages rather than fetching an unbounded ledger', async (t) => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Paged');
  await recordReceipt(owner, { lines: [{ ingredientId: ing, quantityMilliBase: 100_000_000n, totalCostPaise: 100_000n }] });

  // One more than a full page, cheaply: insert straight to the ledger.
  const filler = Array.from({ length: HISTORY_PAGE_SIZE }, () => ({
    tenantId: owner.tenantId,
    ingredientId: ing,
    movementType: 'consumption' as const,
    quantityMilliBase: -1000,
    createdByUserId: owner.id,
  }));
  await db.insert(stockMovements).values(filler);

  const first = await listMovements(owner, { ingredientId: ing, page: 1 });
  assert.equal(first.rows.length, HISTORY_PAGE_SIZE, 'a page is capped');
  assert.equal(first.hasNextPage, true);
  assert.equal(first.hasPreviousPage, false);

  const second = await listMovements(owner, { ingredientId: ing, page: 2 });
  assert.equal(second.rows.length, 1);
  assert.equal(second.hasNextPage, false);
  assert.equal(second.hasPreviousPage, true);

  const overlap = first.rows.filter((r) => second.rows.some((s) => s.id === r.id));
  assert.deepEqual(overlap, [], 'pages must not repeat rows');

  // Page 2 continues the balance rather than restarting it.
  assert.ok(second.rows[0].balanceMilliBase > first.rows[0].balanceMilliBase);
});

test('low stock is sorted by severity, not by raw shortfall', async (t) => {
  if (!reachable) return t.skip('no database');
  // 2 kg short of a 3 kg threshold is more urgent than 2 kg short of a 50 kg one.
  const urgent = await makeIngredient('Urgent', 3_000_000);
  const mild = await makeIngredient('Mild', 50_000_000);
  const fine = await makeIngredient('Fine', 1_000_000);

  await recordReceipt(owner, {
    lines: [
      { ingredientId: urgent, quantityMilliBase: 1_000_000n, totalCostPaise: 10_000n },
      { ingredientId: mild, quantityMilliBase: 48_000_000n, totalCostPaise: 480_000n },
      { ingredientId: fine, quantityMilliBase: 9_000_000n, totalCostPaise: 90_000n },
    ],
  });

  const low = await listLowStock(owner);
  const ids = low.map((r) => r.ingredientId);

  assert.ok(ids.includes(urgent) && ids.includes(mild), 'both are at or below threshold');
  assert.ok(!ids.includes(fine), 'well-stocked ingredients are not listed');
  assert.ok(
    ids.indexOf(urgent) < ids.indexOf(mild),
    'proportional shortfall decides the order, not the absolute gap',
  );
});

test('an ingredient with no threshold set only appears once actually oversold', async (t) => {
  if (!reachable) return t.skip('no database');
  const noThreshold = await makeIngredient('NoThreshold', 0);
  await recordReceipt(owner, { lines: [{ ingredientId: noThreshold, quantityMilliBase: 1_000n, totalCostPaise: 100n }] });
  await recordCorrection(owner, 'adjustment', {
    ingredientId: noThreshold,
    quantityMilliBase: -1_000n,
    reason: 'count_correction',
  });

  // Sitting at exactly zero with no threshold: not interesting, would clutter the list.
  assert.ok(!(await listLowStock(owner)).some((r) => r.ingredientId === noThreshold));

  await recordCorrection(owner, 'wastage', { ingredientId: noThreshold, quantityMilliBase: -500n, reason: 'dropped' });
  const low = await listLowStock(owner);
  const row = low.find((r) => r.ingredientId === noThreshold);
  assert.ok(row, 'oversold always shows, threshold or not');
  assert.equal(row.qtyMilliBase, -500);
});

test('kitchen staff cannot read history or low stock', async (t) => {
  if (!reachable) return t.skip('no database');
  await assert.rejects(() => listMovements(kitchen, {}), AuthzError);
  await assert.rejects(() => listLowStock(kitchen), AuthzError);
});

test('history and low stock do not leak across tenants', async (t) => {
  if (!reachable) return t.skip('no database');
  const [other] = await db.insert(tenants).values({ name: `other ${crypto.randomUUID()}` }).returning();
  const otherOwner = await makeActor('owner', other.id);

  const mine = await makeIngredient('Private', 5_000_000);
  await recordReceipt(owner, { lines: [{ ingredientId: mine, quantityMilliBase: 1_000n, totalCostPaise: 100n }] });

  const theirs = await listMovements(otherOwner, {});
  assert.deepEqual(theirs.rows, [], 'a fresh tenant sees an empty ledger');
  assert.deepEqual(await listLowStock(otherOwner), []);

  // And naming another tenant's ingredient explicitly still shows nothing.
  const targeted = await listMovements(otherOwner, { ingredientId: mine });
  assert.deepEqual(targeted.rows, []);
});

/**
 * Postgres returns sum()/count()/avg() over a bigint as `numeric`, and postgres.js hands
 * `numeric` back as a STRING. A field declared `number` that is really a string compares
 * lexicographically: '900' > '4850000' is true. A margin figure built on that is quietly
 * wrong, and nothing throws.
 *
 * Drizzle converts columns whose type it knows. It cannot convert a raw SQL expression,
 * so every aggregate has to be normalised by hand - and this test is what notices when a
 * new one is not.
 */
test('every numeric field crossing the driver boundary is a number, not a string', async (t) => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('TypeCheck', 10_000_000);
  await recordReceipt(owner, {
    lines: [{ ingredientId: ing, quantityMilliBase: 5_000_000n, totalCostPaise: 250_000n }],
  });
  await recordCorrection(owner, 'wastage', { ingredientId: ing, quantityMilliBase: -200_000n, reason: 'burnt' });

  const numericField = (row: Record<string, unknown>, key: string, where: string) => {
    const value = row[key];
    if (value === null) return; // nullable columns are allowed to be null
    assert.equal(
      typeof value,
      'number',
      `${where}.${key} is a ${typeof value} (${JSON.stringify(value)}). ` +
        `A numeric aggregate needs Number() in the query layer - see AGENTS.md.`,
    );
    assert.ok(Number.isFinite(value as number), `${where}.${key} must be finite`);
  };

  const history = await listMovements(owner, { ingredientId: ing });
  assert.ok(history.rows.length > 0, 'need rows to check');
  for (const row of history.rows as unknown as Record<string, unknown>[]) {
    for (const key of [
      'seq',
      'quantityMilliBase',
      'balanceMilliBase',
      'unitCostMillipaisePerBase',
      'totalCostPaise',
      'purchaseUnitInBase',
    ]) {
      numericField(row, key, 'listMovements');
    }
  }

  // The one that actually regressed: a running total, not a plain column.
  assert.equal(typeof history.rows[0].balanceMilliBase, 'number', 'the window sum must be normalised');

  const low = await listLowStock(owner);
  assert.ok(low.length > 0, 'the seeded ingredient is below its threshold');
  for (const row of low as unknown as Record<string, unknown>[]) {
    for (const key of [
      'qtyMilliBase',
      'lowStockThresholdMilliBase',
      'weightedAvgCostMillipaisePerBase',
      'purchaseUnitInBase',
    ]) {
      numericField(row, key, 'listLowStock');
    }
  }

  // And prove the sort is numeric rather than lexicographic, which is how a
  // string-typed number shows up in behaviour rather than in a type error.
  const balances = history.rows.map((r) => r.balanceMilliBase);
  assert.deepEqual(
    [...balances].sort((a, b) => a - b),
    [...balances].sort((a, b) => a - b),
    'sanity',
  );
  assert.ok(
    balances.every((b) => typeof b === 'number'),
    'a string here would make every comparison lexicographic: "900" > "4850000" is true',
  );
});

/*
 * Deliveries today runs in a tenant of its own. Every other test in this file writes
 * receipts to the shared fixture tenant, and a count that has to reason about which of
 * them fell inside a time window would be measuring the test file, not the query.
 */
test('deliveries counts receipts, not the lines on them', async (t) => {
  if (!reachable) return t.skip('no database');
  const [t2] = await db
    .insert(tenants)
    .values({ name: `hist deliveries ${crypto.randomUUID()}` })
    .returning();
  const counter = await makeActor('owner', t2.id);
  const flour = await makeIngredient('Delivery flour', 0, counter.tenantId);
  const sugar = await makeIngredient('Delivery sugar', 0, counter.tenantId);
  const EPOCH = new Date(0);

  assert.equal(await countDeliveriesSince(counter, EPOCH), 0, 'a new tenant has no deliveries');

  // The whole point of the figure: this is ONE delivery, whatever arrived on it. Counting
  // rows would report a two-line receipt as two, which is not what anyone at the counter
  // means by "deliveries today".
  await recordReceipt(counter, {
    lines: [
      { ingredientId: flour, quantityMilliBase: 25_000_000n, totalCostPaise: 105_000n },
      { ingredientId: sugar, quantityMilliBase: 10_000_000n, totalCostPaise: 58_000n },
    ],
  });
  assert.equal(await countDeliveriesSince(counter, EPOCH), 1);

  await recordReceipt(counter, {
    lines: [{ ingredientId: flour, quantityMilliBase: 5_000_000n, totalCostPaise: 21_000n }],
  });
  assert.equal(await countDeliveriesSince(counter, EPOCH), 2);

  // A correction is not a delivery. Nothing arrived.
  await recordCorrection(counter, 'wastage', {
    ingredientId: flour,
    quantityMilliBase: -1_000_000n,
    reason: 'spoilage',
  });
  assert.equal(await countDeliveriesSince(counter, EPOCH), 2);

  // The window is real, not decorative.
  const later = new Date(Date.now() + 60_000);
  assert.equal(await countDeliveriesSince(counter, later), 0);

  // And it does not leak: another tenant's receipts are not this tenant's deliveries.
  const [t3] = await db
    .insert(tenants)
    .values({ name: `hist deliveries other ${crypto.randomUUID()}` })
    .returning();
  const stranger = await makeActor('owner', t3.id);
  assert.equal(await countDeliveriesSince(stranger, EPOCH), 0);

  await assert.rejects(countDeliveriesSince(kitchen, EPOCH), AuthzError);
});
