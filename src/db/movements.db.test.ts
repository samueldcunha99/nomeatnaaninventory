/**
 * Receipts, adjustments and wastage against a live Postgres.
 *
 * The point of most of these is that the ledger and the cache agree afterwards, and
 * that a bad line leaves nothing behind.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, sql as raw } from 'drizzle-orm';
import { db } from './client.ts';
import { dbReachable, closeDb } from './test-db.ts';
import { tenants, users, ingredients, suppliers, stockMovements, ingredientStock, auditLog } from './schema.ts';
import { recordReceipt, recordOpeningStock, recordCorrection, listSuppliers } from './movements.ts';
import { updateIngredient } from './ingredients.ts';
import { lockIngredients, recalculateStock } from './stock.ts';
import { AuthzError, type Actor, type Role } from '../lib/auth.ts';

let reachable = false;
let owner: Actor;
let kitchen: Actor;
let supplierId: string;

async function makeActor(role: Role, tenantId: string): Promise<Actor> {
  const [u] = await db
    .insert(users)
    .values({ tenantId, name: role, email: `${role}-${crypto.randomUUID()}@example.test`, passwordHash: 'x', role })
    .returning();
  return { id: u.id, tenantId: u.tenantId, role };
}

before(async () => {
  reachable = await dbReachable('database movement tests');
  if (!reachable) return;
  const [t] = await db.insert(tenants).values({ name: `mv test ${crypto.randomUUID()}` }).returning();
  owner = await makeActor('owner', t.id);
  kitchen = await makeActor('kitchen', t.id);
  const [s] = await db.insert(suppliers).values({ tenantId: t.id, name: 'Test supplier' }).returning();
  supplierId = s.id;
});

after(closeDb);

async function makeIngredient(name: string, purchaseUnitInBase = 1000) {
  const [row] = await db
    .insert(ingredients)
    .values({
      tenantId: owner.tenantId,
      name: `${name} ${crypto.randomUUID().slice(0, 8)}`,
      unitType: 'weight',
      purchaseUnit: purchaseUnitInBase === 30 ? 'tray' : 'kg',
      purchaseUnitInBase,
    })
    .returning();
  return row.id;
}

const stockOf = async (ingredientId: string) => {
  const [row] = await db
    .select()
    .from(ingredientStock)
    .where(and(eq(ingredientStock.tenantId, owner.tenantId), eq(ingredientStock.ingredientId, ingredientId)));
  return row;
};

const movementsOf = async (ingredientId: string) =>
  db
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.tenantId, owner.tenantId), eq(stockMovements.ingredientId, ingredientId)));

test('a multi-line receipt lands as one reference group and costs out correctly', async (t) => {
  if (!reachable) return t.skip('no database');
  const butter = await makeIngredient('Butter');
  const salt = await makeIngredient('Salt');

  const { referenceId, lineCount } = await recordReceipt(owner, {
    supplierId,
    note: 'Tuesday delivery',
    lines: [
      // 5 kg butter for Rs 2,500 -> T1: 50000 millipaise/g
      { ingredientId: butter, quantityMilliBase: 5_000_000n, totalCostPaise: 250_000n },
      // 25 kg salt for Rs 550 -> T5: 2200, the canary
      { ingredientId: salt, quantityMilliBase: 25_000_000n, totalCostPaise: 55_000n },
    ],
  });
  assert.equal(lineCount, 2);

  const butterStock = await stockOf(butter);
  assert.equal(butterStock.qtyMilliBase, 5_000_000);
  assert.equal(butterStock.weightedAvgCostMillipaisePerBase, 50_000);

  const saltStock = await stockOf(salt);
  assert.equal(saltStock.weightedAvgCostMillipaisePerBase, 2200, 'the cheap-ingredient canary survives the form path');

  const grouped = await db
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.tenantId, owner.tenantId), eq(stockMovements.referenceId, referenceId)));
  assert.equal(grouped.length, 2, 'both lines share one reference_id');
  assert.ok(grouped.every((m) => m.supplierId === supplierId && m.referenceType === 'receipt'));
});

test('retrying the same receipt returns its original group without adding stock or another audit entry', async t => {
  if (!reachable) return t.skip('no database');
  const ingredientId = await makeIngredient('Receipt retry');
  const input = { requestId: crypto.randomUUID(), supplierId, note: 'One delivery',
    lines: [{ ingredientId, quantityMilliBase: 1000000n, totalCostPaise: 50000n }] };
  const first = await recordReceipt(owner, input);
  const before = await stockOf(ingredientId);
  const retry = await recordReceipt(owner, input);
  assert.equal(first.referenceId, input.requestId);
  assert.equal(first.replayed, false);
  assert.equal(retry.replayed, true);
  assert.equal(retry.referenceId, first.referenceId);
  assert.deepEqual(await stockOf(ingredientId), before);
  assert.equal((await movementsOf(ingredientId)).length, 1);
  const audit = await db.select().from(auditLog).where(and(eq(auditLog.tenantId, owner.tenantId), eq(auditLog.entityId, input.requestId)));
  assert.equal(audit.length, 1);
  await assert.rejects(() => recordReceipt(kitchen, input), AuthzError);
});

test('a receipt identity cannot be reused with changed lines, supplier or notes', async t => {
  if (!reachable) return t.skip('no database');
  const ingredientId = await makeIngredient('Receipt changed retry');
  const input = { requestId: crypto.randomUUID(), supplierId, note: 'Original',
    lines: [{ ingredientId, quantityMilliBase: 1000000n, totalCostPaise: 50000n }] };
  await recordReceipt(owner, input);
  for (const patch of [
    { note: 'Different' }, { supplierId: null },
    { lines: [{ ...input.lines[0], quantityMilliBase: 2000000n }] },
    { lines: [{ ...input.lines[0], totalCostPaise: 60000n }] },
  ]) await assert.rejects(() => recordReceipt(owner, { ...input, ...patch }), /already recorded with different details/);
  assert.equal((await movementsOf(ingredientId)).length, 1);
  assert.equal((await stockOf(ingredientId)).qtyMilliBase, 1000000);
});

test('concurrent retries of one receipt create one delivery', async t => {
  if (!reachable) return t.skip('no database');
  const ingredientId = await makeIngredient('Concurrent receipt retry');
  const input = { requestId: crypto.randomUUID(), lines: [{ ingredientId, quantityMilliBase: 1000000n, totalCostPaise: 50000n }] };
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const locked = new Promise<void>(resolve => { ready = resolve; });
  const blocker = db.transaction(async tx => {
    await lockIngredients(tx, owner.tenantId, [ingredientId]); ready(); await gate;
  });
  await locked;
  const attempts = Promise.all([recordReceipt(owner, input), recordReceipt(owner, input)]);
  let bothWaiting = false;
  try {
    // Hold the ingredient until both requests reach a lock. With the receipt guard,
    // one waits on this ingredient and one on the receipt. Without it, both already
    // observed an empty group and wait here, so duplicate writes are deterministic.
    const ingredientKey = `${owner.tenantId}:${ingredientId}`;
    const receiptKey = `receipt:${owner.tenantId}:${input.requestId}`;
    for (let i = 0; i < 100; i++) {
      const [row] = await db.execute<{ waiting: number }>(raw`select count(*)::int as waiting from pg_locks
        where locktype = 'advisory' and not granted and ((classid::bigint << 32) | objid::bigint)
        in (hashtextextended(${ingredientKey}, 0), hashtextextended(${receiptKey}, 0))`);
      if (row.waiting === 2) { bothWaiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  } finally { release(); await blocker; }
  const results = await attempts;
  assert.equal(bothWaiting, true, 'both receipt attempts reached the forced interleaving');
  assert.equal(results.filter(r => !r.replayed).length, 1);
  assert.equal(new Set(results.map(r => r.referenceId)).size, 1);
  assert.equal((await movementsOf(ingredientId)).length, 1);
  assert.equal((await stockOf(ingredientId)).qtyMilliBase, 1000000);
});

test('receipt identity is tenant scoped and overlarge quantities or prices refuse exact-storage loss', async t => {
  if (!reachable) return t.skip('no database');
  const ingredientId = await makeIngredient('Exact receipt');
  for (const line of [
    { ingredientId, quantityMilliBase: 9007199254740993n, totalCostPaise: 1n },
    { ingredientId, quantityMilliBase: 1000n, totalCostPaise: 9007199254740993n },
    { ingredientId, quantityMilliBase: 1n, totalCostPaise: 9007199254740991n },
  ]) await assert.rejects(() => recordReceipt(owner, { lines: [line] }), /too large to record exactly/);
  const [otherTenant] = await db.insert(tenants).values({ name: `Receipt isolation ${crypto.randomUUID()}` }).returning();
  const other = await makeActor('owner', otherTenant.id);
  const [otherIngredient] = await db.insert(ingredients).values({ tenantId: otherTenant.id,
    name: 'Other flour', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000 }).returning();
  const requestId = crypto.randomUUID();
  const first = await recordReceipt(owner, { requestId, lines: [{ ingredientId, quantityMilliBase: 1000n, totalCostPaise: 10n }] });
  const second = await recordReceipt(other, { requestId, lines: [{ ingredientId: otherIngredient.id, quantityMilliBase: 1000n, totalCostPaise: 20n }] });
  assert.equal(first.replayed, false); assert.equal(second.replayed, false);
  assert.equal((await movementsOf(ingredientId)).length, 1);
});

test('a receipt with one bad line writes nothing at all', async (t) => {
  if (!reachable) return t.skip('no database');
  const good = await makeIngredient('Maida');
  const missing = crypto.randomUUID(); // no such ingredient - the FK will refuse it

  await assert.rejects(() =>
    recordReceipt(owner, {
      lines: [
        { ingredientId: good, quantityMilliBase: 50_000_000n, totalCostPaise: 210_000n },
        { ingredientId: missing, quantityMilliBase: 1_000_000n, totalCostPaise: 1000n },
      ],
    }),
  );

  assert.equal((await movementsOf(good)).length, 0, 'the good line must not survive');
  assert.equal(await stockOf(good), undefined, 'and no cache row may appear');
});

test('a second purchase moves the weighted average, per T2', async (t) => {
  if (!reachable) return t.skip('no database');
  const butter = await makeIngredient('Butter T2');
  await recordReceipt(owner, { lines: [{ ingredientId: butter, quantityMilliBase: 5_000_000n, totalCostPaise: 250_000n }] });
  await recordReceipt(owner, { lines: [{ ingredientId: butter, quantityMilliBase: 3_000_000n, totalCostPaise: 165_000n }] });

  const stock = await stockOf(butter);
  assert.equal(stock.qtyMilliBase, 8_000_000);
  assert.equal(stock.weightedAvgCostMillipaisePerBase, 51_875, 'T2 through the real write path');
});

test('an adjustment changes quantity and leaves the average alone', async (t) => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Sugar');
  await recordReceipt(owner, { lines: [{ ingredientId: ing, quantityMilliBase: 5_000_000n, totalCostPaise: 230_000n }] });
  const before = await stockOf(ing);

  await recordCorrection(owner, 'adjustment', {
    ingredientId: ing,
    quantityMilliBase: -150_000n,
    reason: 'count_correction',
  });

  const after = await stockOf(ing);
  assert.equal(after.qtyMilliBase, before.qtyMilliBase - 150_000);
  assert.equal(after.weightedAvgCostMillipaisePerBase, before.weightedAvgCostMillipaisePerBase);
});

test('wastage is its own movement type carrying its cause', async (t) => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Croissant dough');
  await recordReceipt(owner, { lines: [{ ingredientId: ing, quantityMilliBase: 4_000_000n, totalCostPaise: 120_000n }] });

  await recordCorrection(owner, 'wastage', { ingredientId: ing, quantityMilliBase: -200_000n, reason: 'burnt' });

  const rows = (await movementsOf(ing)).filter((m) => m.movementType === 'wastage');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, 'burnt', 'the cause is separable for reporting');
});

test('the taxonomy is enforced: no adjustment reason on wastage, and vice versa', async (t) => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Yeast');

  await assert.rejects(
    () => recordCorrection(owner, 'wastage', { ingredientId: ing, quantityMilliBase: -1000n, reason: 'theft' }),
    RangeError,
  );
  await assert.rejects(
    () => recordCorrection(owner, 'adjustment', { ingredientId: ing, quantityMilliBase: -1000n, reason: 'burnt' }),
    RangeError,
  );
  await assert.rejects(
    () => recordCorrection(owner, 'wastage', { ingredientId: ing, quantityMilliBase: 1000n, reason: 'spoilage' }),
    RangeError,
    'wastage cannot add stock',
  );
  assert.equal((await movementsOf(ing)).length, 0);
});

test('a note is required when the reason is other', async (t) => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Cocoa');

  await assert.rejects(
    () => recordCorrection(owner, 'adjustment', { ingredientId: ing, quantityMilliBase: -1000n, reason: 'other' }),
    RangeError,
  );
  await assert.rejects(
    () =>
      recordCorrection(owner, 'adjustment', {
        ingredientId: ing,
        quantityMilliBase: -1000n,
        reason: 'other',
        note: '   ',
      }),
    RangeError,
    'whitespace is not a note',
  );
  await assert.doesNotReject(() =>
    recordCorrection(owner, 'adjustment', {
      ingredientId: ing,
      quantityMilliBase: -1000n,
      reason: 'other',
      note: 'spilled during stocktake',
    }),
  );
});

test('every movement operation writes an audit entry', async (t) => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Audited');

  const { referenceId } = await recordReceipt(owner, {
    lines: [{ ingredientId: ing, quantityMilliBase: 1_000_000n, totalCostPaise: 50_000n }],
  });
  const [receiptAudit] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, owner.tenantId), eq(auditLog.entityId, referenceId)));
  assert.equal(receiptAudit.action, 'stock.receipt');
  assert.equal(receiptAudit.userId, owner.id);
  assert.equal((receiptAudit.afterJson as unknown[]).length, 1, 'the lines are recorded');

  const { referenceId: wastageRef } = await recordCorrection(owner, 'wastage', {
    ingredientId: ing,
    quantityMilliBase: -1000n,
    reason: 'dropped',
  });
  const [wastageAudit] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, owner.tenantId), eq(auditLog.entityId, wastageRef)));
  assert.equal(wastageAudit.action, 'stock.wastage');
});

test('the cache still matches a full ledger rebuild after mixed activity', async (t) => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Mixed', 30); // a tray of 30, to exercise a non-1000 factor

  await recordReceipt(owner, { lines: [{ ingredientId: ing, quantityMilliBase: 360_000n, totalCostPaise: 252_000n }] });
  await recordCorrection(owner, 'wastage', { ingredientId: ing, quantityMilliBase: -30_000n, reason: 'dropped' });
  await recordCorrection(owner, 'adjustment', { ingredientId: ing, quantityMilliBase: 15_000n, reason: 'count_correction' });
  await recordReceipt(owner, { lines: [{ ingredientId: ing, quantityMilliBase: 300_000n, totalCostPaise: 225_000n }] });

  const cached = await stockOf(ing);
  const rebuilt = await db.transaction((tx) => recalculateStock(tx, owner.tenantId, ing));
  assert.equal(rebuilt.qtyMilliBase, BigInt(cached.qtyMilliBase));
  assert.equal(rebuilt.weightedAvgCostMillipaisePerBase, cached.weightedAvgCostMillipaisePerBase === null ? null : BigInt(cached.weightedAvgCostMillipaisePerBase));
});

test('kitchen staff cannot record stock movements', async (t) => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Guarded');

  await assert.rejects(
    () => recordReceipt(kitchen, { lines: [{ ingredientId: ing, quantityMilliBase: 1000n, totalCostPaise: 100n }] }),
    AuthzError,
  );
  await assert.rejects(
    () => recordCorrection(kitchen, 'wastage', { ingredientId: ing, quantityMilliBase: -1000n, reason: 'burnt' }),
    AuthzError,
  );
  await assert.rejects(() => listSuppliers(kitchen), AuthzError);
  assert.equal((await movementsOf(ing)).length, 0);
});

/**
 * Migration 0006. Every derived number in the system - stock on hand, the weighted
 * average, every recipe cost above it - is a fold over these rows, and the cache trusts
 * that a row, once written, never changes. Before 0006 only the application enforced
 * that, so a stray UPDATE in a psql session rewrote purchase history and the snapshot
 * watermark never noticed, because it only moves forward past new rows.
 */
