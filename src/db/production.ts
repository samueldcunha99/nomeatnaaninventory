/**
 * The database shell around src/lib/production.ts. No arithmetic lives here - every number
 * a run records is decided by the pure planner, where paper cases M1-M10 pin it. This file
 * loads, locks, and writes, and the ORDER it does those in is the whole of its job.
 *
 * Design: files/production-tracking-2026-09.md.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql as raw } from 'drizzle-orm';
import { db } from './client.ts';
import { recipes, productionRuns, auditLog } from './schema.ts';
import { loadRecipeGraphForTenant, loadCostLookupForTenant } from './recipes.ts';
import { recordMovements, lockIngredients, type MovementInput } from './stock.ts';
import { createIngredient, DuplicateIngredientError } from './ingredients.ts';
import { planDraws, planProductionRun } from '../lib/production.ts';
import { istDayStart, istToday } from '../lib/time.ts';
import { assertPermission, type Actor } from '../lib/auth.ts';
import type { MissingCost } from '../lib/costing.ts';
import type { UnitType } from '../lib/units.ts';
import { assertLineUnitCompatible } from '../lib/costing.ts';

/**
 * The purchase unit a shelf row is created with, from what the recipe yields.
 *
 * Deliberately NOT "one batch". The proposal said 'batch', with the pack size set to the
 * recipe's yield - which would have tied the ingredient row to the recipe's yield forever,
 * needing re-syncing on every edit, and made a 4.2 kg batch a pack of 4200 whole grams
 * that a yield of 4200.5 g cannot even express. A kilogram depends only on the unit type,
 * which is already frozen while the recipe is stocked (saveRecipe refuses to change it).
 *
 * It also keeps every quantity exact on screen: a scale of 1000 x 1000 has only twos and
 * fives in it, so integerToDecimal never meets the one shape it cannot render (its
 * ponytail note, src/lib/units.ts).
 */
const SHELF_UNIT: Record<UnitType, { purchaseUnit: string; purchaseUnitInBase: number }> = {
  weight: { purchaseUnit: 'kg', purchaseUnitInBase: 1000 },
  volume: { purchaseUnit: 'litre', purchaseUnitInBase: 1000 },
  count: { purchaseUnit: 'unit', purchaseUnitInBase: 1 },
};

/**
 * Give a recipe a shelf: create the ingredient row its batches go onto, and link it.
 * Returns that row's id. Idempotent - a recipe already stocked returns its existing row.
 *
 * The row goes through createIngredient, inside this transaction, so it has an audit
 * entry and the same name rules as anything bought; a link to a row that failed to
 * commit, or a row with no link, are both impossible.
 *
 * There is no "unstock" yet, on purpose. Unlinking a recipe whose parents draw on it
 * strands their production, and re-stocking it later must find the same row rather than
 * collide with its name - both need rules nobody has asked for. Add it when someone does.
 */
