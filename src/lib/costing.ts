/**
 * Recipe costing. Pure arithmetic over a recipe graph — no database access anywhere in
 * this file, deliberately.
 *
 * It takes its cost lookups AS A PARAMETER (AGENTS.md § Costing takes its cost lookups as
 * a parameter). That one seam is what buys the what-if price, historical "as at seq N"
 * costing, and re-runnable catalogue recalculation. Do not "simplify" it later by having
 * these functions fetch their own costs.
 *
 * ROUNDING. Inside one recipe nothing is rounded early: line contributions accumulate as
 * an exact rational and there is a single half-up division at the end, where the batch
 * cost is divided by the yield. A parent consumes its child's ALREADY-ROUNDED rate. That
 * looks like a violation of "round once at the end" and is not — see AGENTS.md § Nested
 * rounding, which explains why the displayed breakdown has to add up. Paper case P7 pins
 * it down; if P7 fails, read that section before changing anything here.
 */
import { divRoundHalfUp, type UnitType } from './units.ts';

/** Wastage is thousandths of a percent, so the multiplier is (K + w) / K. */
const WASTAGE_SCALE = 100000n;
/** milli_base per base unit, and millipaise per paise. Both are 1000. */
const MILLI = 1000n;

/**
 * How many sub-recipe hops are allowed below a recipe.
 *
 * FIVE, AND HERE IS THE REASONING, so it is not raised later as an arbitrary number.
 * The deepest real chain the cafe has is dough -> filled dough -> cinnamon roll, which is
 * three. Five leaves genuine headroom above the worst case anyone has described, while
 * still catching runaway nesting — a mis-entered graph that would otherwise become a
 * thousand-deep walk before anything complained.
 *
 * It is a judgement, not a derivation, and it is cheap to raise: change this number and
 * P19a follows it. What it must not become is a number nobody can justify, raised in a
 * hurry because one recipe hit the limit. If a real recipe needs six, that is worth
 * knowing about and worth a line in PROGRESS.md.
 */
export const MAX_RECIPE_DEPTH = 5;

export type RecipeLine = {
  /** Exactly one of these is set, as the database enforces. */
  ingredientId: string | null;
  subRecipeId: string | null;
  quantityMilliBase: bigint;
  wastageMillipercent: bigint;
};

export type Recipe = {
  id: string;
  name: string;
  yieldUnitType: UnitType;
  yieldQtyMilliBase: bigint;
  lines: readonly RecipeLine[];
  /**
   * How long one batch occupies the kitchen, in minutes. Optional, and null is NOT zero:
   * a recipe nobody has timed cannot have its labour costed, and the screens say so
   * rather than quietly costing it at nothing.
   */
  batchMinutes?: number | null;
};

/**
 * What an hour of making things costs, before any ingredient is touched. Tenant-wide,
 * because a wage is not a property of a cinnamon roll.
 *
 * Both are per hour of BATCH TIME, which is the honest allocator available here: a
 * three-hour dough batch really does consume more wages and more oven gas than a
 * two-minute chai, and charging overhead in proportion to grocery cost instead would say
 * the opposite. Anything finer needs production volume, which arrives with orders.
 */
export type OverheadRates = {
  /** Wages, per hour of batch time. */
  labourPaisePerHour: bigint;
  /** Gas, power, rent and the rest of the kitchen, per hour of batch time. */
  kitchenPaisePerHour: bigint;
};

export type BatchOverhead = {
  labourPaise: bigint;
  kitchenPaise: bigint;
  /** False when the batch has no time set, or the tenant has set no rates. */
  applied: boolean;
};

export const NO_OVERHEAD: BatchOverhead = { labourPaise: 0n, kitchenPaise: 0n, applied: false };

/**
 * What one batch costs in time. Rounded to whole paise HERE, which is the end of its own
 * chain - minutes times an hourly rate is money, and the figure printed on the breakdown
 * has to be the figure inside the total. Same reasoning as a sub-recipe's rounded rate;
 * see AGENTS.md, Nested rounding.
 */
