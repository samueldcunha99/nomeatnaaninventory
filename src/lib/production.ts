/**
 * Production runs. Pure arithmetic over a recipe graph - no database, no I/O - exactly as
 * src/lib/costing.ts is. src/db/production.ts loads, locks and writes; everything that
 * decides a NUMBER lives here, where M1-M9 in production.test.ts can pin it.
 *
 * A run is one batch (or a fraction of one, or several) of one recipe. It draws each input
 * out of the store and, if the recipe is stocked, puts what came out back in:
 *
 *   ingredient line   ->  draws that ingredient
 *   sub-recipe line   ->  draws that sub-recipe's STOCK ROW - dough out of the fridge,
 *                         never re-expanded into the flour already paid for when the
 *                         dough was made
 *   the recipe itself ->  if stocked, its actual yield goes onto its own stock row,
 *                         valued at what the draws cost
 *
 * Design, and the alternatives rejected: files/production-tracking-2026-09.md.
 *
 * TWO ROUNDINGS, each once, each at the end of its own chain:
 *
 *   quantity   q x batches x (K + w) / (1000 x K), half-up, on the POSITIVE amount
 *              issued. The ledger gets its exact negative. This is the sign-safe quantity
 *              rounder AGENTS.md deferred to "when Month 3 writes consumption movements".
 *   money      sum of (issued x rate) over the whole batch, divided by 1,000,000 once.
 *
 * Costing never materialises a wastage-adjusted quantity, so it never needed the first.
 * Production has to: a consumption movement is a real quantity leaving a real shelf.
 */
import { divRoundHalfUp, unitCostMillipaisePerBase, type UnitType } from './units.ts';
import {
  MILLI,
  WASTAGE_SCALE,
  MissingCostError,
  MissingSubRecipeError,
  type CostLookup,
  type MissingCost,
  type Recipe,
} from './costing.ts';

/**
 * How much of one line a run takes out of the store - a MAGNITUDE, always positive.
 *
 * One exact numerator, one division, one half-up rounding. Rounding after the batch
 * count and again after the wastage would round twice and can disagree by a whole
 * milli-unit (M9). Everything here is positive, so divRoundHalfUp - which refuses a
 * negative outright - is the only rounding function needed, and there is no half-up
 * versus half-away-from-zero question to get wrong: the sign is applied by the caller,
 * after, when the movement is written.
 */
export function issuedMilliBase(
  quantityMilliBase: bigint,
  wastageMillipercent: bigint,
  batchesMilli: bigint,
): bigint {
  if (quantityMilliBase <= 0n) throw new RangeError('a recipe line issues a positive quantity');
  if (batchesMilli <= 0n) throw new RangeError('a run makes a positive number of batches');
  if (wastageMillipercent < 0n) throw new RangeError('wastage cannot be negative');
  return divRoundHalfUp(
    quantityMilliBase * batchesMilli * (WASTAGE_SCALE + wastageMillipercent),
    MILLI * WASTAGE_SCALE,
  );
}

/** One input leaving the store. */
export type Draw = {
  /** The stock row it leaves: an ingredient, or a stocked sub-recipe's own row. */
  ingredientId: string;
  /** Positive. The consumption movement written for it is exactly its negative. */
  issuedMilliBase: bigint;
  source: { kind: 'ingredient' } | { kind: 'sub-recipe'; recipeId: string; name: string };
};

export type ProductionPlan = {
  recipeId: string;
  name: string;
  yieldUnitType: UnitType;
  batchesMilli: bigint;
  /** The recipe's yield times the batches. A snapshot: the recipe may change later. */
  expectedYieldMilliBase: bigint;
  actualYieldMilliBase: bigint;
  draws: Draw[];
  /**
   * What the draws cost, in whole paise, at each input's current weighted average.
   * NULL when any input has no cost basis - never zero (AGENTS.md § Missing cost data is
   * an error, never zero). Materials only: labour and kitchen time are the costing
   * engine's to price, not the store's to hold.
   */
  batchCostPaise: bigint | null;
  /** Every unpriced input, named once each, in line order. Empty when fully costed. */
  missing: MissingCost[];
  /**
   * The production movement putting the batch on a shelf. Null when the recipe is made
   * to order (nothing to shelve) or when the batch came out at zero (nothing to value,
   * and nothing to divide by - M4).
   */
  output: {
    ingredientId: string;
    qtyMilliBase: bigint;
    unitCostMillipaisePerBase: bigint;
    totalCostPaise: bigint;
  } | null;
};

