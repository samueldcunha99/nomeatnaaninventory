/**
 * Receipts, adjustments and wastage against a live Postgres.
 *
 * The point of most of these is that the ledger and the cache agree afterwards, and
 * that a bad line leaves nothing behind.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { db } from './client.ts';
import { dbReachable, closeDb } from './test-db.ts';
import { tenants, users, ingredients, suppliers, stockMovements, ingredientStock, auditLog } from './schema.ts';
import { recordReceipt, recordCorrection, listSuppliers } from './movements.ts';
import { recalculateStock } from './stock.ts';
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
  assert.equal(rebuilt.weightedAvgCostMillipaisePerBase, BigInt(cached.weightedAvgCostMillipaisePerBase));
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
