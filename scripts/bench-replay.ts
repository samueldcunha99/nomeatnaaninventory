/**
 * End-to-end replay cost: 50,000 rows pulled out of Postgres and folded, which is what
 * recalculateStock() actually does on every movement insert.
 *
 * The in-memory fold is ~2 ms at this size (src/lib/stock.bench.test.ts). This measures
 * the part that number deliberately excluded - the fetch.
 *
 *   npm run bench:replay
 *
 * Not part of `npm test`: it writes 50,000 rows and takes a while. It cleans up after
 * itself, but point it at a scratch database if you care about the contents.
 */
import { and, eq } from 'drizzle-orm';
import { db, sql } from '../src/db/client.ts';
import { tenants, users, ingredients, stockMovements, ingredientStock } from '../src/db/schema.ts';
import { recalculateStock } from '../src/db/stock.ts';

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

console.log(`size      fetch+fold (median of 5)   per movement`);

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

  const runs: number[] = [];
  for (let r = 0; r < 5; r++) {
    const t = performance.now();
    await db.transaction((tx) => recalculateStock(tx, tenant.id, ing.id));
    runs.push(performance.now() - t);
  }
  runs.sort((a, b) => a - b);
  const median = runs[2];
  console.log(
    `${String(size).padEnd(9)} ${median.toFixed(0).padStart(6)} ms` +
      `  (min ${runs[0].toFixed(0)}, max ${runs[4].toFixed(0)})`.padEnd(22) +
      ` ${((median * 1000) / size).toFixed(1)} us`,
  );

  await db.delete(ingredientStock).where(and(eq(ingredientStock.tenantId, tenant.id), eq(ingredientStock.ingredientId, ing.id)));
  await db.delete(stockMovements).where(and(eq(stockMovements.tenantId, tenant.id), eq(stockMovements.ingredientId, ing.id)));
  await db.delete(ingredients).where(and(eq(ingredients.tenantId, tenant.id), eq(ingredients.id, ing.id)));
}

await db.delete(users).where(eq(users.tenantId, tenant.id));
await db.delete(tenants).where(eq(tenants.id, tenant.id));
await sql.end();
