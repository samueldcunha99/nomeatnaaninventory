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
import { and, asc, count, eq, sql as raw } from 'drizzle-orm';
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
  auditLog,
} from './schema.ts';
import { recordMovements, recalculateStock } from './stock.ts';
import { loadCostLookup, saveRecipe } from './recipes.ts';
import { recordReceipt } from './movements.ts';
import { recordProductionRun, stockRecipe } from './production.ts';
import { NotStockedError, UncostedStockError } from '../lib/production.ts';
import { istToday } from '../lib/time.ts';
import { AuthzError, type Actor, type Role } from '../lib/auth.ts';

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

/* ===========================================================================
 * Step 2 - logging a batch, through the real write path.
 *
 * The same café as the paper cases in src/lib/production.test.ts, bought and baked
 * through recordReceipt, saveRecipe, stockRecipe and recordProductionRun. If M1 and M3
 * come out to the same paise here, the database layer added nothing to the arithmetic -
 * which is exactly its job.
 * ======================================================================== */

/** [quantity bought, paise paid] -> 4200, 50000, 4500, 2200, 80000 millipaise per gram. */
const BOUGHT: Record<string, [number, number]> = {
  flour: [10_000_000, 42_000],
  butter: [5_000_000, 250_000],
  sugar: [10_000_000, 45_000],
  salt: [25_000_000, 55_000],
  yeast: [1_000_000, 80_000],
};

/** A fresh dough (unstocked) and rolls, with `priced` of the five inputs bought. */
async function bakery(priced: string[] = Object.keys(BOUGHT)) {
  const tag = crypto.randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  for (const name of Object.keys(BOUGHT)) ids[name] = await makeIngredient(owner, `${name} ${tag}`);
  if (priced.length > 0) {
    await recordReceipt(owner, {
      lines: priced.map((n) => ({
        ingredientId: ids[n],
        quantityMilliBase: BigInt(BOUGHT[n][0]),
        totalCostPaise: BigInt(BOUGHT[n][1]),
      })),
    });
  }
  const w = 'weight' as const;
  const dough = await saveRecipe(owner, {
    name: `Dough ${tag}`,
    yieldUnitType: 'weight',
    yieldQtyMilliBase: 4_200_000n,
    lines: [
      { ingredientId: ids.flour, quantityMilliBase: 2_500_000n, entryUnitType: w },
      { ingredientId: ids.butter, quantityMilliBase: 500_000n, wastageMillipercent: 3000n, entryUnitType: w },
      { ingredientId: ids.sugar, quantityMilliBase: 300_000n, entryUnitType: w },
      { ingredientId: ids.salt, quantityMilliBase: 40_000n, entryUnitType: w },
      { ingredientId: ids.yeast, quantityMilliBase: 15_000n, wastageMillipercent: 2500n, entryUnitType: w },
    ],
  });
  const rolls = await saveRecipe(owner, {
    name: `Rolls ${tag}`,
    yieldUnitType: 'count',
    yieldQtyMilliBase: 12_000n,
    lines: [
      { subRecipeId: dough, quantityMilliBase: 2_160_000n, entryUnitType: w },
      { ingredientId: ids.sugar, quantityMilliBase: 200_000n, wastageMillipercent: 5000n, entryUnitType: w },
      { ingredientId: ids.butter, quantityMilliBase: 100_000n, entryUnitType: w },
    ],
  });
  return { ids, dough, rolls, tag };
}

async function stockOf(ingredientId: string) {
  const [row] = await db
    .select()
    .from(ingredientStock)
    .where(and(eq(ingredientStock.tenantId, owner.tenantId), eq(ingredientStock.ingredientId, ingredientId)));
  return row ? { qty: BigInt(row.qtyMilliBase), avg: BigInt(row.weightedAvgCostMillipaisePerBase) } : null;
}

async function movementsOfRun(runId: string) {
  return db
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.tenantId, owner.tenantId), eq(stockMovements.referenceId, runId)))
    .orderBy(asc(stockMovements.seq));
}

/** Everything a run could write, counted - to prove a refused one wrote none of it. */
async function footprint() {
  const [[runs], [moves]] = await Promise.all([
    db.select({ n: count() }).from(productionRuns).where(eq(productionRuns.tenantId, owner.tenantId)),
    db.select({ n: count() }).from(stockMovements).where(eq(stockMovements.tenantId, owner.tenantId)),
  ]);
  return { runs: Number(runs.n), moves: Number(moves.n) };
}

const oneBatch = (recipeId: string, actualYieldMilliBase: bigint, producedOn = istToday()) => ({
  recipeId,
  producedOn,
  batchesMilli: 1000n,
  actualYieldMilliBase,
});

