/**
 * T11 (database level) and T12. These need a live Postgres - they test transactions
 * and cache writes, which is exactly the part the pure tests in src/lib cannot reach.
 *
 *   npm run db:up && npm run db:migrate && npm test
 *
 * Without a reachable DATABASE_URL they SKIP rather than pass, loudly.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { db } from './client.ts';
import { dbReachable, closeDb } from './test-db.ts';
import { tenants, users, ingredients, stockMovements, ingredientStock } from './schema.ts';
import { recalculateStock, recordMovements, type MovementInput } from './stock.ts';
import { replayLedger, type Movement } from '../lib/stock.ts';

let reachable = false;
let tenantId: string;
let userId: string;

before(async () => {
  reachable = await dbReachable('database tests');
  if (!reachable) return;
  const [t] = await db.insert(tenants).values({ name: `test ${crypto.randomUUID()}` }).returning();
  tenantId = t.id;
  const [u] = await db
    .insert(users)
    .values({
      tenantId,
      name: 'Test',
      email: `test-${crypto.randomUUID()}@example.test`,
      passwordHash: 'x',
      role: 'owner',
    })
    .returning();
  userId = u.id;
});

after(closeDb);

async function makeIngredient(name: string) {
  const [row] = await db
    .insert(ingredients)
    .values({
      tenantId,
      name: `${name} ${crypto.randomUUID().slice(0, 8)}`,
      unitType: 'weight',
      purchaseUnit: 'kg',
      purchaseUnitInBase: 1000,
    })
    .returning();
  return row.id;
}

const g = (grams: number) => grams * 1000;

test('T11 - the cached stock equals a full rebuild from the ledger', async (t) => {
  if (!reachable) return t.skip('no database');
  const ingredientId = await makeIngredient('T11 butter');
  const base = { tenantId, ingredientId, createdByUserId: userId } as const;

  // Same ledger as the pure T11: two purchases, every non-purchase movement type,
  // a consumption that oversells into negative stock, then a purchase on top of it.
  const ledger: MovementInput[] = [
    { ...base, movementType: 'purchase', quantityMilliBase: g(5000), unitCostMillipaisePerBase: 50000, totalCostPaise: 250000 },
    { ...base, movementType: 'purchase', quantityMilliBase: g(3000), unitCostMillipaisePerBase: 55000, totalCostPaise: 165000 },
    { ...base, movementType: 'wastage', quantityMilliBase: g(-200), reason: 'burnt' },
    { ...base, movementType: 'adjustment', quantityMilliBase: g(-150), reason: 'count_correction' },
    { ...base, movementType: 'consumption', quantityMilliBase: g(-400) },
    { ...base, movementType: 'reversal', quantityMilliBase: g(400) },
    { ...base, movementType: 'consumption', quantityMilliBase: g(-9000) },
    { ...base, movementType: 'purchase', quantityMilliBase: g(2000), unitCostMillipaisePerBase: 60000, totalCostPaise: 120000 },
  ];

  // One at a time, as the counter would enter them - the incremental path.
  for (const line of ledger) await recordMovements([line]);

  const [cached] = await db
    .select()
    .from(ingredientStock)
    .where(and(eq(ingredientStock.tenantId, tenantId), eq(ingredientStock.ingredientId, ingredientId)));

  assert.equal(cached.qtyMilliBase, g(650), 'cached qty');
  assert.equal(cached.weightedAvgCostMillipaisePerBase, 60000, 'cached avg');

  // Now rebuild from the ledger independently and demand the same answer.
  const rows = await db
    .select({
      movementType: stockMovements.movementType,
      quantityMilliBase: stockMovements.quantityMilliBase,
      unitCostMillipaisePerBase: stockMovements.unitCostMillipaisePerBase,
    })
    .from(stockMovements)
    .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.ingredientId, ingredientId)))
    .orderBy(stockMovements.seq);

  const rebuilt = replayLedger(
    rows.map<Movement>((r) => ({
      movementType: r.movementType,
      quantityMilliBase: BigInt(r.quantityMilliBase),
      unitCostMillipaisePerBase: r.unitCostMillipaisePerBase == null ? null : BigInt(r.unitCostMillipaisePerBase),
    })),
  );

  assert.equal(rebuilt.qtyMilliBase, BigInt(cached.qtyMilliBase), 'rebuild vs cache: qty');
  assert.equal(
    rebuilt.weightedAvgCostMillipaisePerBase,
    BigInt(cached.weightedAvgCostMillipaisePerBase),
    'rebuild vs cache: avg',
  );

  // And recalculateStock must be idempotent - running it changes nothing.
  const after = await db.transaction((tx) => recalculateStock(tx, tenantId, ingredientId));
  assert.equal(after.qtyMilliBase, BigInt(cached.qtyMilliBase));
  assert.equal(after.weightedAvgCostMillipaisePerBase, BigInt(cached.weightedAvgCostMillipaisePerBase));
});

test('T12 - a multi-line receipt with one bad line rolls back entirely', async (t) => {
  if (!reachable) return t.skip('no database');
  const a = await makeIngredient('T12 maida');
  const b = await makeIngredient('T12 sugar');
  const c = await makeIngredient('T12 salt');
  const base = { tenantId, createdByUserId: userId, referenceType: 'receipt', referenceId: crypto.randomUUID() } as const;

  const before = await db
    .select()
    .from(ingredientStock)
    .where(eq(ingredientStock.tenantId, tenantId));

  const receipt: MovementInput[] = [
    { ...base, ingredientId: a, movementType: 'purchase', quantityMilliBase: g(50), unitCostMillipaisePerBase: 4200, totalCostPaise: 21000 },
    // Line 2 violates stock_movements_cost_on_purchase_only: a purchase with no cost.
    { ...base, ingredientId: b, movementType: 'purchase', quantityMilliBase: g(40) },
    { ...base, ingredientId: c, movementType: 'purchase', quantityMilliBase: g(10), unitCostMillipaisePerBase: 2200, totalCostPaise: 2200 },
  ];

  await assert.rejects(() => recordMovements(receipt), 'the receipt must fail as a whole');

  for (const ingredientId of [a, b, c]) {
    const movements = await db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.ingredientId, ingredientId)));
    assert.equal(movements.length, 0, 'no movement rows may survive a failed receipt');

    const [stock] = await db
      .select()
      .from(ingredientStock)
      .where(and(eq(ingredientStock.tenantId, tenantId), eq(ingredientStock.ingredientId, ingredientId)));
    assert.equal(stock, undefined, 'no cache row may be created by a failed receipt');
  }

  const partial = await db
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.referenceId, base.referenceId)));
  assert.equal(partial.length, 0, 'no partial reference_id group may remain');

  const afterAll = await db.select().from(ingredientStock).where(eq(ingredientStock.tenantId, tenantId));
  assert.equal(afterAll.length, before.length, 'ingredient_stock must be unchanged for all three');
});

/* --------------------------------------------------------------------------
 * Two people at once, and the watermark that makes the cache cheap
 * ------------------------------------------------------------------------ */