test('the ledger refuses to be rewritten, even by the application role', async (t) => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Immutable');
  await recordReceipt(owner, {
    lines: [{ ingredientId: ing, quantityMilliBase: 1_000_000n, totalCostPaise: 50_000n }],
  });
  const [before] = await movementsOf(ing);

  // Drizzle wraps the driver error, so the trigger's message arrives as the cause.
  const refused = (e: unknown) => /append-only/.test(String((e as { cause?: Error })?.cause?.message ?? e));

  await assert.rejects(
    () => db.update(stockMovements).set({ quantityMilliBase: 999 }).where(eq(stockMovements.id, before.id)),
    refused,
  );
  await assert.rejects(
    () => db.delete(stockMovements).where(eq(stockMovements.id, before.id)),
    refused,
  );

  const [after] = await movementsOf(ing);
  assert.equal(after.quantityMilliBase, before.quantityMilliBase, 'the row survived unchanged');
});

test('stock entry refuses a changed measurement even when the purchase pack still contains 1000 base units', async t => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Stale measurement');
  const [row] = await db.select().from(ingredients).where(eq(ingredients.id, ing));
  await updateIngredient(owner, ing, { name: row.name, unitType: 'volume', purchaseUnit: 'L', purchaseUnitInBase: 1000, lowStockThresholdMilliBase: 0 });
  const claim = { entryUnitType: 'weight' as const, entryPurchaseUnitInBase: 1000 };
  const line = { ingredientId: ing, quantityMilliBase: 1000000n, totalCostPaise: 10000n, ...claim };
  await assert.rejects(() => recordReceipt(owner, { lines: [line] }), /measurement or purchase pack/);
  await assert.rejects(() => recordOpeningStock(owner, { lines: [line] }), /measurement or purchase pack/);
  for (const kind of ['adjustment', 'wastage'] as const) await assert.rejects(() => recordCorrection(owner, kind, {
    ingredientId: ing, quantityMilliBase: -1000n, reason: kind === 'wastage' ? 'expiry' : 'count_correction', ...claim,
  }), /measurement or purchase pack/);
  assert.equal((await movementsOf(ing)).length, 0);
  assert.equal(await stockOf(ing), undefined, 'rejected forms must not even create a derived stock row');
});

