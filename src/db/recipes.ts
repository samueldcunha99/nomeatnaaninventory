/**
 * The database shell around the pure costing arithmetic in src/lib/costing.ts. No
 * arithmetic of its own, the same division stock.ts keeps.
 *
 * THIS IS THE ONE PLACE RECIPE LINES ARE LOADED.
 *
 * `recipe_lines` is soft-deleted. A costing query that forgets `deleted_at is null`
 * returns a line that was removed from the recipe and reports a cost that is higher,
 * plausible, and wrong — worse than a missing-cost error, because there is nothing to
 * surface and nothing to notice.
 *
 * So the filter does not live in the callers. It lives here, once, and **no costing code
 * queries `recipe_lines` directly** — not a join in a report, not a one-off count, not
 * "just this once because it is a different shape". If a new shape is needed it becomes a
 * parameter on this function. See AGENTS.md § One loader for recipe lines.
 */
import { and, eq, isNull, asc, sql as raw } from 'drizzle-orm';
import { db } from './client.ts';
import {
  recipes,
  recipeLines,
  ingredients,
  ingredientStock,
  menuItems,
  tenants,
  auditLog,
} from './schema.ts';
import {
  MissingCostError,
  explainRecipe,
  recipeRateMillipaisePerBase,
  assertAcyclicWithinDepth,
  assertLineUnitCompatible,
  type CostLookup,
  type MissingCost,
  type OverheadRates,
  type Recipe,
  type RecipeExplanation,
} from '../lib/costing.ts';
import { assertPermission, type Actor } from '../lib/auth.ts';
import { translating } from './errors.ts';
import type { UnitType } from '../lib/units.ts';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Every live recipe in the tenant, in the shape the costing functions take.
 *
 * The whole catalogue rather than one recipe on purpose: costing a recipe needs its
 * sub-recipes, and theirs, and a per-recipe fetch would either N+1 or re-implement the
 * walk in SQL. A catalogue is hundreds of rows.
 */
export async function loadRecipeGraph(actor: Actor): Promise<Map<string, Recipe>> {
  assertPermission(actor.role, 'recipes.view');
  const tenantId = actor.tenantId;

  const [recipeRows, lineRows] = await Promise.all([
    db
      .select({
        id: recipes.id,
        name: recipes.name,
        yieldUnitType: recipes.yieldUnitType,
        yieldQtyMilliBase: recipes.yieldQtyMilliBase,
        batchMinutes: recipes.batchMinutes,
      })
      .from(recipes)
      .where(and(eq(recipes.tenantId, tenantId), isNull(recipes.deletedAt)))
      .orderBy(asc(recipes.name)),
    db
      .select({
        recipeId: recipeLines.recipeId,
        ingredientId: recipeLines.ingredientId,
        subRecipeId: recipeLines.subRecipeId,
        quantityMilliBase: recipeLines.quantityMilliBase,
        wastageMillipercent: recipeLines.wastageMillipercent,
      })
      .from(recipeLines)
      .where(
        and(
          eq(recipeLines.tenantId, tenantId),
          // The filter. Everything above exists to make sure this is the only place it
          // has to be written.
          isNull(recipeLines.deletedAt),
        ),
      )
      // Every line of one save is inserted in a single statement and shares a created_at
      // to the microsecond, so created_at alone leaves the order up to the planner. The
      // id breaks the tie, which makes the editor show the same rows in the same places
      // on every load. It is stable, not meaningful: recipes carry no stored line order,
      // and the cost breakdown sorts by contribution on purpose.
      .orderBy(asc(recipeLines.createdAt), asc(recipeLines.id)),
  ]);

  const graph = new Map<string, Recipe>(
    recipeRows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        yieldUnitType: row.yieldUnitType,
        yieldQtyMilliBase: BigInt(row.yieldQtyMilliBase),
        batchMinutes: row.batchMinutes,
        lines: [],
      },
    ]),
  );

  for (const line of lineRows) {
    // A line whose recipe is soft-deleted has nowhere to go. Skipping it is right: the
    // recipe is gone, so its lines are not part of any live cost.
    const recipe = graph.get(line.recipeId);
    if (!recipe) continue;
    (recipe.lines as Recipe['lines'][number][]).push({
      ingredientId: line.ingredientId,
      subRecipeId: line.subRecipeId,
      quantityMilliBase: BigInt(line.quantityMilliBase),
      wastageMillipercent: BigInt(line.wastageMillipercent),
    });
  }

  return graph;
}