/**
 * A sub-recipe the run needs to draw on is not held in stock - or the recipe being logged
 * is itself drawn on by others and is not. Either way the system has no shelf for the
 * batch to come from or go to, and every other answer is a wrong number: consuming
 * nothing understates the inputs, and expanding the dough into flour double-counts it on
 * the day the dough is logged in its own right.
 */
export class NotStockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotStockedError';
  }
}

/**
 * A STOCKED batch has an input nobody has priced. Stock must carry a value - the ledger's
 * own check refuses a valued inflow without one - and there is no honest value for dough
 * made partly from unpriced things. A made-to-order batch in the same position records
 * with a null cost instead (M5); this is the one run that has to wait.
 */
export class UncostedStockError extends Error {
  readonly missing: readonly MissingCost[];

  constructor(recipeName: string, missing: readonly MissingCost[]) {
    const names = missing.map((m) => m.name).join(', ');
    super(
      `"${recipeName}" goes into stock, and stock has to carry a value - but ` +
        `${missing.length === 1 ? 'this has' : 'these have'} no purchase history yet: ${names}. ` +
        `Record a delivery for ${missing.length === 1 ? 'it' : 'each'} and log the batch again. ` +
        `Something genuinely free, like tap water, is recorded as a delivery at Rs 0.`,
    );
    this.name = 'UncostedStockError';
    this.missing = missing;
  }
}

const quoted = (names: readonly string[]) => names.map((n) => `"${n}"`).join(', ');

/**
 * The STRUCTURE of a run: which rows it draws on and how much, before any price is read.
 *
 * Split from the costing half on purpose. src/db/production.ts needs to know which
 * ingredients a run touches so it can lock them BEFORE it reads their prices - read the
 * prices first and a delivery landing in between leaves the batch costed at a price the
 * ledger order says it never paid. See the forced-interleaving test in
 * src/db/production.db.test.ts.
 */
export function planDraws(
  recipeId: string,
  graph: ReadonlyMap<string, Recipe>,
  batchesMilli: bigint,
): { recipe: Recipe; draws: Draw[]; expectedYieldMilliBase: bigint } {
  const recipe = graph.get(recipeId);
  if (!recipe) throw new RangeError(`recipe ${recipeId} is not in the graph being produced`);
  if (batchesMilli <= 0n) throw new RangeError('Enter how many batches were made - more than none.');
  if (recipe.lines.length === 0) {
    // Without this a stocked recipe with no lines puts stock on the shelf at a cost of
    // nothing: a zero conjured from the absence of data.
    throw new RangeError(`"${recipe.name}" has no lines, so a batch of it would use nothing.`);
  }

  // The other half of M7, and it has to be checked here, on the recipe being logged:
  // otherwise logging it takes its inputs out of the store and puts the batch nowhere,
  // and the recipes made from it can then never be logged at all.
  if (!recipe.stockIngredientId) {
    const drawnOnBy = [...graph.values()].filter((r) =>
      r.lines.some((l) => l.subRecipeId === recipe.id),
    );
    if (drawnOnBy.length > 0) {
      throw new NotStockedError(
        `"${recipe.name}" is used in ${quoted(drawnOnBy.map((r) => r.name))}, so a batch of it ` +
          `has to go into stock for ${drawnOnBy.length === 1 ? 'that' : 'those'} to draw on. ` +
          `Mark "${recipe.name}" as held in stock, then log this batch.`,
      );
    }
  }

  const expectedYieldMilliBase = divRoundHalfUp(recipe.yieldQtyMilliBase * batchesMilli, MILLI);
  if (expectedYieldMilliBase <= 0n) {
    throw new RangeError(`That is too small a batch of "${recipe.name}" to record.`);
  }

  const draws: Draw[] = [];
  const unstocked: string[] = [];
  for (const line of recipe.lines) {
    const issued = issuedMilliBase(line.quantityMilliBase, line.wastageMillipercent, batchesMilli);
    if (line.ingredientId) {
      draws.push({ ingredientId: line.ingredientId, issuedMilliBase: issued, source: { kind: 'ingredient' } });
      continue;
    }
    const sub = graph.get(line.subRecipeId!);
    // Deleted out from under this recipe. Skipping the line would under-draw and
    // under-cost the batch, so it is the same refusal costing gives.
    if (!sub) throw new MissingSubRecipeError(line.subRecipeId!, [recipe.name]);
    if (!sub.stockIngredientId) {
      unstocked.push(sub.name);
      continue;
    }
    draws.push({
      ingredientId: sub.stockIngredientId,
      issuedMilliBase: issued,
      source: { kind: 'sub-recipe', recipeId: sub.id, name: sub.name },
    });
  }

  // All of them at once, so the fix is one trip rather than one per attempt.
  if (unstocked.length > 0) {
    throw new NotStockedError(
      `"${recipe.name}" draws on ${quoted(unstocked)}, which ${unstocked.length === 1 ? 'is' : 'are'} ` +
        `not held in stock, so there is nothing to draw on. Mark ` +
        `${unstocked.length === 1 ? 'it' : 'them'} as held in stock and log ` +
        `${unstocked.length === 1 ? 'its' : 'their'} batches first.`,
    );
  }

  return { recipe, draws, expectedYieldMilliBase };
}