export function batchOverheadPaise(
  batchMinutes: number | null | undefined,
  rates: OverheadRates | null,
): BatchOverhead {
  if (batchMinutes == null || rates == null) return NO_OVERHEAD;
  if (batchMinutes < 0) throw new RangeError('a batch cannot take negative time');
  const minutes = BigInt(batchMinutes);
  return {
    labourPaise: divRoundHalfUp(minutes * rates.labourPaisePerHour, 60n),
    kitchenPaise: divRoundHalfUp(minutes * rates.kitchenPaisePerHour, 60n),
    applied: true,
  };
}

/**
 * Millipaise per base unit for one ingredient. THROWS when the ingredient has no cost
 * basis — it does not return zero and does not return null for the caller to coalesce
 * (AGENTS.md § Missing cost data is an error, never zero).
 *
 * An ingredient whose only purchase cost nothing is a different thing: it HAS a basis,
 * and that basis is 0.
 */
export type CostLookup = (ingredientId: string) => bigint;

export type MissingCost = { ingredientId: string; name: string; path?: readonly string[] };

/**
 * Names every uncosted ingredient at once, with the recipe path to each. An operator can
 * act on "cardamom, in Cinnamon roll > Dough"; they cannot act on a total that is wrong
 * for reasons nobody told them.
 */
export class MissingCostError extends Error {
  readonly missing: readonly MissingCost[];

  constructor(missing: readonly MissingCost[]) {
    const names = missing
      .map((m) => (m.path?.length ? `${m.name} (in ${m.path.join(' > ')})` : m.name))
      .join(', ');
    super(
      `${missing.length} ${missing.length === 1 ? 'ingredient has' : 'ingredients have'} ` +
        `no purchase history, so nothing here can be costed: ${names}. ` +
        `Record a delivery for each, then cost this again.`,
    );
    this.name = 'MissingCostError';
    this.missing = missing;
  }
}

export class RecipeCycleError extends Error {
  constructor(path: readonly string[]) {
    super(
      `This recipe would contain itself: ${path.join(' > ')}. A recipe cannot use itself ` +
        `as an ingredient, directly or through another recipe.`,
    );
    this.name = 'RecipeCycleError';
  }
}

export class RecipeDepthError extends Error {
  constructor(path: readonly string[], maxDepth: number) {
    super(
      `Recipes are nested more than ${maxDepth} levels deep: ${path.join(' > ')}. ` +
        `Flatten one of these into its parent.`,
    );
    this.name = 'RecipeDepthError';
  }
}

export class UnitMismatchError extends Error {
  constructor(expected: UnitType, actual: UnitType, label: string) {
    super(
      `"${label}" is measured by ${actual}, but this line is entered by ${expected}. ` +
        `A recipe yielding 4.2 kg cannot be used 200 ml at a time.`,
    );
    this.name = 'UnitMismatchError';
  }
}

/**
 * Millipaise per ONE base unit of a recipe's yield.
 *
 * `cache` is shared across a catalogue run so each recipe is costed once; passing none
 * costs one recipe in isolation. Either way the answer is identical — that is P16.
 */
export function recipeRateMillipaisePerBase(
  recipeId: string,
  recipes: ReadonlyMap<string, Recipe>,
  lookup: CostLookup,
  cache: Map<string, bigint> = new Map(),
  // A cache is keyed by recipe alone, so it is shareable only across calls using the SAME
  // rates. Every caller that shares one costs a whole catalogue, where they are constant.
  rates: OverheadRates | null = null,
): bigint {
  const ctx: Ctx = { recipes, lookup, cache, missing: [], rates };
  const rate = rateOf(recipeId, ctx, []);
  // Collected across the whole tree, then thrown once, so the operator gets the full list
  // rather than one name per attempt.
  if (ctx.missing.length > 0) throw new MissingCostError(ctx.missing);
  return rate;
}