export async function stockRecipe(actor: Actor, recipeId: string): Promise<string> {
  assertPermission(actor.role, 'recipes.manage');
  return db.transaction(async (tx) => {
    // The per-tenant lock saveRecipe takes. Two people stocking the same recipe at once
    // would otherwise each see it unstocked, and each create a shelf.
    await tx.execute(raw`select pg_advisory_xact_lock(hashtextextended(${`recipes:${actor.tenantId}`}, 0))`);

    const [recipe] = await tx
      .select({
        name: recipes.name,
        yieldUnitType: recipes.yieldUnitType,
        stockIngredientId: recipes.stockIngredientId,
      })
      .from(recipes)
      .where(and(eq(recipes.tenantId, actor.tenantId), eq(recipes.id, recipeId), isNull(recipes.deletedAt)));
    if (!recipe) throw new RangeError('That recipe no longer exists.');
    if (recipe.stockIngredientId) return recipe.stockIngredientId;

    let shelf;
    try {
      shelf = await createIngredient(
        actor,
        {
          name: recipe.name,
          brand: null,
          unitType: recipe.yieldUnitType,
          ...SHELF_UNIT[recipe.yieldUnitType],
          lowStockThresholdMilliBase: 0,
        },
        tx,
      );
    } catch (e) {
      // createIngredient's own message tells the operator to reactivate the existing
      // ingredient, which is the wrong advice here: that ingredient is something else
      // entirely, and the fix is a clearer name for one of them.
      if (e instanceof DuplicateIngredientError) {
        throw new RangeError(
          `An ingredient called "${recipe.name}" already exists, so "${recipe.name}" cannot be ` +
            `given a shelf under that name. Rename the recipe or that ingredient first.`,
        );
      }
      throw e;
    }

    await tx
      .update(recipes)
      .set({ stockIngredientId: shelf.id, updatedAt: new Date() })
      .where(and(eq(recipes.tenantId, actor.tenantId), eq(recipes.id, recipeId)));
    await tx.insert(auditLog).values({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'recipe.stock',
      entityType: 'recipe',
      entityId: recipeId,
      beforeJson: { stockIngredientId: null },
      afterJson: { stockIngredientId: shelf.id },
    });
    return shelf.id;
  });
}

export type ProductionRunInput = {
  /** A form-generated ID prevents retries from consuming stock twice. */
  requestId?: string;
  recipeUpdatedAt?: string;
  yieldUnitType?: UnitType;
  recipeId: string;
  /** The Kolkata working day it was made, `YYYY-MM-DD`. Today or earlier. */
  producedOn: string;
  /** Thousandths of a batch: 1000 is one, 1500 is one and a half. */
  batchesMilli: bigint;
  /** What actually came out, milli-base, in the recipe's yield unit. Zero is a burnt batch. */
  actualYieldMilliBase: bigint;
  note?: string | null;
};

export class ProductionAlreadyRecordedError extends Error {
  constructor() { super('This form has already recorded a batch. Open Daily production again to record another.'); this.name = 'ProductionAlreadyRecordedError'; }
}