test('stocking a recipe gives it a shelf in kilograms, once, with an audit entry', async (t) => {
  if (!reachable) return t.skip('no database');
  const { dough, tag } = await bakery([]);
  const shelf = await stockRecipe(owner, dough);

  const [row] = await db.select().from(ingredients).where(eq(ingredients.id, shelf));
  assert.equal(row.name, `Dough ${tag}`);
  assert.equal(row.unitType, 'weight');
  // Kilograms, not "one batch": tied only to the unit type, never to the yield.
  assert.equal(row.purchaseUnit, 'kg');
  assert.equal(row.purchaseUnitInBase, 1000);

  const [linked] = await db.select().from(recipes).where(eq(recipes.id, dough));
  assert.equal(linked.stockIngredientId, shelf);

  // Idempotent: a second call finds the same shelf rather than colliding with its name.
  assert.equal(await stockRecipe(owner, dough), shelf);

  const audits = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, owner.tenantId), eq(auditLog.entityId, dough), eq(auditLog.action, 'recipe.stock')));
  assert.equal(audits.length, 1, 'stocked once, audited once');
});

test('a recipe whose name an ingredient already has gets a clear refusal, and no link', async (t) => {
  if (!reachable) return t.skip('no database');
  const { dough, tag } = await bakery([]);
  await makeIngredient(owner, `Dough ${tag}`); // something bought, already called that
  await assert.rejects(() => stockRecipe(owner, dough), /Rename the recipe or that ingredient/);
  const [row] = await db.select().from(recipes).where(eq(recipes.id, dough));
  assert.equal(row.stockIngredientId, null, 'a failed stocking leaves nothing half-linked');
});

test('M1 at the database: a dough batch draws its inputs and shelves 4.1 kg at 9492', async (t) => {
  if (!reachable) return t.skip('no database');
  const { ids, dough } = await bakery();
  const shelf = await stockRecipe(owner, dough);

  const result = await recordProductionRun(owner, oneBatch(dough, 4_100_000n));
  assert.equal(result.batchCostPaise, 38_918n, 'M1, to the paise');
  assert.equal(result.expectedYieldMilliBase, 4_200_000n);
  assert.equal(result.movementCount, 6);

  // Every draw is the EXACT negative of the magnitude M1 computed; one shelving.
  const moves = await movementsOfRun(result.runId);
  const byIngredient = new Map(moves.map((m) => [m.ingredientId, m]));
  const drawn: Array<[string, number]> = [
    [ids.flour, -2_500_000],
    [ids.butter, -515_000],
    [ids.sugar, -300_000],
    [ids.salt, -40_000],
    [ids.yeast, -15_375],
  ];
  for (const [id, qty] of drawn) {
    assert.equal(byIngredient.get(id)?.movementType, 'consumption');
    assert.equal(Number(byIngredient.get(id)?.quantityMilliBase), qty);
  }
  const shelved = byIngredient.get(shelf)!;
  assert.equal(shelved.movementType, 'production');
  // The one ordering in a run that changes a number: the shelving folds AFTER every
  // draw. Were a recipe ever to draw on its own shelf (a starter fed from itself), a
  // shelving folded first would blend the new batch into the average and then draw it
  // straight back out at the blended price.
  assert.equal(moves[moves.length - 1].id, shelved.id, 'shelved last, in ledger order');
  assert.equal(Number(shelved.quantityMilliBase), 4_100_000);
  assert.equal(Number(shelved.unitCostMillipaisePerBase), 9_492);
  assert.equal(Number(shelved.totalCostPaise), 38_918);

  // The store moved accordingly - and the dough on the shelf is still derivable from the
  // ledger alone, which is the invariant snapshotting rests on.
  assert.deepEqual(await stockOf(ids.flour), { qty: 7_500_000n, avg: 4_200n });
  assert.deepEqual(await stockOf(shelf), { qty: 4_100_000n, avg: 9_492n });
  const rebuilt = await db.transaction((tx) => recalculateStock(tx, owner.tenantId, shelf, { rebuild: true }));
  assert.deepEqual(rebuilt, { qtyMilliBase: 4_100_000n, weightedAvgCostMillipaisePerBase: 9_492n });

  // The run row holds its snapshots...
  const [run] = await db.select().from(productionRuns).where(eq(productionRuns.id, result.runId));
  assert.equal(run.producedOn, istToday());
  assert.equal(Number(run.batchesMilli), 1000);
  assert.equal(Number(run.expectedYieldMilliBase), 4_200_000);
  assert.equal(Number(run.actualYieldMilliBase), 4_100_000);
  assert.equal(Number(run.batchCostPaise), 38_918);

  // ...and the run is ONE audited operation, not six.
  const audits = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, owner.tenantId), eq(auditLog.entityId, result.runId)));
  assert.deepEqual(audits.map((a) => a.action), ['stock.production']);
});

