/**
 * Migration 0007 against a live Postgres: what the database must accept and refuse now
 * that the kitchen can make things and hold them in the store.
 *
 * Nothing here writes a production run through application code yet - that is step 2.
 * These are the guarantees the schema makes on its own, so that step 2 is built on top
 * of constraints already proven rather than on comments.
 *
 * Every refusal is matched on the CONSTRAINT NAME, never a bare error code (AGENTS.md
 * § Translating driver errors): a check that fails for the wrong reason must fail this
 * test, not pass it.
 *
 * Skips loudly without a reachable DATABASE_URL.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, sql as raw } from 'drizzle-orm';
import { db } from './client.ts';
import { dbReachable, closeDb } from './test-db.ts';
import {
  tenants,
  users,
  ingredients,
  recipes,
  stockMovements,
  ingredientStock,
  productionRuns,
} from './schema.ts';
import { recordMovements, recalculateStock } from './stock.ts';
import { loadCostLookup } from './recipes.ts';
import type { Actor, Role } from '../lib/auth.ts';

let reachable = false;
let owner: Actor;
let other: Actor;

async function makeActor(role: Role, tenantId: string): Promise<Actor> {
  const [u] = await db
    .insert(users)
    .values({
      tenantId,
      name: role,
      email: `${role}-${crypto.randomUUID()}@example.test`,
      passwordHash: 'x',
      role,
    })
    .returning();
  return { id: u.id, tenantId: u.tenantId, role };
}

before(async () => {
  reachable = await dbReachable('database production tests');
  if (!reachable) return;
  const [a] = await db.insert(tenants).values({ name: `prod test ${crypto.randomUUID()}` }).returning();
  const [b] = await db.insert(tenants).values({ name: `prod test ${crypto.randomUUID()}` }).returning();
  owner = await makeActor('owner', a.id);
  other = await makeActor('owner', b.id);
});

after(closeDb);

async function makeIngredient(actor: Actor, name = `Ing ${crypto.randomUUID().slice(0, 8)}`) {
  const [row] = await db
    .insert(ingredients)
    .values({
      tenantId: actor.tenantId,
      name,
      unitType: 'weight',
      purchaseUnit: 'batch',
      purchaseUnitInBase: 4200,
    })
    .returning();
  return row.id;
}

async function makeRecipe(actor: Actor, stockIngredientId: string | null = null) {
  const [row] = await db
    .insert(recipes)
    .values({
      tenantId: actor.tenantId,
      name: `Dough ${crypto.randomUUID().slice(0, 8)}`,
      yieldUnitType: 'weight',
      yieldQtyMilliBase: 4_200_000,
      stockIngredientId,
    })
    .returning();
  return row.id;
}

/** A costed batch arriving in the store, shaped the way step 2 will write it. */
const batch = (ingredientId: string, qtyMilliBase: number, rate: number, totalPaise: number) => ({
  tenantId: owner.tenantId,
  ingredientId,
  movementType: 'production' as const,
  quantityMilliBase: qtyMilliBase,
  unitCostMillipaisePerBase: rate,
  totalCostPaise: totalPaise,
  createdByUserId: owner.id,
});

/** Drizzle wraps the driver error, so the database's own message arrives as the cause. */
const violates = (name: string) => (e: unknown) => {
  const message = String((e as { cause?: Error })?.cause?.message ?? e);
  assert.match(message, new RegExp(name), `expected ${name}, got: ${message}`);
  return true;
};

/* ---------------------------------------------------------------------------
 * The ledger learns a new kind of inflow
 * ------------------------------------------------------------------------- */