function storedInteger(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} is too large to record exactly.`);
  }
  return Number(value);
}

export type ProductionRunResult = {
  runId: string;
  expectedYieldMilliBase: bigint;
  actualYieldMilliBase: bigint;
  /**
   * Null when an input has no price. A screen showing this must check its OWN permission:
   * production.record deliberately does not imply recipes.view.
   */
  batchCostPaise: bigint | null;
  /** Unpriced inputs, named, so the screen can say what to fix. */
  missing: readonly MissingCost[];
  movementCount: number;
};

/**
 * Log a batch: one production_runs row, and its movements through recordMovements, all
 * in ONE transaction. A refusal anywhere - an unstocked sub-recipe, an unpriced input to a
 * stocked batch, a constraint - leaves the ledger exactly as it was.
 *
 * The order is the design:
 *
 *   1. load the recipe graph
 *   2. plan the STRUCTURE - which rows the run draws on - without reading one price
 *   3. LOCK every one of those rows, and the output's shelf
 *   4. only now read prices, through this transaction's connection
 *   5. cost the batch and write it
 *
 * Swap 3 and 4 and a delivery can commit between the price being read and the stock
 * being drawn: the batch is costed at the old price while the ledger records the draw
 * after the new one. Nothing throws and the figure looks fine. The forced-interleaving
 * test in production.db.test.ts fails if this order is ever changed.
 *
 * `now` exists for the future-date check's tests.
 */
export async function recordProductionRun(
  actor: Actor,
  input: ProductionRunInput,
  now: Date = new Date(),
): Promise<ProductionRunResult> {
  assertPermission(actor.role, 'production.record');
  if (!istDayStart(input.producedOn)) {
    throw new RangeError('Enter the day the batch was made, as a real date.');
  }
  // Plain string comparison is chronological for YYYY-MM-DD. Backdating is normal -
  // last night's bake logged this morning - but a day that has not happened is a typo.
  if (input.producedOn > istToday(now)) {
    throw new RangeError('A batch cannot be logged against a day that has not happened yet.');
  }

  const runId = input.requestId ?? randomUUID();
  return db.transaction(async (tx) => {
    if (input.requestId) {
      await tx.execute(raw`select pg_advisory_xact_lock(hashtextextended(${`production-request:${actor.tenantId}:${runId}`}, 0))`);
      const [existing] = await tx.select({ id: productionRuns.id }).from(productionRuns)
        .where(and(eq(productionRuns.tenantId, actor.tenantId), eq(productionRuns.id, runId)));
      if (existing) throw new ProductionAlreadyRecordedError();
    }
    const graph = await loadRecipeGraphForTenant(actor.tenantId, tx);
    if (!graph.has(input.recipeId)) throw new RangeError('That recipe no longer exists.');
    const current = graph.get(input.recipeId)!;
    if (input.yieldUnitType) assertLineUnitCompatible(input.yieldUnitType, current.yieldUnitType, current.name);
    if (input.recipeUpdatedAt && current.updatedAt.toISOString() !== input.recipeUpdatedAt) {
      throw new RangeError('This recipe changed while the form was open. Refresh and review the batch again.');
    }

    // 2 and 3: structure, then locks - before a single price is read.
    const { recipe, draws } = planDraws(input.recipeId, graph, input.batchesMilli);
    await lockIngredients(tx, actor.tenantId, [
      ...draws.map((d) => d.ingredientId),
      ...(recipe.stockIngredientId ? [recipe.stockIngredientId] : []),
    ]);

    // 4 and 5: prices under those locks, then the whole plan, then the writes.
    const lookup = await loadCostLookupForTenant(actor.tenantId, tx);
    const plan = planProductionRun(
      input.recipeId,
      graph,
      lookup,
      input.batchesMilli,
      input.actualYieldMilliBase,
    );

    await tx.insert(productionRuns).values({
      id: runId,
      tenantId: actor.tenantId,
      recipeId: input.recipeId,
      producedOn: input.producedOn,
      batchesMilli: storedInteger(plan.batchesMilli, 'Batch count'),
      expectedYieldMilliBase: storedInteger(plan.expectedYieldMilliBase, 'Expected yield'),
      actualYieldMilliBase: storedInteger(plan.actualYieldMilliBase, 'Measured output'),
      yieldUnitType: plan.yieldUnitType,
      batchCostPaise: plan.batchCostPaise === null ? null : storedInteger(plan.batchCostPaise, 'Batch cost'),
      note: input.note?.trim() || null,
      createdByUserId: actor.id,
    });

    const common = {
      tenantId: actor.tenantId,
      referenceType: 'production',
      referenceId: runId,
      createdByUserId: actor.id,
    };
    const movements: MovementInput[] = [
      // The sign is applied HERE, once, to a magnitude that was rounded while positive.
      // Never round a signed quantity - see issuedMilliBase.
      ...plan.draws.map((d) => ({
        ...common,
        ingredientId: d.ingredientId,
        movementType: 'consumption' as const,
        quantityMilliBase: storedInteger(-d.issuedMilliBase, 'Ingredient usage'),
      })),
      ...(plan.output
        ? [
            {
              ...common,
              ingredientId: plan.output.ingredientId,
              movementType: 'production' as const,
              quantityMilliBase: storedInteger(plan.output.qtyMilliBase, 'Stock output'),
              unitCostMillipaisePerBase: storedInteger(plan.output.unitCostMillipaisePerBase, 'Stock rate'),
              totalCostPaise: storedInteger(plan.output.totalCostPaise, 'Stock cost'),
            },
          ]
        : []),
    ];
    await recordMovements(movements, tx);

    return {
      runId,
      expectedYieldMilliBase: plan.expectedYieldMilliBase,
      actualYieldMilliBase: plan.actualYieldMilliBase,
      batchCostPaise: plan.batchCostPaise,
      missing: plan.missing,
      movementCount: movements.length,
    };
  });
}