type Ctx = {
  recipes: ReadonlyMap<string, Recipe>;
  lookup: CostLookup;
  cache: Map<string, bigint>;
  missing: MissingCost[];
  /** Null costs ingredients only, which is what every paper case P1-P22 does. */
  rates: OverheadRates | null;
};

/** One line's contribution, before any rounding. See CONTRIBUTION_PER_PAISE. */
type Term = { line: RecipeLine; unitRate: bigint; numerator: bigint };

/**
 * How many numerator units make ONE whole paise: milli-base per base unit, times the
 * wastage scale, times millipaise per paise. The numerator is exact; this is the only
 * place a contribution becomes money.
 */
export const CONTRIBUTION_PER_PAISE = MILLI * WASTAGE_SCALE * MILLI;

/**
 * The single implementation of the recipe arithmetic. `terms`, when supplied, collects
 * each line's exact contribution so a breakdown can be built from the same numbers the
 * rate came from — never a second pass that could disagree with it.
 */
function rateOf(recipeId: string, ctx: Ctx, stack: readonly string[], terms?: Term[]): bigint {
  const recipe = ctx.recipes.get(recipeId);
  if (!recipe) throw new Error(`Recipe ${recipeId} is not in the graph being costed`);

  const path = [...stack, recipe.name];
  // Defensive, not a substitute for save-time validation: without it a cycle that got
  // into the database some other way would recurse until the stack blew, and a stack
  // overflow tells an operator nothing.
  if (stack.includes(recipe.name)) throw new RecipeCycleError(path);

  // A caller asking for terms wants this recipe's lines, which a cache hit would not
  // produce. Recomputing is cheap; a silently empty breakdown is not.
  if (!terms) {
    const hit = ctx.cache.get(recipeId);
    if (hit !== undefined) return hit;
  }

  const missingBefore = ctx.missing.length;
  let numerator = 0n;
  for (const line of recipe.lines) {
    const unitRate = line.subRecipeId
      ? rateOf(line.subRecipeId, ctx, path)
      : costOfIngredient(line.ingredientId!, ctx, path);
    // The wastage factor stays INSIDE the numerator. Costing never materialises a
    // wastage-adjusted quantity, so it never needs the sign-safe quantity rounder.
    const term = line.quantityMilliBase * unitRate * (WASTAGE_SCALE + line.wastageMillipercent);
    terms?.push({ line, unitRate, numerator: term });
    numerator += term;
  }

  /*
   * Time in the kitchen, folded into the same numerator the ingredients built.
   *
   * CONTRIBUTION_PER_PAISE is exactly the factor that turns one paise into this
   * numerator's units, so this is an exact addition rather than a second scale to keep
   * straight. Doing it HERE, before the division by yield, is what makes overhead flow
   * upward: a sub-recipe's labour is inside its rate, so a parent buying 2160 g of a
   * 4200 g dough batch carries 2160/4200 of the time that dough took. Adding it after
   * the division would strand every sub-recipe's labour at the bottom of the tree.
   */
  const overhead = batchOverheadPaise(recipe.batchMinutes, ctx.rates);
  numerator += (overhead.labourPaise + overhead.kitchenPaise) * CONTRIBUTION_PER_PAISE;

  // (batch millipaise) / (yield in base units), as one exact quotient:
  //   N / (MILLI x WASTAGE_SCALE)  divided by  yieldMilli / MILLI
  const rate = divRoundHalfUp(numerator, WASTAGE_SCALE * recipe.yieldQtyMilliBase);

  // NEVER cache a rate computed over a missing ingredient. The 0n placeholder makes it
  // too low, and a cached wrong number is worse than the error it stands in for: a
  // parent reading it finds nothing missing in its own walk and returns a confident,
  // plausible, wrong total. That is the failure this whole module exists to prevent,
  // and it is only reachable when a cache outlives one call - which costCatalogue and
  // the recipe list both do.
  if (ctx.missing.length === missingBefore) ctx.cache.set(recipeId, rate);
  return rate;
}