/* ---------------------------------------------------------------------------
 * The cost lookup, backed by the ledger
 * ------------------------------------------------------------------------- */

/**
 * Thrown when a purchase exists but the derived cache does not — which recordMovements
 * makes impossible, because it recalculates inside the same transaction. If it ever
 * happens it is a bug in the cache, and the one thing that must NOT happen is costing
 * the ingredient at zero and carrying on.
 */
export class StaleCostCacheError extends Error {
  constructor(name: string) {
    super(
      `"${name}" has purchase history but no cached cost. The ingredient_stock cache is ` +
        `out of step with the ledger; run a recalculation before costing anything.`,
    );
    this.name = 'StaleCostCacheError';
  }
}

/**
 * Build a cost lookup for a whole costing run, in ONE query.
 *
 * Batched deliberately: catalogue recalculation costs every recipe, and a per-ingredient
 * fetch would be N+1 against the ledger. The lookup it returns is synchronous, which is
 * what keeps src/lib/costing.ts pure and free of await.
 *
 * **Having a cost basis is "a purchase movement exists", not "a stock row exists" and not
 * "stock is above zero".** Those three come apart in ways that matter:
 *
 * - Stock counted down to zero still has a basis — the weighted average survives.
 * - An ingredient adjusted into existence with no purchase has an `ingredient_stock` row
 *   whose average is 0, and NO basis. Reading the row would cost it at zero, silently,
 *   which is the exact failure AGENTS.md § Missing cost data is an error, never zero
 *   exists to prevent.
 * - A purchase recorded at nil value — a free sample, a write-off — HAS a basis, and that
 *   basis is genuinely 0.
 *
 * Soft-deleted ingredients are included. A recipe line may still reference one, and its
 * purchase history is just as real; "deleted" is not "never received", and reporting it
 * as the latter would send someone looking for a delivery to record.
 */
export async function loadCostLookup(actor: Actor): Promise<CostLookup> {
  assertPermission(actor.role, 'recipes.view');

  const rows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      rate: ingredientStock.weightedAvgCostMillipaisePerBase,
      hasPurchase: raw<boolean>`exists (
        select 1 from stock_movements sm
        where sm.tenant_id = ${ingredients.tenantId}
          and sm.ingredient_id = ${ingredients.id}
          and sm.movement_type = 'purchase'
      )`,
    })
    .from(ingredients)
    .leftJoin(
      ingredientStock,
      and(
        eq(ingredientStock.tenantId, ingredients.tenantId),
        eq(ingredientStock.ingredientId, ingredients.id),
      ),
    )
    .where(eq(ingredients.tenantId, actor.tenantId));

  const costs = new Map<string, bigint>();
  const names = new Map<string, string>();

  for (const row of rows) {
    names.set(row.id, row.name);
    // Normalised at the boundary, once. `exists(...)` is a raw expression, so its type is
    // whatever the driver returns rather than what the select shape claims - and the rate
    // arrives from a left join that can be null. AGENTS.md § Aggregates come back as
    // strings; String() then BigInt() is correct whether the driver hands back a number
    // or a numeric string.
    if (!(row.hasPurchase === true || String(row.hasPurchase) === 'true')) continue;
    if (row.rate === null) throw new StaleCostCacheError(row.name);
    costs.set(row.id, BigInt(String(row.rate)));
  }

  return (ingredientId: string): bigint => {
    const rate = costs.get(ingredientId);
    if (rate === undefined) {
      throw new MissingCostError([{ ingredientId, name: names.get(ingredientId) ?? ingredientId }]);
    }
    return rate;
  };
}

/**
 * The tenant's hourly rates, or null when neither has been set.
 *
 * Null means "not configured" and the screens say so; it never means zero, because a
 * total that quietly claims labour is free is the same class of lie as costing an
 * ingredient nobody has bought at nothing. One rate set and the other not is a real
 * answer - a cafe may know its wage bill and not its gas - so that half counts as zero
 * and overhead still applies.
 */
