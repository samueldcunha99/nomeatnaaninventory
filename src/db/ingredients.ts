/**
 * Ingredient master. Same pattern as src/db/users.ts: every function takes the acting
 * user and checks the permission itself. A server action is reachable without ever
 * loading the page that would have hidden the button.
 */
import { and, eq, ilike, isNull, asc, sql as raw } from 'drizzle-orm';
import { db } from './client.ts';
import { ingredients, ingredientStock, auditLog } from './schema.ts';
import { translating } from './errors.ts';
import { assertPermission, type Actor } from '../lib/auth.ts';
import type { UnitType } from '../lib/units.ts';

export type IngredientInput = {
  name: string;
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

export async function createIngredient(actor: Actor, input: IngredientInput) {
  assertPermission(actor.role, 'ingredients.manage');
  const run = () =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(ingredients)
        .values({ tenantId: actor.tenantId, ...input })
        .returning();
      await tx.insert(auditLog).values({
        tenantId: actor.tenantId,
        userId: actor.id,
        action: 'ingredient.create',
        entityType: 'ingredient',
        entityId: row.id,
        afterJson: auditable(row),
      });
      return row;
    });

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