/** The state the ledger says is true, computed the long way round. */
async function rebuildOf(ingredientId: string) {
  return db.transaction((tx) => recalculateStock(tx, tenantId, ingredientId, { rebuild: true }));
}

const purchase = (ingredientId: string, qty: number, unitCost: number): MovementInput => ({
  tenantId,
  ingredientId,
  movementType: 'purchase',
  quantityMilliBase: qty,
  unitCostMillipaisePerBase: unitCost,
  totalCostPaise: Math.round((qty * unitCost) / 1_000_000),
  createdByUserId: userId,
});

test('two receipts for one ingredient at the same moment cannot lose a movement', async (t) => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Contended butter');

  /*
   * The failure this pins down: both transactions read the ledger before either commits,
   * so the second one computes its new state without the first one's movement in it and
   * then overwrites the cache. Stock and cost are both wrong afterwards, silently.
   *
   * The interleaving is forced rather than hoped for. The first transaction is held open
   * after it has written, the second is started and given time to reach the ledger read,
   * and only then is the first allowed to commit. Without the advisory lock this fails
   * every run, not one in ten.
   */
  let firstHasWritten!: () => void;
  let releaseFirst!: () => void;
  const written = new Promise<void>((resolve) => (firstHasWritten = resolve));
  const held = new Promise<void>((resolve) => (releaseFirst = resolve));

  const first = db.transaction(async (tx) => {
    await recordMovements([purchase(ing, 5_000_000, 50_000)], tx);
    firstHasWritten();
    await held;
  });

  await written;
  const second = db.transaction(async (tx) => {
    await recordMovements([purchase(ing, 3_000_000, 60_000)], tx);
  });

  // Long enough for the second transaction to have blocked on the lock - or, without
  // one, to have read the ledger and computed a state that is missing the first receipt.
  await new Promise((resolve) => setTimeout(resolve, 150));
  releaseFirst();
  await Promise.all([first, second]);

  const [cached] = await db
    .select()
    .from(ingredientStock)
    .where(and(eq(ingredientStock.tenantId, tenantId), eq(ingredientStock.ingredientId, ing)));
  const truth = await rebuildOf(ing);

  // 5 kg at 50000 then 3 kg at 60000: 8 kg, and (5x50000 + 3x60000)/8 = 53750.
  assert.equal(BigInt(cached.qtyMilliBase), 8_000_000n, 'a movement was lost from the cache');
  assert.equal(BigInt(cached.weightedAvgCostMillipaisePerBase), 53_750n);
  assert.equal(BigInt(cached.qtyMilliBase), truth.qtyMilliBase);
  assert.equal(
    BigInt(cached.weightedAvgCostMillipaisePerBase),
    truth.weightedAvgCostMillipaisePerBase,
  );
});