export async function loadOverheadRates(actor: Actor): Promise<OverheadRates | null> {
  assertPermission(actor.role, 'recipes.view');
  const [row] = await db
    .select({
      labour: tenants.labourRatePaisePerHour,
      kitchen: tenants.kitchenRatePaisePerHour,
    })
    .from(tenants)
    .where(eq(tenants.id, actor.tenantId));

  if (!row || (row.labour === null && row.kitchen === null)) return null;
  return {
    labourPaisePerHour: BigInt(row.labour ?? 0),
    kitchenPaisePerHour: BigInt(row.kitchen ?? 0),
  };
}

/** Whole paise per hour, or null to unset. Only an owner or manager sets these. */
export async function saveOverheadRates(
  actor: Actor,
  input: { labourPaisePerHour: bigint | null; kitchenPaisePerHour: bigint | null },
): Promise<void> {
  assertPermission(actor.role, 'recipes.manage');
  for (const value of [input.labourPaisePerHour, input.kitchenPaisePerHour]) {
    if (value !== null && value < 0n) throw new RangeError('An hourly rate cannot be negative.');
  }

  await db.transaction(async (tx: Tx) => {
    await tx
      .update(tenants)
      .set({
        labourRatePaisePerHour:
          input.labourPaisePerHour === null ? null : Number(input.labourPaisePerHour),
        kitchenRatePaisePerHour:
          input.kitchenPaisePerHour === null ? null : Number(input.kitchenPaisePerHour),
      })
      .where(eq(tenants.id, actor.tenantId));

    await tx.insert(auditLog).values({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'tenant.rates_update',
      entityType: 'tenant',
      entityId: actor.tenantId,
      afterJson: {
        labourPaisePerHour:
          input.labourPaisePerHour === null ? null : Number(input.labourPaisePerHour),
        kitchenPaisePerHour:
          input.kitchenPaisePerHour === null ? null : Number(input.kitchenPaisePerHour),
      },
    });
  });
}

/* ---------------------------------------------------------------------------
 * Saving a recipe — where the validators actually fire
 * ------------------------------------------------------------------------- */

/** The unique indexes a name collides on. Matched by name so nothing else is mislabelled. */
const RECIPE_NAME_CONSTRAINT = 'recipes_tenant_name_uq';
const MENU_ITEM_NAME_CONSTRAINT = 'menu_items_tenant_name_uq';

export class DuplicateRecipeError extends Error {
  constructor(name: string) {
    super(`A recipe called "${name}" already exists. Open that one and edit it instead.`);
    this.name = 'DuplicateRecipeError';
  }
}

export class DuplicateMenuItemError extends Error {
  constructor(name: string) {
    super(`A menu item called "${name}" already exists. Open that one and edit it instead.`);
    this.name = 'DuplicateMenuItemError';
  }
}

export type RecipeLineInput = {
  ingredientId?: string | null;
  subRecipeId?: string | null;
  quantityMilliBase: bigint;
  wastageMillipercent?: bigint;
  /**
   * The unit the operator entered this line in. Not stored — the unit belongs to whatever
   * the line draws on. It exists so the mismatch a foreign key cannot express ("4.2 kg of
   * dough, used 200 ml at a time") is caught here, at save time.
   */
  entryUnitType: UnitType;
};

export type RecipeInput = {
  /** Present on an edit. Absent creates. */
  id?: string;
  name: string;
  yieldUnitType: UnitType;
  yieldQtyMilliBase: bigint;
  /** Minutes one batch takes. Null leaves it untimed, and untimed is not zero. */
  batchMinutes?: number | null;
  notes?: string | null;
  lines: readonly RecipeLineInput[];
};

/**
 * Create or replace a recipe, with every save-time check that the database cannot express
 * running first: unit compatibility, cycles, and depth.
 *
 * Editing replaces the line set wholesale — old lines are soft-deleted, new ones inserted,
 * in one transaction. Diffing them would be more code for an identical result, and the
 * soft-deleted rows are the edit history.
 */