test('a batch arrives costed and folds into the store exactly as a delivery would', async (t) => {
  if (!reachable) return t.skip('no database');
  // T13 and T14 from src/lib/stock.test.ts, end to end through the real write path.
  const dough = await makeIngredient(owner);
  await recordMovements([batch(dough, 4_200_000, 13_853, 58_183)]);
  await recordMovements([batch(dough, 3_800_000, 15_000, 57_000)]);

  const [cached] = await db
    .select()
    .from(ingredientStock)
    .where(and(eq(ingredientStock.tenantId, owner.tenantId), eq(ingredientStock.ingredientId, dough)));
  assert.equal(Number(cached.qtyMilliBase), 8_000_000);
  assert.equal(Number(cached.weightedAvgCostMillipaisePerBase), 14_398, 'T14 at the database');

  // And the cache is still derivable from the ledger - the invariant snapshotting rests on.
  const rebuilt = await db.transaction((tx) => recalculateStock(tx, owner.tenantId, dough, { rebuild: true }));
  assert.equal(rebuilt.qtyMilliBase, 8_000_000n);
  assert.equal(rebuilt.weightedAvgCostMillipaisePerBase, 14_398n);
});

test('a batch with no cost is refused by the database, not just the fold', async (t) => {
  if (!reachable) return t.skip('no database');
  const dough = await makeIngredient(owner);
  await assert.rejects(
    () =>
      db.insert(stockMovements).values({
        tenantId: owner.tenantId,
        ingredientId: dough,
        movementType: 'production',
        quantityMilliBase: 4_200_000,
        createdByUserId: owner.id,
      }),
    violates('stock_movements_cost_on_valued_inflow'),
  );
});

test('a batch cannot arrive in a negative quantity', async (t) => {
  if (!reachable) return t.skip('no database');
  const dough = await makeIngredient(owner);
  await assert.rejects(
    () => db.insert(stockMovements).values(batch(dough, -4_200_000, 13_853, 58_183)),
    violates('stock_movements_inflow_qty_positive'),
  );
});

test('consumption still may not carry a cost under the renamed check', async (t) => {
  if (!reachable) return t.skip('no database');
  // The check was widened to admit production. This is the regression that widening it
  // did not ALSO admit a costed outflow, which would put a value on stock leaving.
  const dough = await makeIngredient(owner);
  await assert.rejects(
    () =>
      db.insert(stockMovements).values({
        ...batch(dough, -2_160_000, 13_853, 29_922),
        movementType: 'consumption',
      }),
    violates('stock_movements_cost_on_valued_inflow'),
  );
});

test('an ingredient whose only inflow was a batch HAS a cost basis', async (t) => {
  if (!reachable) return t.skip('no database');
  // The one without which none of this is usable: dough that was made and never bought
  // would otherwise have stock and a weighted average and still raise MissingCostError
  // in every recipe that draws on it.
  const dough = await makeIngredient(owner);
  await recordMovements([batch(dough, 4_200_000, 13_853, 58_183)]);
  const lookup = await loadCostLookup(owner);
  assert.equal(lookup(dough), 13_853n);
});

/* ---------------------------------------------------------------------------
 * recipes.stock_ingredient_id
 * ------------------------------------------------------------------------- */

test('a recipe may hold its output in its own ingredient but never another tenant\'s', async (t) => {
  if (!reachable) return t.skip('no database');
  const mine = await makeIngredient(owner);
  const theirs = await makeIngredient(other);
  const recipe = await makeRecipe(owner, mine);
  assert.ok(recipe, 'own tenant accepted');

  await assert.rejects(
    () => makeRecipe(owner, theirs),
    violates('recipes_tenant_stock_ingredient_fk'),
  );
});

test('two live recipes cannot pour into one stock row', async (t) => {
  if (!reachable) return t.skip('no database');
  // Two products in one quantity and one weighted average could never be separated.
  const shared = await makeIngredient(owner);
  await makeRecipe(owner, shared);
  await assert.rejects(() => makeRecipe(owner, shared), violates('recipes_tenant_stock_ingredient_uq'));
});