test('concurrent receipts across many ingredients still agree with the ledger', async (t) => {
  if (!reachable) return t.skip('no database');
  const a = await makeIngredient('Race maida');
  const b = await makeIngredient('Race sugar');

  // Both receipts name both ingredients, in opposite orders. Locks are taken sorted, so
  // this queues instead of deadlocking - which is the whole reason they are sorted.
  await Promise.all([
    recordMovements([purchase(a, 1_000_000, 4_000), purchase(b, 2_000_000, 7_000)]),
    recordMovements([purchase(b, 2_000_000, 9_000), purchase(a, 1_000_000, 6_000)]),
  ]);

  for (const ing of [a, b]) {
    const [cached] = await db
      .select()
      .from(ingredientStock)
      .where(and(eq(ingredientStock.tenantId, tenantId), eq(ingredientStock.ingredientId, ing)));
    const truth = await rebuildOf(ing);
    assert.equal(BigInt(cached.qtyMilliBase), truth.qtyMilliBase);
    assert.equal(
      BigInt(cached.weightedAvgCostMillipaisePerBase),
      truth.weightedAvgCostMillipaisePerBase,
    );
  }
});

test('the incremental fold and a full rebuild stay identical over many movements', async (t) => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Watermark walnut');

  // Prices and quantities chosen to make the average move to something that does not
  // divide evenly, so a rounding difference between the two paths would show up.
  for (let i = 1; i <= 12; i++) {
    await recordMovements([purchase(ing, 300_000 + i * 7_000, 40_000 + i * 313)]);
    await recordMovements([
      {
        tenantId,
        ingredientId: ing,
        movementType: 'wastage',
        quantityMilliBase: -11_000,
        reason: 'spoilage',
        createdByUserId: userId,
      },
    ]);
  }

  const [cached] = await db
    .select()
    .from(ingredientStock)
    .where(and(eq(ingredientStock.tenantId, tenantId), eq(ingredientStock.ingredientId, ing)));

  const movements = await db
    .select({ seq: stockMovements.seq })
    .from(stockMovements)
    .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.ingredientId, ing)));

  // The watermark is at the end of the ledger, not somewhere behind it.
  assert.equal(
    Number(cached.snapshotSeq),
    Math.max(...movements.map((m) => Number(m.seq))),
    'the cache is not caught up with the ledger it claims to summarise',
  );

  const truth = await rebuildOf(ing);
  assert.equal(BigInt(cached.qtyMilliBase), truth.qtyMilliBase);
  assert.equal(
    BigInt(cached.weightedAvgCostMillipaisePerBase),
    truth.weightedAvgCostMillipaisePerBase,
    'folding since the watermark disagreed with folding the whole ledger',
  );
});

test('recalculating with nothing new to fold changes nothing', async (t) => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Idempotent salt');
  await recordMovements([purchase(ing, 2_000_000, 2_200)]);

  const before = await db
    .select()
    .from(ingredientStock)
    .where(and(eq(ingredientStock.tenantId, tenantId), eq(ingredientStock.ingredientId, ing)));

  // Twice, because an incremental fold that re-read its own movements would double the
  // stock on the first repeat and keep going on the second.
  await db.transaction((tx) => recalculateStock(tx, tenantId, ing));
  await db.transaction((tx) => recalculateStock(tx, tenantId, ing));

  const after = await db
    .select()
    .from(ingredientStock)
    .where(and(eq(ingredientStock.tenantId, tenantId), eq(ingredientStock.ingredientId, ing)));

  assert.equal(after[0].qtyMilliBase, before[0].qtyMilliBase);
  assert.equal(
    after[0].weightedAvgCostMillipaisePerBase,
    before[0].weightedAvgCostMillipaisePerBase,
  );
  assert.equal(after[0].snapshotSeq, before[0].snapshotSeq);
});