export async function saveRecipe(actor: Actor, input: RecipeInput): Promise<string> {
  assertPermission(actor.role, 'recipes.manage');
  // Both messages are shown to an operator as they are, so they are sentences.
  if (input.lines.length === 0) throw new RangeError('A recipe needs at least one line.');
  if (input.yieldQtyMilliBase <= 0n) {
    throw new RangeError('One batch has to yield something. Enter how much it makes.');
  }

  const recipeId = input.id ?? crypto.randomUUID();

  const [graph, ingredientRows] = await Promise.all([
    loadRecipeGraph(actor),
    db
      .select({ id: ingredients.id, name: ingredients.name, unitType: ingredients.unitType })
      .from(ingredients)
      .where(eq(ingredients.tenantId, actor.tenantId)),
  ]);
  const ingredientsById = new Map(ingredientRows.map((r) => [r.id, r]));

  if (input.id && !graph.has(input.id)) {
    throw new RangeError(`recipe ${input.id} does not exist in this tenant`);
  }

  // Changing what a recipe YIELDS changes what every parent line means. A parent that
  // entered "2160 g of dough" cannot silently become 2160 ml, and nothing re-validates a
  // stored line - it carries no unit of its own, by design. So the change is refused
  // while a parent still draws on this recipe, naming the parents to remove it from.
  const before = input.id ? graph.get(input.id) : undefined;
  if (before && before.yieldUnitType !== input.yieldUnitType) {
    const parents = [...graph.values()].filter(
      (r) => r.id !== recipeId && r.lines.some((l) => l.subRecipeId === recipeId),
    );
    if (parents.length > 0) {
      throw new RangeError(
        `"${before.name}" is measured by ${before.yieldUnitType} and is used by ` +
          `${parents.map((p) => `"${p.name}"`).join(', ')}. Remove it from ` +
          `${parents.length === 1 ? 'that recipe' : 'those recipes'} before changing what it yields.`,
      );
    }
  }

  // Unit compatibility, line by line, against what the source actually measures in.
  for (const line of input.lines) {
    if (!line.ingredientId === !line.subRecipeId) {
      throw new RangeError('a line must reference exactly one of an ingredient or a sub-recipe');
    }

    let label: string;
    let provides: UnitType;
    if (line.ingredientId) {
      const ingredient = ingredientsById.get(line.ingredientId);
      if (!ingredient) throw new RangeError(`ingredient ${line.ingredientId} is not in this tenant`);
      label = ingredient.name;
      provides = ingredient.unitType;
    } else {
      const sub = graph.get(line.subRecipeId!);
      if (!sub) throw new RangeError(`recipe ${line.subRecipeId} is not in this tenant`);
      label = sub.name;
      provides = sub.yieldUnitType;
    }
    assertLineUnitCompatible(line.entryUnitType, provides, label);

    // Both of these are database checks as well. They are caught here so the operator is
    // told which LINE is wrong, by name, rather than being handed a constraint violation
    // that names a table and a column.
    if (line.quantityMilliBase <= 0n) {
      throw new RangeError(`"${label}" needs a quantity above zero.`);
    }
    const wastage = line.wastageMillipercent ?? 0n;
    if (wastage < 0n || wastage > 100_000n) {
      throw new RangeError(`Wastage on "${label}" must be between 0% and 100%.`);
    }
  }

  // Cycles and depth, against the graph as it WOULD be. Checked from every recipe, not
  // just this one: editing a leaf can push a parent past the depth limit, and walking
  // downward from the edited recipe alone would never see that.
  const prospective = new Map(graph);
  prospective.set(recipeId, {
    id: recipeId,
    name: input.name,
    yieldUnitType: input.yieldUnitType,
    yieldQtyMilliBase: input.yieldQtyMilliBase,
    batchMinutes: input.batchMinutes ?? null,
    lines: input.lines.map((l) => ({
      ingredientId: l.ingredientId ?? null,
      subRecipeId: l.subRecipeId ?? null,
      quantityMilliBase: l.quantityMilliBase,
      wastageMillipercent: l.wastageMillipercent ?? 0n,
    })),
  });
  for (const id of prospective.keys()) assertAcyclicWithinDepth(id, prospective);

  const run = () =>
    db.transaction(async (tx: Tx) => {
      const values = {
        tenantId: actor.tenantId,
        name: input.name,
        yieldUnitType: input.yieldUnitType,
        yieldQtyMilliBase: Number(input.yieldQtyMilliBase),
        batchMinutes: input.batchMinutes ?? null,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      };

      if (input.id) {
        await tx.update(recipes).set(values).where(eq(recipes.id, recipeId));
        await tx
          .update(recipeLines)
          .set({ deletedAt: new Date() })
          .where(and(eq(recipeLines.recipeId, recipeId), isNull(recipeLines.deletedAt)));
      } else {
        await tx.insert(recipes).values({ id: recipeId, ...values });
      }

      await tx.insert(recipeLines).values(
        input.lines.map((l) => ({
          tenantId: actor.tenantId,
          recipeId,
          ingredientId: l.ingredientId ?? null,
          subRecipeId: l.subRecipeId ?? null,
          quantityMilliBase: Number(l.quantityMilliBase),
          wastageMillipercent: Number(l.wastageMillipercent ?? 0n),
        })),
      );

      await tx.insert(auditLog).values({
        tenantId: actor.tenantId,
        userId: actor.id,
        action: input.id ? 'recipe.update' : 'recipe.create',
        entityType: 'recipe',
        entityId: recipeId,
        // bigint is not JSON, and jsonb is. Milli-base and millipercent are far inside
        // Number's exact range, the same argument as the aggregate rule.
        afterJson: {
          name: input.name,
          yieldUnitType: input.yieldUnitType,
          yieldQtyMilliBase: Number(input.yieldQtyMilliBase),
          lines: input.lines.map((l) => ({
            ingredientId: l.ingredientId ?? null,
            subRecipeId: l.subRecipeId ?? null,
            quantityMilliBase: Number(l.quantityMilliBase),
            wastageMillipercent: Number(l.wastageMillipercent ?? 0n),
          })),
        },
      });
    });

  await translating(run, [
    { constraint: RECIPE_NAME_CONSTRAINT, toError: () => new DuplicateRecipeError(input.name) },
  ]);

  return recipeId;
}