test('a made-to-order recipe holds nothing, and any number of them may exist', async (t) => {
  if (!reachable) return t.skip('no database');
  // The unique index is partial on purpose; null must not count as a shared value.
  await makeRecipe(owner, null);
  await makeRecipe(owner, null);
});

/* ---------------------------------------------------------------------------
 * production_runs
 * ------------------------------------------------------------------------- */

const run = (recipeId: string, over: Partial<typeof productionRuns.$inferInsert> = {}) => ({
  tenantId: owner.tenantId,
  recipeId,
  producedOn: '2026-09-26',
  batchesMilli: 1000,
  expectedYieldMilliBase: 4_200_000,
  actualYieldMilliBase: 3_800_000,
  yieldUnitType: 'weight' as const,
  batchCostPaise: 58_183,
  createdByUserId: owner.id,
  ...over,
});

test('a burnt batch is recorded at zero; nonsense is refused by name', async (t) => {
  if (!reachable) return t.skip('no database');
  const recipe = await makeRecipe(owner);

  // Zero actual yield is the batch the owner most needs to see. It must go in.
  const [burnt] = await db.insert(productionRuns).values(run(recipe, { actualYieldMilliBase: 0 })).returning();
  assert.equal(Number(burnt.actualYieldMilliBase), 0);

  // Unknown cost is null, and null is accepted - the event is real even when its value is not.
  await db.insert(productionRuns).values(run(recipe, { batchCostPaise: null }));

  const cases: Array<[Partial<typeof productionRuns.$inferInsert>, string]> = [
    [{ batchesMilli: 0 }, 'production_runs_batches_positive'],
    [{ expectedYieldMilliBase: 0 }, 'production_runs_expected_positive'],
    [{ actualYieldMilliBase: -1 }, 'production_runs_actual_nonneg'],
    [{ batchCostPaise: -1 }, 'production_runs_cost_nonneg'],
  ];
  for (const [over, constraint] of cases) {
    await assert.rejects(() => db.insert(productionRuns).values(run(recipe, over)), violates(constraint));
  }
});

test('a run cannot name another tenant\'s recipe', async (t) => {
  if (!reachable) return t.skip('no database');
  const theirs = await makeRecipe(other);
  await assert.rejects(
    () => db.insert(productionRuns).values(run(theirs)),
    violates('production_runs_tenant_recipe_fk'),
  );
});

test('the day a batch was made comes back as that day, whatever the server clock says', async (t) => {
  if (!reachable) return t.skip('no database');
  // A `date` read through a JavaScript Date is shifted by the process timezone and can
  // land on the previous day. Stored and read as a string, it cannot move.
  const recipe = await makeRecipe(owner);
  const [row] = await db.insert(productionRuns).values(run(recipe, { producedOn: '2026-01-01' })).returning();
  assert.equal(row.producedOn, '2026-01-01');
  assert.equal(typeof row.producedOn, 'string');
});

test('a run refuses to be rewritten, and the maintenance hatch still lets a tenant go', async (t) => {
  if (!reachable) return t.skip('no database');
  const recipe = await makeRecipe(owner);
  const [row] = await db.insert(productionRuns).values(run(recipe)).returning();
  const refused = violates('production_runs is append-only');

  await assert.rejects(
    () => db.update(productionRuns).set({ actualYieldMilliBase: 4_200_000 }).where(eq(productionRuns.id, row.id)),
    refused,
  );
  await assert.rejects(() => db.delete(productionRuns).where(eq(productionRuns.id, row.id)), refused);

  // scripts/clean-test-data.ts depends on exactly this. Without it, every test tenant
  // that ever logged a batch becomes undeletable.
  await db.transaction(async (tx) => {
    await tx.execute(raw`set local app.ledger_maintenance = 'on'`);
    await tx.delete(productionRuns).where(eq(productionRuns.id, row.id));
  });
  const left = await db.select().from(productionRuns).where(eq(productionRuns.id, row.id));
  assert.equal(left.length, 0);
});
