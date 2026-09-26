/**
 * Ingredient master. Same pattern as src/db/users.ts: every function takes the acting
 * user and checks the permission itself. A server action is reachable without ever
 * loading the page that would have hidden the button.
 */
import { and, count, eq, ilike, isNull, asc, sql as raw } from 'drizzle-orm';
import { db } from './client.ts';
import { ingredients, ingredientStock, auditLog, stockMovements, recipeLines } from './schema.ts';
import { translating } from './errors.ts';
import { assertPermission, type Actor } from '../lib/auth.ts';
import type { UnitType } from '../lib/units.ts';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type IngredientInput = {
  name: string;
  /** Who made it. Null for anything bought loose, which is most of the bulk masala. */
  brand?: string | null;
  unitType: UnitType;
  purchaseUnit: string;
  purchaseUnitInBase: number;
  lowStockThresholdMilliBase: number;
};

/** Thrown when the tenant already has an ingredient of this name. */
export class DuplicateIngredientError extends Error {
  constructor(name: string) {
    super(
      `An ingredient named "${name}" already exists. If it was deactivated, reactivate ` +
        `it rather than creating a second one - a duplicate splits its stock ledger in two.`,
    );
    this.name = 'DuplicateIngredientError';
  }
}

/** The index the name collides on. Matched by name so nothing else gets mislabelled. */
const NAME_CONSTRAINT = 'ingredients_tenant_name_uq';

export type IngredientRow = {
  id: string;
  name: string;
  brand: string | null;
  unitType: UnitType;
  purchaseUnit: string;
  purchaseUnitInBase: number;
  lowStockThresholdMilliBase: number;
  isActive: boolean;
  qtyMilliBase: number;
  weightedAvgCostMillipaisePerBase: number;
};

/** One select, shared by the list and the single fetch, so they cannot drift. */
function selectIngredients(where: ReturnType<typeof and>) {
  return db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      brand: ingredients.brand,
      unitType: ingredients.unitType,
      purchaseUnit: ingredients.purchaseUnit,
      purchaseUnitInBase: ingredients.purchaseUnitInBase,
      lowStockThresholdMilliBase: ingredients.lowStockThresholdMilliBase,
      isActive: ingredients.isActive,
      qtyMilliBase: ingredientStock.qtyMilliBase,
      weightedAvgCostMillipaisePerBase: ingredientStock.weightedAvgCostMillipaisePerBase,
    })
    .from(ingredients)
    // Left join: an ingredient with no movements yet has no cache row, and must still
    // appear in the list at zero rather than vanish from it.
    .leftJoin(
      ingredientStock,
      and(
        eq(ingredientStock.tenantId, ingredients.tenantId),
        eq(ingredientStock.ingredientId, ingredients.id),
      ),
    )
    .where(where)
    .orderBy(asc(raw`lower(${ingredients.name})`));
}

function toRow(r: Awaited<ReturnType<typeof selectIngredients>>[number]): IngredientRow {
  return {
    ...r,
    unitType: r.unitType as UnitType,
    qtyMilliBase: r.qtyMilliBase ?? 0,
    weightedAvgCostMillipaisePerBase: r.weightedAvgCostMillipaisePerBase ?? 0,
  };
}

/**
 * `search` is a substring match on name; `activeOnly` defaults to true because a
 * deactivated ingredient is off the shelf and out of the way.
 */
export async function listIngredients(
  actor: Actor,
  opts: { search?: string; activeOnly?: boolean } = {},
): Promise<IngredientRow[]> {
  assertPermission(actor.role, 'ingredients.view');
  const { search, activeOnly = true } = opts;
  const rows = await selectIngredients(
    and(
      eq(ingredients.tenantId, actor.tenantId),
      isNull(ingredients.deletedAt),
      activeOnly ? eq(ingredients.isActive, true) : undefined,
      search ? ilike(ingredients.name, `%${search}%`) : undefined,
    ),
  );
  return rows.map(toRow);
}

export async function getIngredient(actor: Actor, id: string): Promise<IngredientRow | null> {
  assertPermission(actor.role, 'ingredients.view');
  const rows = await selectIngredients(
    and(eq(ingredients.tenantId, actor.tenantId), eq(ingredients.id, id), isNull(ingredients.deletedAt)),
  );
  return rows.length ? toRow(rows[0]) : null;
}

/**
 * `tx` lets a caller create the ingredient inside its OWN transaction - stockRecipe makes
 * a recipe's shelf row and links it in one step, and a link to a row that failed to
 * commit, or a row with no link, would both be wrong. Omitted, it opens its own, exactly
 * as before. Same shape as recordMovements, so there is still one write path for
 * ingredients (AGENTS.md § Bulk imports go through the write path).
 */
export async function createIngredient(actor: Actor, input: IngredientInput, tx?: Tx) {
  assertPermission(actor.role, 'ingredients.manage');
  const body = async (t: Tx) => {
    const [row] = await t
      .insert(ingredients)
      .values({ tenantId: actor.tenantId, ...input })
      .returning();
    await t.insert(auditLog).values({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'ingredient.create',
      entityType: 'ingredient',
      entityId: row.id,
      afterJson: auditable(row),
    });
    return row;
  };
  const run = () => (tx ? body(tx) : db.transaction(body));

  return translating(run, [
    { constraint: NAME_CONSTRAINT, toError: () => new DuplicateIngredientError(input.name) },
  ]);
}