/* ---------------------------------------------------------------------------
 * Menu items — what a recipe sells as, and for how much
 * ------------------------------------------------------------------------- */

export type MenuItemInput = {
  /** Present on an edit. Absent creates. */
  id?: string;
  recipeId: string;
  name: string;
  portionQtyMilliBase: bigint;
  sellingPricePaise: bigint;
  isActive: boolean;
};

/**
 * Create or update one menu item.
 *
 * `recipeId` is set on create and never on update: a menu item that changes recipe
 * changes what it costs and what it depletes, and every historical figure carrying its
 * name would silently start meaning something else. Making a new item is the honest
 * version of that, and it keeps the old one's history intact.
 */
export async function saveMenuItem(actor: Actor, input: MenuItemInput): Promise<string> {
  assertPermission(actor.role, 'recipes.manage');
  if (input.portionQtyMilliBase <= 0n) {
    throw new RangeError('A portion has to be some of the batch. Enter how much one serving takes.');
  }
  // Zero is legal - staff meals, samples. Negative is not.
  if (input.sellingPricePaise < 0n) throw new RangeError('A selling price cannot be negative.');

  const [recipe] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(
      and(
        eq(recipes.tenantId, actor.tenantId),
        eq(recipes.id, input.recipeId),
        isNull(recipes.deletedAt),
      ),
    );
  if (!recipe) throw new RangeError(`recipe ${input.recipeId} does not exist in this tenant`);

  const itemId = input.id ?? crypto.randomUUID();

  const run = () =>
    db.transaction(async (tx: Tx) => {
      const values = {
        name: input.name,
        portionQtyMilliBase: Number(input.portionQtyMilliBase),
        sellingPricePaise: Number(input.sellingPricePaise),
        isActive: input.isActive,
        updatedAt: new Date(),
      };

      let beforeJson: Record<string, unknown> | null = null;
      if (input.id) {
        // Scoped by tenant as well as id: an id from another tenant updates nothing
        // rather than updating something.
        const [before] = await tx
          .select()
          .from(menuItems)
          .where(and(eq(menuItems.tenantId, actor.tenantId), eq(menuItems.id, itemId)));
        if (!before || before.deletedAt) throw new RangeError('That menu item no longer exists.');
        beforeJson = auditable(before);

        await tx
          .update(menuItems)
          .set(values)
          .where(and(eq(menuItems.tenantId, actor.tenantId), eq(menuItems.id, itemId)));
      } else {
        await tx
          .insert(menuItems)
          .values({ id: itemId, tenantId: actor.tenantId, recipeId: input.recipeId, ...values });
      }

      await tx.insert(auditLog).values({
        tenantId: actor.tenantId,
        userId: actor.id,
        action: input.id ? 'menu_item.update' : 'menu_item.create',
        entityType: 'menu_item',
        entityId: itemId,
        beforeJson,
        afterJson: {
          recipeId: input.recipeId,
          name: input.name,
          // bigint is not JSON, and jsonb is. Both are far inside Number's exact range.
          portionQtyMilliBase: Number(input.portionQtyMilliBase),
          sellingPricePaise: Number(input.sellingPricePaise),
          isActive: input.isActive,
        },
      });
    });

  await translating(run, [
    { constraint: MENU_ITEM_NAME_CONSTRAINT, toError: () => new DuplicateMenuItemError(input.name) },
  ]);

  return itemId;
}