function costOfIngredient(ingredientId: string, ctx: Ctx, path: readonly string[]): bigint {
  try {
    return ctx.lookup(ingredientId);
  } catch (e) {
    if (!(e instanceof MissingCostError)) throw e;
    // Re-stamp with where in the tree it was reached from, and keep walking so the rest
    // of the missing ingredients are found in this pass too. The 0n is never returned to
    // a caller: recipeRateMillipaisePerBase throws before the total escapes.
    for (const m of e.missing) ctx.missing.push({ ...m, path });
    return 0n;
  }
}

/* ---------------------------------------------------------------------------
 * The breakdown — the same arithmetic, itemised
 * ------------------------------------------------------------------------- */

export type CostLine = {
  kind: 'ingredient' | 'sub-recipe';
  sourceId: string;
  /** As entered, before wastage. */
  quantityMilliBase: bigint;
  /** After the wastage multiplier, rounded for DISPLAY only — never used in the sum. */
  effectiveMilliBase: bigint;
  wastageMillipercent: bigint;
  rateMillipaisePerBase: bigint;
  /** Rounded half-up, once, here. The screen shows this and it must add up. */
  contributionPaise: bigint;
  /** A sub-recipe's own composition, for the expandable row. */
  children: RecipeExplanation | null;
};

export type RecipeExplanation = {
  recipeId: string;
  name: string;
  yieldUnitType: UnitType;
  yieldQtyMilliBase: bigint;
  lines: CostLine[];
  /**
   * The SUM OF THE ROUNDED LINES, not the rounded exact batch. The breakdown's whole job
   * is that its column adds up: an owner who totals the rupee figures on screen must get
   * this number. The two differ by under a paise, and only when wastage makes a line's
   * contribution fractional.
   *
   * `rateMillipaisePerBase` still comes from the exact batch, so `rate x yield` is NOT
   * this number — rounding the rate is what makes the nested breakdown add up at all.
   * See AGENTS.md § Nested rounding.
   */
  /**
   * INGREDIENTS ONLY. What the time in the kitchen costs is below it, and
   * `totalBatchPaise` is the two together - which is what a menu item is measured
   * against, because a roll that took ninety minutes of somebody's day did not cost
   * only its flour.
   */
  batchPaise: bigint;
  /** Minutes one batch takes, or null when nobody has timed it. Null is not zero. */
  batchMinutes: number | null;
  overhead: BatchOverhead;
  /** Ingredients plus labour plus kitchen. What making one batch actually costs. */
  totalBatchPaise: bigint;
  rateMillipaisePerBase: bigint;
};

/** Every line of a recipe, itemised, with sub-recipes expanded one level at a time. */
export function explainRecipe(
  recipeId: string,
  recipes: ReadonlyMap<string, Recipe>,
  lookup: CostLookup,
  rates: OverheadRates | null = null,
): RecipeExplanation {
  const ctx: Ctx = { recipes, lookup, cache: new Map(), missing: [], rates };
  const out = explain(recipeId, ctx, []);
  if (ctx.missing.length > 0) throw new MissingCostError(ctx.missing);
  return out;
}

function explain(recipeId: string, ctx: Ctx, stack: readonly string[]): RecipeExplanation {
  const recipe = ctx.recipes.get(recipeId)!;
  const terms: Term[] = [];
  const rate = rateOf(recipeId, ctx, stack, terms);
  const path = [...stack, recipe.name];

  const overhead = batchOverheadPaise(recipe.batchMinutes, ctx.rates);
  const lines: CostLine[] = terms.map((t) => ({
    kind: t.line.subRecipeId ? 'sub-recipe' : 'ingredient',
    sourceId: (t.line.subRecipeId ?? t.line.ingredientId)!,
    quantityMilliBase: t.line.quantityMilliBase,
    effectiveMilliBase: divRoundHalfUp(
      t.line.quantityMilliBase * (WASTAGE_SCALE + t.line.wastageMillipercent),
      WASTAGE_SCALE,
    ),
    wastageMillipercent: t.line.wastageMillipercent,
    rateMillipaisePerBase: t.unitRate,
    contributionPaise: divRoundHalfUp(t.numerator, CONTRIBUTION_PER_PAISE),
    children: t.line.subRecipeId ? explain(t.line.subRecipeId, ctx, path) : null,
  }));

  const batchPaise = lines.reduce((sum, l) => sum + l.contributionPaise, 0n);

  return {
    recipeId,
    name: recipe.name,
    yieldUnitType: recipe.yieldUnitType,
    yieldQtyMilliBase: recipe.yieldQtyMilliBase,
    lines,
    batchPaise,
    batchMinutes: recipe.batchMinutes ?? null,
    overhead,
    totalBatchPaise: batchPaise + overhead.labourPaise + overhead.kitchenPaise,
    rateMillipaisePerBase: rate,
  };
}