test('M3 at the database: rolls draw 2.16 kg of dough off the shelf, and no flour', async (t) => {
  if (!reachable) return t.skip('no database');
  const { ids, dough, rolls } = await bakery();
  const shelf = await stockRecipe(owner, dough);
  await recordProductionRun(owner, oneBatch(dough, 4_100_000n));

  // Backdated on purpose: last week's bake logged today is normal.
  const result = await recordProductionRun(owner, oneBatch(rolls, 11_000n, '2026-09-20'));
  assert.equal(result.batchCostPaise, 26_448n, 'M3, to the paise');

  // Compared as a SET. Recipes carry no stored line order - lines saved together tie on
  // created_at and fall back to their random ids (see loadRecipeGraphForTenant) - so the
  // draws' seq order is stable but meaningless. This assertion first compared them in
  // the order they were typed and passed by luck, one run in six. No number depends on
  // the order: each draw is rounded on its own and the batch cost is a sum. The one
  // ordering that does matter - every draw BEFORE the shelving - is fixed in
  // recordProductionRun, and M1 above is where a shelving happens.
  const moves = await movementsOfRun(result.runId);
  const bySource = (a: unknown[], b: unknown[]) => String(a[0]).localeCompare(String(b[0]));
  assert.deepEqual(
    moves.map((m) => [m.ingredientId, m.movementType, Number(m.quantityMilliBase)]).sort(bySource),
    [
      [shelf, 'consumption', -2_160_000],
      [ids.sugar, 'consumption', -210_000],
      [ids.butter, 'consumption', -100_000],
    ].sort(bySource),
    'rolls are made to order: three draws and nothing shelved',
  );
  assert.deepEqual(await stockOf(shelf), { qty: 1_940_000n, avg: 9_492n });
  // Flour was paid for once, when the dough was made. The rolls must not touch it.
  assert.deepEqual(await stockOf(ids.flour), { qty: 7_500_000n, avg: 4_200n });
});

test('a refused run writes nothing at all', async (t) => {
  if (!reachable) return t.skip('no database');
  const { dough, rolls } = await bakery(); // dough deliberately NOT stocked
  const before = await footprint();

  await assert.rejects(() => recordProductionRun(owner, oneBatch(rolls, 12_000n)), NotStockedError); // M7
  await assert.rejects(() => recordProductionRun(owner, oneBatch(dough, 4_200_000n)), NotStockedError); // M8

  assert.deepEqual(await footprint(), before, 'no run row, no movement, nothing half-recorded');
});

test('M5 at the database: an unpriced input to a made-to-order batch records at no known cost', async (t) => {
  if (!reachable) return t.skip('no database');
  const { ids, tag } = await bakery(['flour', 'sugar', 'salt', 'yeast']); // butter never bought
  const glaze = await saveRecipe(owner, {
    name: `Glaze ${tag}`,
    yieldUnitType: 'weight',
    yieldQtyMilliBase: 150_000n,
    lines: [
      { ingredientId: ids.sugar, quantityMilliBase: 100_000n, entryUnitType: 'weight' },
      { ingredientId: ids.butter, quantityMilliBase: 50_000n, entryUnitType: 'weight' },
    ],
  });

  const result = await recordProductionRun(owner, oneBatch(glaze, 150_000n));
  assert.equal(result.batchCostPaise, null);
  assert.deepEqual(result.missing.map((m) => m.ingredientId), [ids.butter]);
  assert.equal((await movementsOfRun(result.runId)).length, 2, 'the stock still moved');
  const [run] = await db.select().from(productionRuns).where(eq(productionRuns.id, result.runId));
  assert.equal(run.batchCostPaise, null, 'null in the database too - never a zero');
});

test('M6 at the database: a stocked batch with an unpriced input is refused, and writes nothing', async (t) => {
  if (!reachable) return t.skip('no database');
  const { dough } = await bakery(['flour', 'butter', 'sugar', 'salt']); // yeast never bought
  await stockRecipe(owner, dough);
  const before = await footprint();
  await assert.rejects(() => recordProductionRun(owner, oneBatch(dough, 4_100_000n)), UncostedStockError);
  assert.deepEqual(await footprint(), before);
});

test('M4 at the database: a burnt batch draws its inputs and shelves nothing', async (t) => {
  if (!reachable) return t.skip('no database');
  const { dough } = await bakery();
  const shelf = await stockRecipe(owner, dough);

  const result = await recordProductionRun(owner, oneBatch(dough, 0n));
  const moves = await movementsOfRun(result.runId);
  assert.equal(moves.length, 5);
  assert.ok(moves.every((m) => m.movementType === 'consumption'));
  assert.equal(await stockOf(shelf), null, 'nothing reached the shelf');

  const [run] = await db.select().from(productionRuns).where(eq(productionRuns.id, result.runId));
  assert.equal(Number(run.actualYieldMilliBase), 0);
  assert.equal(Number(run.batchCostPaise), 38_918, 'the whole loss is on record');
});