/** What is worth keeping in the audit trail: the fields an operator actually changed. */
function auditable(row: typeof menuItems.$inferSelect) {
  const { id, tenantId, createdAt, updatedAt, deletedAt, ...rest } = row;
  return rest;
}

/* ---------------------------------------------------------------------------
 * Read models for the screens
 * ------------------------------------------------------------------------- */

/**
 * A recipe's cost, or the reason there isn't one. Deliberately a value rather than a
 * thrown error: on a list, one uncostable recipe must not blank the other nineteen.
 * Everywhere a single cost is the point, the throw is still the right shape.
 */
export type RecipeCost =
  | { ok: true; rateMillipaisePerBase: bigint }
  | { ok: false; missing: readonly MissingCost[] };

export type RecipeListRow = {
  id: string;
  name: string;
  yieldUnitType: UnitType;
  yieldQtyMilliBase: bigint;
  updatedAt: Date;
  lineCount: number;
  /** How many other live recipes draw on this one. Above zero makes it a sub-recipe. */
  usedByCount: number;
  cost: RecipeCost;
};

export async function listRecipes(
  actor: Actor,
  opts: { search?: string } = {},
): Promise<RecipeListRow[]> {
  const [graph, lookup, rates, stamps] = await Promise.all([
    loadRecipeGraph(actor),
    loadCostLookup(actor),
    loadOverheadRates(actor),
    db
      .select({ id: recipes.id, updatedAt: recipes.updatedAt })
      .from(recipes)
      .where(and(eq(recipes.tenantId, actor.tenantId), isNull(recipes.deletedAt))),
  ]);
  const updatedAt = new Map(stamps.map((s) => [s.id, s.updatedAt]));

  const usedBy = new Map<string, number>();
  for (const recipe of graph.values()) {
    for (const l of recipe.lines) {
      if (l.subRecipeId) usedBy.set(l.subRecipeId, (usedBy.get(l.subRecipeId) ?? 0) + 1);
    }
  }

  // One cache across the whole list, so a sub-recipe used by nine parents is costed once.
  // Safe because a rate computed over a missing ingredient is never cached - see the
  // guard in costing.ts and P22.
  const cache = new Map<string, bigint>();
  const needle = opts.search?.trim().toLowerCase();

  const rows: RecipeListRow[] = [];
  for (const recipe of graph.values()) {
    // Filtered here rather than in SQL: the whole graph has to be loaded anyway, because
    // costing one recipe needs its sub-recipes whether or not they match the search.
    if (needle && !recipe.name.toLowerCase().includes(needle)) continue;

    let cost: RecipeCost;
    try {
      cost = {
        ok: true,
        rateMillipaisePerBase: recipeRateMillipaisePerBase(recipe.id, graph, lookup, cache, rates),
      };
    } catch (e) {
      if (!(e instanceof MissingCostError)) throw e;
      cost = { ok: false, missing: e.missing };
    }

    rows.push({
      id: recipe.id,
      name: recipe.name,
      yieldUnitType: recipe.yieldUnitType,
      yieldQtyMilliBase: recipe.yieldQtyMilliBase,
      updatedAt: updatedAt.get(recipe.id) ?? new Date(0),
      lineCount: recipe.lines.length,
      usedByCount: usedBy.get(recipe.id) ?? 0,
      cost,
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export type RecipeEditLine = {
  /** The ingredient or recipe this line draws on. Which of the two is `kind`. */
  sourceId: string;
  kind: 'ingredient' | 'sub-recipe';
  quantityMilliBase: bigint;
  wastageMillipercent: bigint;
};

export type RecipeEdit = {
  id: string;
  name: string;
  batchMinutes: number | null;
  notes: string | null;
  yieldUnitType: UnitType;
  yieldQtyMilliBase: bigint;
  lines: RecipeEditLine[];
};

/**
 * One recipe in the shape the editor puts on screen. Lines come from the graph loader,
 * never from a query of their own - see the header of this file.
 */
export async function getRecipeForEdit(actor: Actor, id: string): Promise<RecipeEdit | null> {
  assertPermission(actor.role, 'recipes.manage');

  const [graph, rows] = await Promise.all([
    loadRecipeGraph(actor),
    db
      .select({ notes: recipes.notes })
      .from(recipes)
      .where(and(eq(recipes.tenantId, actor.tenantId), eq(recipes.id, id), isNull(recipes.deletedAt))),
  ]);

  const recipe = graph.get(id);
  if (!recipe || rows.length === 0) return null;

  return {
    id: recipe.id,
    name: recipe.name,
    batchMinutes: recipe.batchMinutes ?? null,
    notes: rows[0].notes,
    yieldUnitType: recipe.yieldUnitType,
    yieldQtyMilliBase: recipe.yieldQtyMilliBase,
    lines: recipe.lines.map((l) => ({
      sourceId: (l.subRecipeId ?? l.ingredientId)!,
      kind: l.subRecipeId ? ('sub-recipe' as const) : ('ingredient' as const),
      quantityMilliBase: l.quantityMilliBase,
      wastageMillipercent: l.wastageMillipercent,
    })),
  };
}

export type LineSource = {
  id: string;
  name: string;
  /** What it is measured in — and therefore the unit the line must be entered in. */
  unitType: UnitType;
  kind: 'ingredient' | 'recipe';
};

/**
 * Everything a recipe line may draw on: the ingredients on the shelf, and every other
 * recipe.
 *
 * Deactivated and soft-deleted ingredients are excluded, EXCEPT where a line of the
 * recipe being edited already uses one. Dropping those would leave a row on screen
 * pointing at a blank name, and re-saving would quietly rewrite the recipe.
 *
 * A recipe that would close a cycle is deliberately still offered. `saveRecipe` refuses
 * it with the loop spelled out, which tells the operator more than an option that is
 * silently absent.
 */
export async function listLineSources(actor: Actor, forRecipeId?: string): Promise<LineSource[]> {
  assertPermission(actor.role, 'recipes.manage');

  const [graph, rows] = await Promise.all([
    loadRecipeGraph(actor),
    db
      .select({
        id: ingredients.id,
        name: ingredients.name,
        unitType: ingredients.unitType,
        isActive: ingredients.isActive,
        deletedAt: ingredients.deletedAt,
      })
      .from(ingredients)
      .where(eq(ingredients.tenantId, actor.tenantId))
      .orderBy(asc(ingredients.name)),
  ]);

  const inUse = new Set(
    (forRecipeId ? (graph.get(forRecipeId)?.lines ?? []) : [])
      .map((l) => l.ingredientId)
      .filter((x): x is string => x !== null),
  );

  const sources: LineSource[] = rows
    .filter((r) => (r.isActive && r.deletedAt === null) || inUse.has(r.id))
    .map((r) => ({ id: r.id, name: r.name, unitType: r.unitType, kind: 'ingredient' as const }));

  for (const recipe of graph.values()) {
    if (recipe.id === forRecipeId) continue;
    sources.push({
      id: recipe.id,
      name: recipe.name,
      unitType: recipe.yieldUnitType,
      kind: 'recipe' as const,
    });
  }

  return sources;
}

export type UsedIngredient = {
  id: string;
  name: string;
  unitType: UnitType;
  purchaseUnit: string;
  purchaseUnitInBase: number;
  rateMillipaisePerBase: bigint | null;
};

export type MenuItemRow = {
  id: string;
  name: string;
  portionQtyMilliBase: bigint;
  sellingPricePaise: bigint;
  isActive: boolean;
};

/** What one recipe sells as. Shared by the breakdown and the menu editor. */
export async function listMenuItems(actor: Actor, recipeId: string): Promise<MenuItemRow[]> {
  assertPermission(actor.role, 'recipes.view');

  const rows = await db
    .select({
      id: menuItems.id,
      name: menuItems.name,
      portionQtyMilliBase: menuItems.portionQtyMilliBase,
      sellingPricePaise: menuItems.sellingPricePaise,
      isActive: menuItems.isActive,
    })
    .from(menuItems)
    .where(
      and(
        eq(menuItems.tenantId, actor.tenantId),
        eq(menuItems.recipeId, recipeId),
        isNull(menuItems.deletedAt),
      ),
    )
    .orderBy(asc(menuItems.name));

  // Money and quantity come back from the driver as strings; String() then BigInt() is
  // correct either way. AGENTS.md, Aggregates come back as strings.
  return rows.map((m) => ({
    ...m,
    portionQtyMilliBase: BigInt(String(m.portionQtyMilliBase)),
    sellingPricePaise: BigInt(String(m.sellingPricePaise)),
  }));
}

export type Breakdown = {
  recipe: { id: string; name: string; yieldUnitType: UnitType; yieldQtyMilliBase: bigint };
  explanation: RecipeExplanation | null;
  missing: readonly MissingCost[] | null;
  /** Line rows carry ids; this is how the screen turns them into words and units. */
  sources: Record<string, { name: string; unitType: UnitType }>;
  /** Every ingredient anywhere in the tree, for the what-if control. */
  ingredientsUsed: UsedIngredient[];
  menuItems: MenuItemRow[];
  /** Null when the tenant has set no hourly rates, so the screen can say so. */
  rates: OverheadRates | null;
};

/**
 * Everything the cost breakdown screen needs, in one call.
 *
 * `overrides` is the what-if: a map of ingredient to a hypothetical millipaise-per-base
 * rate. It wraps the real lookup and NOTHING IS WRITTEN - the ledger is untouched and
 * this function has no write path at all. That is the seam AGENTS.md describes, used for
 * the purpose it was built for.
 */
export async function getRecipeCostBreakdown(
  actor: Actor,
  recipeId: string,
  overrides?: ReadonlyMap<string, bigint>,
): Promise<Breakdown | null> {
  const [graph, realLookup, rates, ingredientRows, menuRows] = await Promise.all([
    loadRecipeGraph(actor),
    loadCostLookup(actor),
    loadOverheadRates(actor),
    db
      .select({
        id: ingredients.id,
        name: ingredients.name,
        unitType: ingredients.unitType,
        purchaseUnit: ingredients.purchaseUnit,
        purchaseUnitInBase: ingredients.purchaseUnitInBase,
      })
      .from(ingredients)
      .where(eq(ingredients.tenantId, actor.tenantId)),
    listMenuItems(actor, recipeId),
  ]);

  const recipe = graph.get(recipeId);
  if (!recipe) return null;

  const lookup: CostLookup =
    overrides && overrides.size > 0 ? (id) => overrides.get(id) ?? realLookup(id) : realLookup;

  // Ingredients and recipes share one map: a line's source is one or the other, and the
  // screen needs the same two facts about either.
  const sources: Record<string, { name: string; unitType: UnitType }> = {};
  for (const row of ingredientRows) sources[row.id] = { name: row.name, unitType: row.unitType };
  for (const r of graph.values()) sources[r.id] = { name: r.name, unitType: r.yieldUnitType };

  let explanation: RecipeExplanation | null = null;
  let missing: readonly MissingCost[] | null = null;
  try {
    explanation = explainRecipe(recipeId, graph, lookup, rates);
  } catch (e) {
    if (!(e instanceof MissingCostError)) throw e;
    missing = e.missing;
  }

  // Walked from the tree rather than listing the whole catalogue: the what-if offers the
  // ingredients that actually move THIS cost, which on a five-line recipe is five names
  // and not thirty-seven.
  const usedIds = new Set<string>();
  const walk = (id: string, seen: Set<string>) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const l of graph.get(id)?.lines ?? []) {
      if (l.ingredientId) usedIds.add(l.ingredientId);
      else if (l.subRecipeId) walk(l.subRecipeId, seen);
    }
  };
  walk(recipeId, new Set());

  const byId = new Map(ingredientRows.map((r) => [r.id, r]));
  const ingredientsUsed: UsedIngredient[] = [...usedIds]
    .map((id) => {
      const row = byId.get(id)!;
      let rate: bigint | null = null;
      try {
        rate = realLookup(id);
      } catch {
        rate = null; // no purchase history; the missing-cost panel says so, by name
      }
      return { ...row, rateMillipaisePerBase: rate };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    recipe: {
      id: recipe.id,
      name: recipe.name,
      yieldUnitType: recipe.yieldUnitType,
      yieldQtyMilliBase: recipe.yieldQtyMilliBase,
    },
    explanation,
    missing,
    sources,
    ingredientsUsed,
    menuItems: menuRows,
    rates,
  };
}