/**
 * Editing does NOT touch stock or cost - those only ever move through the ledger.
 * purchase_unit_in_base is editable because a supplier really does switch from 1 kg
 * bags to 25 kg sacks; it rescales how receipts are entered, never what is on hand.
 */
export async function updateIngredient(actor: Actor, id: string, input: IngredientInput) {
  assertPermission(actor.role, 'ingredients.manage');
  const run = () =>
    db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(ingredients)
        .where(and(eq(ingredients.tenantId, actor.tenantId), eq(ingredients.id, id)));
      if (!before || before.deletedAt) throw new Error('ingredient not found');

      /*
       * Changing what an ingredient is MEASURED IN rewrites the meaning of everything
       * already recorded against it, silently.
       *
       * A recipe line carries no unit of its own - that is deliberate, the unit belongs
       * to the source - so flipping weight to volume turns "800 g of flour" into "800 ml
       * of flour" in every recipe using it, with no line re-validated and no total
       * moving. The ledger is worse: the stock on hand and the weighted average were
       * accumulated in grams and paise-per-gram, and afterwards they are read as
       * millilitres and paise-per-millilitre. Nothing throws, every figure still looks
       * reasonable, and each one now describes a different physical thing.
       *
       * saveRecipe already refuses the identical change to a recipe's yield unit while a
       * parent draws on it. This is that guard one level down, and AGENTS.md § A recipe's
       * yield unit is fixed named it as the matching hole.
       *
       * The refusal is narrow on purpose: an ingredient nothing has touched yet is free
       * to change, which is the case where a typo is actually being corrected.
       */
      if (before.unitType !== input.unitType) {
        const [[mv], [rl]] = await Promise.all([
          tx
            .select({ n: count() })
            .from(stockMovements)
            .where(
              and(
                eq(stockMovements.tenantId, actor.tenantId),
                eq(stockMovements.ingredientId, id),
              ),
            ),
          tx
            .select({ n: count() })
            .from(recipeLines)
            .where(
              and(
                eq(recipeLines.tenantId, actor.tenantId),
                eq(recipeLines.ingredientId, id),
                isNull(recipeLines.deletedAt),
              ),
            ),
        ]);
        // AGENTS.md § Aggregates come back as strings: count() is numeric, and
        // postgres.js hands numeric back as a string. '0' is truthy, so compare numbers.
        const movements = Number(mv.n);
        const lines = Number(rl.n);
        const usedBy = [
          movements > 0 ? `${movements} stock movement${movements === 1 ? '' : 's'}` : null,
          lines > 0 ? `${lines} recipe line${lines === 1 ? '' : 's'}` : null,
        ].filter(Boolean);

        if (usedBy.length > 0) {
          throw new RangeError(
            `"${before.name}" is measured by ${before.unitType} and is already used by ` +
              `${usedBy.join(' and ')}. Changing that to ${input.unitType} would silently ` +
              `reinterpret every quantity already recorded. Create a new ingredient with ` +
              `the right unit and deactivate this one instead.`,
          );
        }
      }

      const [after] = await tx
        .update(ingredients)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(ingredients.tenantId, actor.tenantId), eq(ingredients.id, id)))
        .returning();

      await tx.insert(auditLog).values({
        tenantId: actor.tenantId,
        userId: actor.id,
        action: 'ingredient.update',
        entityType: 'ingredient',
        entityId: id,
        beforeJson: auditable(before),
        afterJson: auditable(after),
      });
      return after;
    });

  return translating(run, [
    { constraint: NAME_CONSTRAINT, toError: () => new DuplicateIngredientError(input.name) },
  ]);
}

/**
 * Deactivate. Sets is_active = false and nothing else - deleted_at stays null and is
 * reserved for a removal this system does not offer, because stock and cost history
 * must stay reconstructable. The name stays taken; see DuplicateIngredientError.
 */
export async function setIngredientActive(actor: Actor, id: string, isActive: boolean) {
  assertPermission(actor.role, 'ingredients.manage');
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(ingredients)
      .where(and(eq(ingredients.tenantId, actor.tenantId), eq(ingredients.id, id)));
    if (!before || before.deletedAt) throw new Error('ingredient not found');

    const [after] = await tx
      .update(ingredients)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(ingredients.tenantId, actor.tenantId), eq(ingredients.id, id)))
      .returning();

    await tx.insert(auditLog).values({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: isActive ? 'ingredient.reactivate' : 'ingredient.deactivate',
      entityType: 'ingredient',
      entityId: id,
      beforeJson: { isActive: before.isActive },
      afterJson: { isActive: after.isActive },
    });
    return after;
  });
}

/** Timestamps and tenant_id add noise to a diff without adding information. */
function auditable(row: typeof ingredients.$inferSelect) {
  const { id, tenantId, createdAt, updatedAt, deletedAt, ...rest } = row;
  return rest;
}