test('stock entry rechecks the displayed pack after an ingredient edit', async t => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Stale pack');
  const [row] = await db.select().from(ingredients).where(eq(ingredients.id, ing));
  await updateIngredient(owner, ing, { name: row.name, unitType: 'weight', purchaseUnit: 'bag', purchaseUnitInBase: 2000, lowStockThresholdMilliBase: 0 });
  const line = { ingredientId: ing, quantityMilliBase: 1000000n, totalCostPaise: 10000n, entryUnitType: 'weight' as const, entryPurchaseUnitInBase: 1000 };
  await assert.rejects(() => recordReceipt(owner, { lines: [line] }), /measurement or purchase pack/);
  await recordReceipt(owner, { lines: [{ ...line, quantityMilliBase: 2000000n, entryPurchaseUnitInBase: 2000 }] });
  assert.equal((await stockOf(ing)).qtyMilliBase, 2000000);
});

test('a receipt waiting behind an ingredient edit validates units after acquiring the stock lock', async t => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Concurrent measurement');
  let pending!: Promise<{ error: unknown }>;
  let settled = false;
  await db.transaction(async tx => {
    await lockIngredients(tx, owner.tenantId, [ing]);
    pending = recordReceipt(owner, { lines: [{ ingredientId: ing, quantityMilliBase: 1000000n, totalCostPaise: 10000n,
      entryUnitType: 'weight', entryPurchaseUnitInBase: 1000 }] }).then(
      () => ({ error: null }), error => ({ error }),
    ).finally(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 70));
    assert.equal(settled, false, 'receipt must wait for the ingredient edit lock');
    await tx.update(ingredients).set({ unitType: 'volume', purchaseUnit: 'L' }).where(and(eq(ingredients.tenantId, owner.tenantId), eq(ingredients.id, ing)));
  });
  assert.match(String((await pending).error), /measurement or purchase pack/);
  assert.equal((await movementsOf(ing)).length, 0);
});

test('manual corrections reject quantities beyond the exact stored-number range without rounding them', async t => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Unsafe correction');
  for (const quantityMilliBase of [9007199254740993n, -9007199254740993n]) {
    await assert.rejects(() => recordCorrection(owner, 'adjustment', { ingredientId: ing, quantityMilliBase, reason: 'count_correction' }), /too large to record exactly/);
  }
  assert.equal((await movementsOf(ing)).length, 0);
});

test('a safe individual entry cannot overflow the cumulative stock cache', async t => {
  if (!reachable) return t.skip('no database');
  const ing = await makeIngredient('Stock ceiling');
  await recordReceipt(owner, { lines: [{ ingredientId: ing, quantityMilliBase: 9007199254740991n, totalCostPaise: 0n }] });
  await assert.rejects(() => recordCorrection(owner, 'adjustment', { ingredientId: ing, quantityMilliBase: 2n, reason: 'count_correction' }), /resulting stock quantity.*too large/);
  assert.equal((await stockOf(ing)).qtyMilliBase, Number.MAX_SAFE_INTEGER);
  assert.equal((await movementsOf(ing)).length, 1, 'the overflow movement rolls back with its cache change');
});
