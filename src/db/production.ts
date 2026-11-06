/**
 * The database shell around src/lib/production.ts. No arithmetic lives here - every number
 * a run records is decided by the pure planner, where paper cases M1-M10 pin it. This file
 * loads, locks, and writes, and the ORDER it does those in is the whole of its job.
 *
 * Design: files/production-tracking-2026-09.md.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, isNull, or, sql as raw } from 'drizzle-orm';
import { db } from './client.ts';
import { recipes, productionRuns, productionReversals, stockMovements, ingredients, menuItems, auditLog } from './schema.ts';
import { loadRecipeGraphForTenant, loadCostLookupForTenant } from './recipes.ts';
import { recordMovements, lockIngredients, recalculateStock, type MovementInput } from './stock.ts';
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
 * The historical shelf association is permanent. Re-enabling future stocking reuses it.
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
        stockOutputEnabled: recipes.stockOutputEnabled,
      })
      .from(recipes)
      .where(and(eq(recipes.tenantId, actor.tenantId), eq(recipes.id, recipeId), isNull(recipes.deletedAt)));
    if (!recipe) throw new RangeError('That recipe no longer exists.');
    const [madeToOrder] = await tx.select({ name: menuItems.name }).from(menuItems).where(and(
      eq(menuItems.tenantId, actor.tenantId), eq(menuItems.recipeId, recipeId), eq(menuItems.isActive, true),
      isNull(menuItems.deletedAt), eq(menuItems.fulfillmentMode, 'made_to_order'),
    )).limit(1);
    if (madeToOrder) throw new RangeError(`"${madeToOrder.name}" is sold made to order. Disable that menu item before enabling prepared stock.`);
    if (recipe.stockIngredientId) {
      if (!recipe.stockOutputEnabled) {
        await tx.update(recipes).set({ stockOutputEnabled: true, updatedAt: new Date() })
          .where(and(eq(recipes.tenantId, actor.tenantId), eq(recipes.id, recipeId)));
        await tx.insert(auditLog).values({ tenantId: actor.tenantId, userId: actor.id,
          action: 'recipe.stock', entityType: 'recipe', entityId: recipeId,
          beforeJson: { stockOutputEnabled: false }, afterJson: { stockOutputEnabled: true, stockIngredientId: recipe.stockIngredientId } });
      }
      return recipe.stockIngredientId;
    }

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
      .set({ stockIngredientId: shelf.id, stockOutputEnabled: true, updatedAt: new Date() })
      .where(and(eq(recipes.tenantId, actor.tenantId), eq(recipes.id, recipeId)));
    await tx.insert(auditLog).values({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'recipe.stock',
      entityType: 'recipe',
      entityId: recipeId,
      beforeJson: { stockIngredientId: null, stockOutputEnabled: false },
      afterJson: { stockIngredientId: shelf.id, stockOutputEnabled: true },
    });
    return shelf.id;
  });
}

/** Disable future shelf output only after every existing quantity and dependency is clear. */
export async function disableRecipeStockOutput(actor: Actor, recipeId: string): Promise<void> {
  assertPermission(actor.role, 'recipes.manage');
  await db.transaction(async tx => {
    await tx.execute(raw`select pg_advisory_xact_lock(hashtextextended(${`recipes:${actor.tenantId}`}, 0))`);
    const [recipe] = await tx.select().from(recipes).where(and(
      eq(recipes.tenantId, actor.tenantId), eq(recipes.id, recipeId), isNull(recipes.deletedAt),
    ));
    if (!recipe) throw new RangeError('That recipe no longer exists.');
    if (!recipe.stockOutputEnabled) return;
    const graph = await loadRecipeGraphForTenant(actor.tenantId, tx);
    const parents = [...graph.values()].filter(parent => parent.lines.some(line =>
      line.subRecipeId === recipeId || (recipe.stockIngredientId !== null && line.ingredientId === recipe.stockIngredientId),
    ));
    if (parents.length) throw new RangeError(
      `"${recipe.name}" is still used by ${parents.map(parent => `"${parent.name}"`).join(', ')}. Remove those recipe references before stopping shelf output.`,
    );
    if (!recipe.stockIngredientId) throw new RangeError('This recipe has no stock shelf.');
    const [stockedMenu] = await tx.select({ id: menuItems.id }).from(menuItems).where(and(
      eq(menuItems.tenantId, actor.tenantId), eq(menuItems.recipeId, recipeId), eq(menuItems.isActive, true),
      isNull(menuItems.deletedAt), eq(menuItems.fulfillmentMode, 'stocked'),
    )).limit(1);
    if (stockedMenu) throw new RangeError('This recipe is sold from stock. Change or deactivate its stocked menu items before stopping shelf output.');
    await lockIngredients(tx, actor.tenantId, [recipe.stockIngredientId]);
    const stock = await recalculateStock(tx, actor.tenantId, recipe.stockIngredientId, { rebuild: true });
    if (stock.qtyMilliBase !== 0n) throw new RangeError(
      `"${recipe.name}" still has stock on its shelf. Use or correctly adjust that stock to zero before stopping shelf output.`,
    );
    await tx.update(recipes).set({ stockOutputEnabled: false, updatedAt: new Date() })
      .where(and(eq(recipes.tenantId, actor.tenantId), eq(recipes.id, recipeId)));
    await tx.insert(auditLog).values({ tenantId: actor.tenantId, userId: actor.id,
      action: 'recipe.unstock', entityType: 'recipe', entityId: recipeId,
      beforeJson: { stockOutputEnabled: true }, afterJson: { stockOutputEnabled: false, stockIngredientId: recipe.stockIngredientId } });
  });
}