/**
 * The whole run: its draws, what they cost, and what goes back on the shelf.
 *
 * `lookup` is the same seam costing takes (AGENTS.md § Costing takes its cost lookups as a
 * parameter): the database layer hands in one read under lock; a test hands in a map.
 */
export function planProductionRun(
  recipeId: string,
  graph: ReadonlyMap<string, Recipe>,
  lookup: CostLookup,
  batchesMilli: bigint,
  actualYieldMilliBase: bigint,
): ProductionPlan {
  const { recipe, draws, expectedYieldMilliBase } = planDraws(recipeId, graph, batchesMilli);
  if (actualYieldMilliBase < 0n) {
    throw new RangeError('What came out cannot be less than nothing. A burnt batch is zero.');
  }

  // Money, summed exactly in millionths of a paise and rounded once for the batch.
  // Every input is priced even after one fails, so the operator gets the whole list.
  let numerator = 0n;
  const missing: MissingCost[] = [];
  for (const draw of draws) {
    try {
      numerator += draw.issuedMilliBase * lookup(draw.ingredientId);
    } catch (e) {
      if (!(e instanceof MissingCostError)) throw e;
      for (const m of e.missing) {
        // Butter in the dough and butter in the topping is one missing price, not two.
        if (!missing.some((x) => x.ingredientId === m.ingredientId)) missing.push(m);
      }
    }
  }
  const batchCostPaise = missing.length > 0 ? null : divRoundHalfUp(numerator, MILLI * MILLI);

  // Ordered on purpose: a burnt batch needs no value, so an unpriced input must not stop
  // it being recorded - only a batch that actually goes onto a shelf has to wait.
  let output: ProductionPlan['output'] = null;
  if (recipe.stockIngredientId && actualYieldMilliBase > 0n) {
    if (batchCostPaise === null) throw new UncostedStockError(recipe.name, missing);
    output = {
      ingredientId: recipe.stockIngredientId,
      qtyMilliBase: actualYieldMilliBase,
      // Divided by the ACTUAL yield, through the helper a delivery goes through. A short
      // batch is genuinely dearer per gram, and that loss belongs in the rate (T15).
      unitCostMillipaisePerBase: unitCostMillipaisePerBase(batchCostPaise, actualYieldMilliBase),
      totalCostPaise: batchCostPaise,
    };
  }

  return {
    recipeId,
    name: recipe.name,
    yieldUnitType: recipe.yieldUnitType,
    batchesMilli,
    expectedYieldMilliBase,
    actualYieldMilliBase,
    draws,
    batchCostPaise,
    missing,
    output,
  };
}
