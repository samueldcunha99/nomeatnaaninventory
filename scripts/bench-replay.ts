/**
 * End-to-end cost of maintaining the stock cache, at four ledger sizes.
 *
 * Since snapshotting (2026-09-09) there are two paths worth measuring: a full rebuild
 * from the whole ledger, and the incremental fold that a real movement triggers. The
 * first is what the cache is verified against; the second is what happens in a shift.
 *
 * The in-memory fold is ~2 ms at this size (src/lib/stock.bench.test.ts). This measures
 * the part that number deliberately excluded - the fetch.
 *
 *   npm run bench:replay
 *
 * Not part of `npm test`: it writes 50,000 rows and takes a while. It cleans up after
 * itself, but point it at a scratch database if you care about the contents.
 */
import { and, eq, sql as raw } from 'drizzle-orm';
import { db, sql } from '../src/db/client.ts';
import {
  tenants,
  users,
  ingredients,
  stockMovements,
  ingredientStock,
  auditLog,
} from '../src/db/schema.ts';
import { recalculateStock, recordMovements } from '../src/db/stock.ts';

const SIZES = [1_000, 10_000, 50_000, 100_000];
const CHUNK = 2_000;

const [tenant] = await db.insert(tenants).values({ name: `bench ${crypto.randomUUID()}` }).returning();
const [user] = await db
  .insert(users)
  .values({
    tenantId: tenant.id,
    name: 'bench',
    email: `bench-${crypto.randomUUID()}@example.test`,
    passwordHash: 'x',
    role: 'owner',
  })
  .returning();

console.log('size        rebuild      incremental      speedup');

for (const size of SIZES) {
  const [ing] = await db
    .insert(ingredients)
    .values({
      tenantId: tenant.id,
      name: `bench ${size} ${crypto.randomUUID().slice(0, 8)}`,
      unitType: 'weight',
      purchaseUnit: 'kg',
      purchaseUnitInBase: 1000,
    })
    .returning();

  for (let start = 0; start < size; start += CHUNK) {
    const rows = Array.from({ length: Math.min(CHUNK, size - start) }, (_, k) => {
      const i = start + k;
      const isPurchase = i % 5 === 0;
      return {
        tenantId: tenant.id,
        ingredientId: ing.id,
        movementType: (isPurchase ? 'purchase' : 'consumption') as 'purchase' | 'consumption',
        quantityMilliBase: isPurchase ? 5_000_000 : -180_000,
        unitCostMillipaisePerBase: isPurchase ? 45_000 + (i % 97) : null,
        totalCostPaise: isPurchase ? 225_000 : null,
        createdByUserId: user.id,
      };
    });
    await db.insert(stockMovements).values(rows);
  }

  // Two numbers, because there are now two paths and only one of them runs in a shift.
  //
  // REBUILD is the old behaviour: fold the whole ledger from empty. It is what the cache
  // is checked against, and what a repair would cost.
  //
  // INCREMENTAL is what recording a movement actually does now: fold only what arrived
  // since the watermark, which is the one row just written. It is measured by writing a
  // real movement each time, because a recalculation with nothing new to fold would
  // measure an empty query and flatter the result.
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

  const rebuilds: number[] = [];
  for (let r = 0; r < 5; r++) {
    const t = performance.now();
    await db.transaction((tx) => recalculateStock(tx, tenant.id, ing.id, { rebuild: true }));
    rebuilds.push(performance.now() - t);
  }

  const increments: number[] = [];
  for (let r = 0; r < 5; r++) {
    const t = performance.now();
    await recordMovements([
      {
        tenantId: tenant.id,
        ingredientId: ing.id,
        movementType: 'consumption',
        quantityMilliBase: -1_000,
        createdByUserId: user.id,
      },
    ]);
    increments.push(performance.now() - t);
  }

  const cold = median(rebuilds);
  const warm = median(increments);
  console.log(
    `${String(size).padEnd(9)} ${cold.toFixed(0).padStart(8)} ms` +
      `${warm.toFixed(1).padStart(13)} ms` +
      `${(cold / Math.max(warm, 0.01)).toFixed(0).padStart(11)}x`,
  );

  // One transaction so `set local` holds: migration 0006 refuses a ledger delete without it.
  await db.transaction(async (tx) => {
    await tx.execute(raw`set local app.ledger_maintenance = 'on'`);
    await tx.delete(ingredientStock).where(and(eq(ingredientStock.tenantId, tenant.id), eq(ingredientStock.ingredientId, ing.id)));
    await tx.delete(stockMovements).where(and(eq(stockMovements.tenantId, tenant.id), eq(stockMovements.ingredientId, ing.id)));
    await tx.delete(ingredients).where(and(eq(ingredients.tenantId, tenant.id), eq(ingredients.id, ing.id)));
  });
}

// recordMovements writes an audit entry per operation, and those reference the user.
await db.delete(auditLog).where(eq(auditLog.tenantId, tenant.id));
await db.delete(users).where(eq(users.tenantId, tenant.id));
await db.delete(tenants).where(eq(tenants.id, tenant.id));
await sql.end();