export type ProductionReversalInput = { requestId: string; productionRunId: string; reason: string };

/** Latest-only corrections preserve history and restore both quantity and valuation. */
export async function reverseProductionRun(actor: Actor, input: ProductionReversalInput) {
  assertPermission(actor.role, 'production.record');
  const reason = input.reason.trim();
  if (!reason || reason.length > 1000) throw new RangeError('Enter a correction reason between 1 and 1000 characters.');
  return db.transaction(async tx => {
    // Same global ordering as recipe edits, stock-mode changes and new production.
    await tx.execute(raw`select pg_advisory_xact_lock(hashtextextended(${`recipes:${actor.tenantId}`}, 0))`);
    const [request] = await tx.select().from(productionReversals).where(and(
      eq(productionReversals.tenantId, actor.tenantId), eq(productionReversals.id, input.requestId),
    ));
    if (request) {
      if (request.productionRunId !== input.productionRunId || request.reason !== reason) {
        throw new RangeError('This correction form was already used for different details. Refresh and try again.');
      }
      return { reversalId: request.id, productionRunId: request.productionRunId, alreadyReversed: true };
    }
    const [run] = await tx.select().from(productionRuns).where(and(
      eq(productionRuns.tenantId, actor.tenantId), eq(productionRuns.id, input.productionRunId),
    ));
    if (!run) throw new RangeError('That production record no longer exists.');
    const [existing] = await tx.select({ id: productionReversals.id }).from(productionReversals).where(and(
      eq(productionReversals.tenantId, actor.tenantId), eq(productionReversals.productionRunId, run.id),
    ));
    if (existing) throw new RangeError('That batch has already been reversed. Its original record remains in history.');
    const originals = await tx.select().from(stockMovements).where(and(
      eq(stockMovements.tenantId, actor.tenantId), eq(stockMovements.referenceType, 'production'), eq(stockMovements.referenceId, run.id),
    )).orderBy(asc(stockMovements.seq));
    if (!originals.length) throw new RangeError('That batch has no stock movements and cannot be reversed automatically.');
    const cutoffs = new Map<string, number>();
    for (const movement of originals) cutoffs.set(movement.ingredientId, movement.seq);
    await lockIngredients(tx, actor.tenantId, cutoffs.keys());
    const [later] = await tx.select({ ingredientName: ingredients.name }).from(stockMovements)
      .innerJoin(ingredients, and(eq(ingredients.tenantId, stockMovements.tenantId), eq(ingredients.id, stockMovements.ingredientId)))
      .where(and(eq(stockMovements.tenantId, actor.tenantId), or(...[...cutoffs].map(([id, seq]) => and(
        eq(stockMovements.ingredientId, id), gt(stockMovements.seq, seq),
      ))))).orderBy(asc(stockMovements.seq)).limit(1);
    if (later) throw new RangeError(
      `This batch cannot be reversed because later stock activity uses "${later.ingredientName}". Review that activity before correcting the stock.`,
    );
    await tx.insert(productionReversals).values({ id: input.requestId, tenantId: actor.tenantId,
      productionRunId: run.id, reason, createdByUserId: actor.id });
    await recordMovements(originals.map(movement => ({ tenantId: actor.tenantId, ingredientId: movement.ingredientId,
      movementType: 'reversal' as const, quantityMilliBase: storedInteger(-BigInt(movement.quantityMilliBase), 'Reversed quantity'),
      reversesMovementId: movement.id, referenceType: 'production_reversal', referenceId: input.requestId,
      note: reason, createdByUserId: actor.id })), tx);
    await tx.insert(auditLog).values({ tenantId: actor.tenantId, userId: actor.id,
      action: 'production.reverse', entityType: 'production_run', entityId: run.id,
      afterJson: { reversalId: input.requestId, reason, movements: originals.length } });
    return { reversalId: input.requestId, productionRunId: run.id, alreadyReversed: false };
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
    await tx.execute(raw`select pg_advisory_xact_lock(hashtextextended(${`recipes:${actor.tenantId}`}, 0))`);
    if (input.requestId) {
      await tx.execute(raw`select pg_advisory_xact_lock(hashtextextended(${`production-request:${actor.tenantId}:${runId}`}, 0))`);
      const [existing] = await tx.select({ id: productionRuns.id }).from(productionRuns)
        .where(and(eq(productionRuns.tenantId, actor.tenantId), eq(productionRuns.id, runId)));
      if (existing) throw new ProductionAlreadyRecordedError();
    }
    const graph = await loadRecipeGraphForTenant(actor.tenantId, tx);
    if (!graph.has(input.recipeId)) throw new RangeError('That recipe no longer exists.');
    const current = graph.get(input.recipeId)!;
    const [madeWhenOrdered] = await tx.select({ id: menuItems.id }).from(menuItems).where(and(
      eq(menuItems.tenantId, actor.tenantId), eq(menuItems.recipeId, input.recipeId),
      eq(menuItems.isActive, true), isNull(menuItems.deletedAt), eq(menuItems.fulfillmentMode, 'made_to_order'),
    )).limit(1);
    if (madeWhenOrdered) throw new RangeError('This recipe is made when ordered. Record it through Orders instead of deducting its ingredients again in production.');
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