test('a batch cannot be logged for tomorrow, or for a day that does not exist', async (t) => {
  if (!reachable) return t.skip('no database');
  const { dough } = await bakery();
  await stockRecipe(owner, dough);
  const middayOn26th = new Date('2026-09-26T06:30:00Z'); // 12:00 in Kolkata

  await assert.rejects(
    () => recordProductionRun(owner, oneBatch(dough, 4_100_000n, '2026-09-27'), middayOn26th),
    /has not happened yet/,
  );
  await assert.rejects(
    () => recordProductionRun(owner, oneBatch(dough, 4_100_000n, '2026-02-30'), middayOn26th),
    /real date/,
  );
  // The same moment, logging its own Kolkata day, is fine.
  await recordProductionRun(owner, oneBatch(dough, 4_100_000n, '2026-09-26'), middayOn26th);
});

test('counter and kitchen may not log a batch, and counter may not stock a recipe', async (t) => {
  if (!reachable) return t.skip('no database');
  const { dough } = await bakery();
  const counter = await makeActor('counter', owner.tenantId);
  const kitchen = await makeActor('kitchen', owner.tenantId);

  await assert.rejects(() => stockRecipe(counter, dough), AuthzError);
  await stockRecipe(owner, dough);
  await assert.rejects(() => recordProductionRun(counter, oneBatch(dough, 4_100_000n)), AuthzError);
  // Kitchen is refused TODAY. Step 4 grants it, with a screen to use it from.
  await assert.rejects(() => recordProductionRun(kitchen, oneBatch(dough, 4_100_000n)), AuthzError);
});

test('a stocked recipe cannot change what it yields', async (t) => {
  if (!reachable) return t.skip('no database');
  const { ids, dough, tag } = await bakery([]);
  await stockRecipe(owner, dough);
  await assert.rejects(
    () =>
      saveRecipe(owner, {
        id: dough,
        name: `Dough ${tag}`,
        yieldUnitType: 'volume', // 4.2 kg on the shelf would silently become 4.2 litres
        yieldQtyMilliBase: 4_200_000n,
        lines: [{ ingredientId: ids.flour, quantityMilliBase: 2_500_000n, entryUnitType: 'weight' }],
      }),
    /held in stock/,
  );
});

test('a batch is priced under its locks, so a delivery landing mid-run cannot put it out of ledger order', async (t) => {
  if (!reachable) return t.skip('no database');
  const { ids, dough } = await bakery();
  await stockRecipe(owner, dough);

  /*
   * The failure this pins: the run reads butter's price, a delivery of dearer butter
   * commits, and only THEN does the run take its lock and draw. The ledger records the
   * draw after the delivery; the batch is costed as though it came before. Nothing throws
   * and the figure looks entirely reasonable.
   *
   * Forced, not hoped for - the same shape as the concurrent-receipts test in
   * stock.db.test.ts. The delivery is held open with its lock on butter; the run is
   * started and given time to reach its price read; then the delivery commits.
   */
  let deliveryWritten!: () => void;
  let releaseDelivery!: () => void;
  const written = new Promise<void>((resolve) => (deliveryWritten = resolve));
  const held = new Promise<void>((resolve) => (releaseDelivery = resolve));

  const delivery = db.transaction(async (tx) => {
    await recordMovements(
      [
        {
          tenantId: owner.tenantId,
          ingredientId: ids.butter,
          movementType: 'purchase',
          quantityMilliBase: 5_000_000,
          unitCostMillipaisePerBase: 60_000, // dearer butter: Rs 600/kg
          totalCostPaise: 300_000,
          createdByUserId: owner.id,
        },
      ],
      tx,
    );
    deliveryWritten();
    await held;
  });

  await written;
  const run = recordProductionRun(owner, oneBatch(dough, 4_100_000n));
  await new Promise((resolve) => setTimeout(resolve, 300));
  releaseDelivery();
  const [result] = await Promise.all([run, delivery]);

  // Butter is now (5 kg x 50000 + 5 kg x 60000) / 10 kg = 55000. The run's 515 g of it:
  //   M1's 38918 - 515 g x 50 paise + 515 g x 55 paise = 38918 - 25750 + 28325 = 41493
  // Priced before the lock, it would say 38918 while the ledger put the draw after the
  // delivery that changed the price.
  assert.equal(result.batchCostPaise, 41_493n);

  const butterLedger = await db
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.tenantId, owner.tenantId), eq(stockMovements.ingredientId, ids.butter)))
    .orderBy(asc(stockMovements.seq));
  assert.deepEqual(
    butterLedger.map((m) => m.movementType),
    ['purchase', 'purchase', 'consumption'],
    'the draw is after the dearer delivery - which is the price it was charged',
  );
});