/** Every recipe in the graph, costed once. Identical to costing each individually (P16). */
export function costCatalogue(
  recipes: ReadonlyMap<string, Recipe>,
  lookup: CostLookup,
  rates: OverheadRates | null = null,
): Map<string, bigint> {
  const cache = new Map<string, bigint>();
  const out = new Map<string, bigint>();
  for (const id of recipes.keys()) {
    out.set(id, recipeRateMillipaisePerBase(id, recipes, lookup, cache, rates));
  }
  return out;
}

/**
 * What one sold portion costs, in WHOLE PAISE. This is the money boundary: the rate stays
 * a rate until here, and rounds to paise exactly once, at the end.
 */
export function portionCostPaise(
  rateMillipaisePerBase: bigint,
  portionQtyMilliBase: bigint,
): bigint {
  return divRoundHalfUp(rateMillipaisePerBase * portionQtyMilliBase, MILLI * MILLI);
}

export type Margin = {
  costPaise: bigint;
  marginPaise: bigint;
  foodCostPercent: number;
  marginPercent: number;
};

export function menuItemMargin(costPaise: bigint, sellingPricePaise: bigint): Margin {
  // A zero price (staff meal, sample) has no meaningful percentage. NaN rather than a
  // fabricated 0% - the display decides what to show, the arithmetic does not invent it.
  const foodCostPercent =
    sellingPricePaise === 0n ? Number.NaN : (Number(costPaise) / Number(sellingPricePaise)) * 100;
  return {
    costPaise,
    marginPaise: sellingPricePaise - costPaise,
    foodCostPercent,
    marginPercent: 100 - foodCostPercent,
  };
}

/**
 * Save-time validation. Postgres cannot express "no cycles" or "not too deep", so these
 * run before a recipe is saved. Costing has its own cycle guard, but it is a backstop —
 * this is where a cycle is supposed to be caught, with a message naming the loop.
 */
export function assertAcyclicWithinDepth(
  recipeId: string,
  recipes: ReadonlyMap<string, Recipe>,
  maxDepth: number = MAX_RECIPE_DEPTH,
): void {
  const walk = (id: string, stack: readonly string[]): void => {
    const recipe = recipes.get(id);
    if (!recipe) throw new Error(`Recipe ${id} is not in the graph being validated`);

    const path = [...stack, recipe.name];
    if (stack.includes(recipe.name)) throw new RecipeCycleError(path);
    if (path.length - 1 > maxDepth) throw new RecipeDepthError(path, maxDepth);

    for (const line of recipe.lines) if (line.subRecipeId) walk(line.subRecipeId, path);
  };
  walk(recipeId, []);
}

/**
 * A line's quantity is in the unit of whatever it draws on, and nothing in the schema can
 * express that: `recipe_lines` has no unit column, because the unit belongs to the source.
 * The operator's entry unit is checked here, at save time, against what the source
 * actually measures in.
 */
export function assertLineUnitCompatible(
  lineExpects: UnitType,
  sourceProvides: UnitType,
  sourceLabel: string,
): void {
  if (lineExpects !== sourceProvides) {
    throw new UnitMismatchError(lineExpects, sourceProvides, sourceLabel);
  }
}
