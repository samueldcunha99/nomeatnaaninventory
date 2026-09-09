import {
  pgTable,
  pgEnum,
  uuid,
  text,
  bigint,
  bigserial,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  foreignKey,
  index,
  uniqueIndex,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/* ---------------------------------------------------------------------------
 * Units of measure. Three scales, no others.
 *
 *   *_milli_base            integer thousandths of a base unit.
 *                           base unit: weight -> gram, volume -> ml, count -> unit.
 *                           1 g = 1000. 0.4 g of salt = 400. 1.5 g of yeast = 1500.
 *                           Whole grams would floor the salt to 0 (never depletes)
 *                           and the yeast to 2 (33% out), compounding through
 *                           Month 2 sub-recipes.
 *
 *   *_millipaise_per_base   integer thousandths of a paise, per ONE base unit.
 *                           Butter Rs 500/kg -> 50000 paise/kg -> 50 paise/g
 *                           -> 50000 millipaise/g.
 *                           Whole paise/gram would round maida (~4) and a cheap
 *                           spice (~0.4 -> 0) into nonsense.
 *
 *   *_paise                 integer whole paise. Real money that changed hands,
 *                           and nothing else. total_cost_paise here;
 *                           order_lines.cost_snapshot_paise in Month 3.
 *                           Per-unit RATES are never stored in this scale.
 *
 * Conversion happens in exactly two places, and nowhere in between:
 *   input boundary    Zod parses the operator's decimal ("2.5 kg") and multiplies
 *                     up to milli_base / millipaise integers before anything else.
 *   display boundary  formatINR() and formatQty() divide back down, rounding
 *                     half-up, once, on the final value only. Never on an
 *                     intermediate, never inside a costing chain.
 *
 * purchase_unit_in_base stays in whole BASE units (kg -> 1000, tray -> 30). It is
 * a unit definition, not a measurement. The input boundary applies the x1000.
 *
 * Arithmetic that multiplies two of these scales (the weighted-average) overflows
 * int8 reasoning quickly, so it casts to numeric in SQL, divides, and rounds once
 * at the end.
 *
 * ROUNDING NEVER TOUCHES A QUANTITY. Quantities are signed - negative on
 * consumption, wastage and downward adjustments - and Postgres round(numeric) is
 * half-away-from-zero, so rounding a signed quantity would send -0.5 to -1 and
 * quietly deplete stock that was never used. Quantities are exact integers in
 * milli_base; the input boundary REJECTS precision finer than milli_base rather
 * than rounding it away. Only the final cost quotient is rounded, and costs are
 * non-negative (enforced by check constraint), so half-away-from-zero is half-up.
 * ------------------------------------------------------------------------- */

export const userRole = pgEnum('user_role', ['owner', 'manager', 'counter', 'kitchen']);
export const unitType = pgEnum('unit_type', ['weight', 'volume', 'count']);

/**
 * WHAT happened. `wastage` owns the concept of stock lost rather than sold - burnt
 * batches, dropped trays, proofing trim and expiry are all wastage. The cause is
 * carried separately, in movement_reason.
 */
export const movementType = pgEnum('movement_type', [
  'purchase',
  'adjustment',
  'wastage',
  'consumption', // written by Module 4, not this month
  'reversal', // written by Module 4, not this month
]);
/**
 * The CAUSE. movement_type says what happened, movement_reason says why.
 * Serves both `adjustment` and `wastage`, so causes for both live here:
 *   adjustment -> count_correction | theft | other
 *   wastage    -> spoilage | expiry | burnt | dropped | trim | other
 * The pairing is enforced by check constraint on stock_movements.
 */
export const movementReason = pgEnum('movement_reason', [
  // adjustment causes
  'count_correction',
  'theft',
  // wastage causes
  'spoilage',
  'expiry',
  'burnt',
  'dropped',
  'trim',
  // either
  'other',
]);

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const deletedAt = () => timestamp('deleted_at', { withTimezone: true });
const milliBase = (name: string) => bigint(name, { mode: 'number' });
const millipaisePerBase = (name: string) => bigint(name, { mode: 'number' });
const paise = (name: string) => bigint(name, { mode: 'number' });
// Thousandths of a percent. 3% -> 3000, 2.5% -> 2500. See the Module 3 header below.
const millipercent = (name: string) => bigint(name, { mode: 'number' });

export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  currency: text('currency').notNull().default('INR'),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('users_tenant_email_uq').on(t.tenantId, sql`lower(${t.email})`),
    // Target for composite FKs from tenant-scoped children. Must be a UNIQUE
    // CONSTRAINT, not a unique index: drizzle-kit emits constraints inline in
    // CREATE TABLE but indexes after the ALTER TABLE ... ADD FOREIGN KEY block,
    // and Postgres rejects an FK whose target has no unique constraint yet.
    unique('users_tenant_id_uq').on(t.tenantId, t.id),
  ],
);

/**
 * Not in the spec's entity list, but session auth needs somewhere to put sessions.
 * The PK is sha256(cookie token), hex. The raw token exists only in the cookie, the
 * same reasoning as password_hash: a dump or a read-only leak of this table must not
 * let anyone impersonate a live session.
 */
export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('sessions_tenant_user_idx').on(t.tenantId, t.userId),
    foreignKey({
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
      name: 'sessions_tenant_user_fk',
    }),
  ],
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    phone: text('phone'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('suppliers_tenant_idx').on(t.tenantId),
    unique('suppliers_tenant_id_uq').on(t.tenantId, t.id),
  ],
);

export const ingredients = pgTable(
  'ingredients',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    /**
     * Who made it - "Aashirvaad", "Amul", "Van Houten 10/12". Nullable, because plenty of
     * things are bought loose from a bulk trader with no brand at all.
     *
     * Its own column rather than part of the name, because the two answer different
     * questions: recipes and cost breakdowns are read by ingredient ("butter"), while
     * reordering is done by brand ("the Amul 1 kg, not the Dlecta"). Folding it into the
     * name would also make a change of supplier a rename of something recipe lines point
     * at. Added Month 2, when the client's real price list arrived carrying it.
     */
    brand: text('brand'),
    // Base unit label ('g' | 'ml' | 'unit') is derived from unit_type in code,
    // not stored - a column that can never diverge is a column that can be wrong.
    unitType: unitType('unit_type').notNull(),
    purchaseUnit: text('purchase_unit').notNull(), // 'kg', 'litre', 'tray', 'dozen'
    purchaseUnitInBase: bigint('purchase_unit_in_base', { mode: 'number' }).notNull(), // kg -> 1000
    lowStockThresholdMilliBase: milliBase('low_stock_threshold_milli_base').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('ingredients_tenant_name_uq')
      .on(t.tenantId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index('ingredients_tenant_active_idx').on(t.tenantId, t.isActive),
    unique('ingredients_tenant_id_uq').on(t.tenantId, t.id),
    check('ingredients_purchase_unit_positive', sql`${t.purchaseUnitInBase} > 0`),
    check('ingredients_threshold_nonneg', sql`${t.lowStockThresholdMilliBase} >= 0`),
  ],
);

/**
 * Append-only. No UPDATE, no DELETE, ever. A correction is a new row.
 * quantity_milli_base is signed: positive in, negative out.
 */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: id(),
    // Canonical ledger order. created_at ties inside a multi-line receipt, and with
    // rounding applied at each step a replay in a different order can land a
    // millipaise away from the incrementally maintained cache. A ledger needs a
    // total order; this is it. Always ORDER BY seq when replaying.
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    tenantId: uuid('tenant_id').notNull(),
    ingredientId: uuid('ingredient_id').notNull(),
    movementType: movementType('movement_type').notNull(),
    quantityMilliBase: milliBase('quantity_milli_base').notNull(),
    // Purchases only. Cost per one base unit. Null on every other movement type.
    unitCostMillipaisePerBase: millipaisePerBase('unit_cost_millipaise_per_base'),
    // Actual rupees paid, purchases only. Whole paise - this is money, not a rate.
    totalCostPaise: paise('total_cost_paise'),
    supplierId: uuid('supplier_id'),
    referenceType: text('reference_type'), // 'receipt' | 'order' | 'adjustment'
    referenceId: uuid('reference_id'), // groups the lines of one multi-line receipt
    reason: movementReason('reason'),
    note: text('note'),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('stock_movements_ledger_idx').on(t.tenantId, t.ingredientId, t.seq),
    index('stock_movements_reference_idx').on(t.tenantId, t.referenceType, t.referenceId),
    foreignKey({
      columns: [t.tenantId, t.ingredientId],
      foreignColumns: [ingredients.tenantId, ingredients.id],
      name: 'stock_movements_tenant_ingredient_fk',
    }),
    foreignKey({
      columns: [t.tenantId, t.createdByUserId],
      foreignColumns: [users.tenantId, users.id],
      name: 'stock_movements_tenant_user_fk',
    }),
    foreignKey({
      columns: [t.tenantId, t.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'stock_movements_tenant_supplier_fk',
    }),
    check('stock_movements_qty_nonzero', sql`${t.quantityMilliBase} <> 0`),
    // Cost is set on purchases and only on purchases.
    check(
      'stock_movements_cost_on_purchase_only',
      sql`(${t.movementType} = 'purchase') = (${t.unitCostMillipaisePerBase} is not null and ${t.totalCostPaise} is not null)`,
    ),
    check('stock_movements_cost_nonneg', sql`${t.unitCostMillipaisePerBase} is null or (${t.unitCostMillipaisePerBase} >= 0 and ${t.totalCostPaise} >= 0)`),
    check(
      'stock_movements_purchase_qty_positive',
      sql`${t.movementType} <> 'purchase' or ${t.quantityMilliBase} > 0`,
    ),
    // Adjustments and wastage both require a cause. Purchase / consumption / reversal
    // must not carry one - they are not manual corrections.
    check(
      'stock_movements_manual_has_reason',
      sql`case when ${t.movementType} in ('adjustment', 'wastage') then ${t.reason} is not null else ${t.reason} is null end`,
    ),
    // The cause has to make sense for the event. Keeps wastage reporting clean.
    check(
      'stock_movements_reason_matches_type',
      sql`${t.reason} is null
          or (${t.movementType} = 'adjustment' and ${t.reason} in ('count_correction', 'theft', 'other'))
          or (${t.movementType} = 'wastage' and ${t.reason} in ('spoilage', 'expiry', 'burnt', 'dropped', 'trim', 'other'))`,
    ),
    check('stock_movements_other_reason_has_note', sql`${t.reason} <> 'other' or ${t.note} is not null`),
  ],
);

/**
 * Derived cache, NOT the source of truth. Recomputed inside the same transaction
 * as every movement insert. recalculateStock(ingredientId) rebuilds it from the ledger.
 * qty_milli_base is allowed to go negative - the cafe sells the last croissant
 * regardless of what the system thinks (spec 6.2). Flag it in the UI, don't block it.
 */
export const ingredientStock = pgTable(
  'ingredient_stock',
  {
    tenantId: uuid('tenant_id').notNull(),
    ingredientId: uuid('ingredient_id').notNull(),
    qtyMilliBase: milliBase('qty_milli_base').notNull().default(0),
    weightedAvgCostMillipaisePerBase: millipaisePerBase('weighted_avg_cost_millipaise_per_base')
      .notNull()
      .default(0),
    /**
     * The seq of the last movement folded into this row - the snapshot watermark.
     *
     * Without it every insert replays an ingredient's entire ledger, which is 87 ms at
     * 50k movements and grows forever (AGENTS.md, Ledger replay cost). With it the
     * ordinary path folds only what arrived since, and a full rebuild is still one call
     * away for when the cache has to be re-derived from the source of truth.
     *
     * This is a derived value like the two above it. It never makes the cache the truth:
     * the ledger is, and `recalculateStock(..., { rebuild: true })` proves it on demand.
     */
    snapshotSeq: bigint('snapshot_seq', { mode: 'number' }).notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.ingredientId] }),
    index('ingredient_stock_low_idx').on(t.tenantId, t.qtyMilliBase),
    foreignKey({
      columns: [t.tenantId, t.ingredientId],
      foreignColumns: [ingredients.tenantId, ingredients.id],
      name: 'ingredient_stock_tenant_ingredient_fk',
    }),
    check('ingredient_stock_avg_cost_nonneg', sql`${t.weightedAvgCostMillipaisePerBase} >= 0`),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id'), // null for system actions
    action: text('action').notNull(), // 'ingredient.update', 'user.deactivate'
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    beforeJson: jsonb('before_json'),
    afterJson: jsonb('after_json'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_tenant_created_idx').on(t.tenantId, t.createdAt),
    foreignKey({
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
      name: 'audit_log_tenant_user_fk',
    }),
  ],
);

/* ---------------------------------------------------------------------------
 * Module 3 — recipes, sub-recipes, menu items. SCHEMA ONLY, no arithmetic.
 *
 * Quantities are milli_base on the same scale as stock_movements: a recipe line
 * consuming 180 g of dough stores 180000, and the sub-recipe it draws from
 * yields 4200000 (4.2 kg). Same scale on both sides of the reference, so a
 * sub-recipe line needs no conversion — only the unit_type compatibility check,
 * which is save-time work (PROGRESS.md, Month 2 risks).
 *
 * WASTAGE is `wastage_millipercent`, thousandths of a percent, and the multiplier
 * is 1 + w/100000 — AGENTS.md's `180 g x 1.03`. It means you must ISSUE more than
 * the recipe calls for. The other reading (yield shrinks, so divide by 1 - w) was
 * considered and rejected; see AGENTS.md § Wastage is a multiplier on quantity.
 *
 * It multiplies QUANTITY and never cost. Cost follows because more quantity costs
 * more; applying it to cost as well would count the loss twice.
 * ------------------------------------------------------------------------- */

export const recipes = pgTable(
  'recipes',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    /**
     * What one batch produces, and in what kind of unit. A dough batch is
     * (weight, 4200000); a cinnamon-roll batch is (count, 12000).
     *
     * Batch-level loss lives HERE, not in a recipe-level wastage column: if the
     * bowl keeps 300 g, the batch yields 4.2 kg and not 4.5 kg, and that is the
     * same statement with one fewer column. Two places to record one loss are two
     * places to double-count it. Wastage percent is per-line, where the loss is
     * attributable to one input.
     */
    yieldUnitType: unitType('yield_unit_type').notNull(),
    yieldQtyMilliBase: milliBase('yield_qty_milli_base').notNull(),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('recipes_tenant_name_uq')
      .on(t.tenantId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    // Composite-FK target for recipe_lines (twice) and menu_items. Must be a
    // UNIQUE CONSTRAINT, not an index — same drizzle-kit emission-order reason as
    // users_tenant_id_uq above.
    unique('recipes_tenant_id_uq').on(t.tenantId, t.id),
    // A zero-yield recipe divides by zero in every costing path that will exist.
    check('recipes_yield_positive', sql`${t.yieldQtyMilliBase} > 0`),
  ],
);

/**
 * Deviation 9: carries tenant_id, which PROJECT-SPEC § 5 omits. The composite FKs
 * to recipes and ingredients are what stop a line referencing another tenant's data.
 *
 * SOFT DELETE WARNING. A costing query that forgets `deleted_at is null` inflates a
 * recipe cost silently, which is the undetectable failure class. Nothing in the
 * costing path may query this table directly — see AGENTS.md § One loader for
 * recipe lines.
 */
export const recipeLines = pgTable(
  'recipe_lines',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    recipeId: uuid('recipe_id').notNull(),
    // Exactly one of these two is set — enforced below, in the database.
    ingredientId: uuid('ingredient_id'),
    subRecipeId: uuid('sub_recipe_id'),
    /**
     * Magnitude, always positive. A recipe line describes a quantity, not a ledger
     * event; the sign appears in Month 3 when consumption is written. Expressed in
     * the referenced thing's own base unit: g for an ingredient of unit_type
     * weight, and the sub-recipe's yield unit for a sub-recipe.
     */
    quantityMilliBase: milliBase('quantity_milli_base').notNull(),
    wastageMillipercent: millipercent('wastage_millipercent').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('recipe_lines_tenant_recipe_idx').on(t.tenantId, t.recipeId),
    // Reverse lookup: what consumes this sub-recipe. Cycle detection walks it, and so
    // does "this sub-recipe recosted, what else moved".
    //
    // There is deliberately NO matching index on ingredient_id. The butter-price demo
    // scans this table by ingredient, but a catalogue is hundreds of lines, not
    // millions, and Postgres seq-scans that in microseconds. Add the index when a
    // measurement asks for it, not before.
    index('recipe_lines_tenant_sub_recipe_idx').on(t.tenantId, t.subRecipeId),
    foreignKey({
      columns: [t.tenantId, t.recipeId],
      foreignColumns: [recipes.tenantId, recipes.id],
      name: 'recipe_lines_tenant_recipe_fk',
    }),
    foreignKey({
      columns: [t.tenantId, t.ingredientId],
      foreignColumns: [ingredients.tenantId, ingredients.id],
      name: 'recipe_lines_tenant_ingredient_fk',
    }),
    foreignKey({
      columns: [t.tenantId, t.subRecipeId],
      foreignColumns: [recipes.tenantId, recipes.id],
      name: 'recipe_lines_tenant_sub_recipe_fk',
    }),
    // XOR, in the database rather than in application code. `<>` on two booleans is
    // exclusive-or in Postgres, and null-safe here because `is null` never yields
    // null.
    check(
      'recipe_lines_exactly_one_source',
      sql`(${t.ingredientId} is null) <> (${t.subRecipeId} is null)`,
    ),
    // The one-step cycle, caught declaratively. Deeper cycles still need the
    // recursive CTE at save time — this is not a substitute for it, it is the
    // trivial case never reaching the CTE at all.
    check('recipe_lines_no_self_reference', sql`${t.subRecipeId} is distinct from ${t.recipeId}`),
    check('recipe_lines_qty_positive', sql`${t.quantityMilliBase} > 0`),
    // 0-100%. Above 100% the line consumes more than double its own quantity, which
    // is a typo (30 entered for 3.0) far more often than it is a recipe.
    check(
      'recipe_lines_wastage_range',
      sql`${t.wastageMillipercent} >= 0 and ${t.wastageMillipercent} <= 100000`,
    ),
    // NO duplicate-line unique index, deliberately. Butter in the dough and butter
    // in the topping is a normal recipe, and a chef entering from a written card
    // will hit it. Blocking a legitimate entry is the worse failure; a duplicate
    // costs the same either way. Accidental double entry is a UI concern.
  ],
);

export const menuItems = pgTable(
  'menu_items',
  {
    id: id(),
    // Deviation 6 drops the redundant direct FK to tenants wherever a composite FK
    // already guarantees the tenant exists. It is KEPT here on purpose: that guarantee
    // holds only while recipe_id is NOT NULL, because a composite FK is MATCH SIMPLE
    // and stops being enforced the moment one of its columns is null. If the resale-item
    // question makes recipe_id nullable, this FK is the only thing left tying a menu
    // item to a real tenant.
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    // NOT NULL for now. Resale items with no recipe (bottled water, canned drinks,
    // packaged snacks) are an OPEN QUESTION with the client — see PROGRESS.md. The
    // answer decides whether costing needs a second branch; nothing is built for it.
    recipeId: uuid('recipe_id').notNull(),
    /**
     * How much of the recipe's yield one sold portion takes. A cinnamon-roll recipe
     * yielding 12 units sells at portion 1000 (one unit); a chai recipe yielding
     * 5 litres sells at portion 250000 (250 ml).
     *
     * Without it, "recipe cost" and "item cost" are the same number and every batch
     * recipe has to be rewritten as a per-portion one.
     */
    portionQtyMilliBase: milliBase('portion_qty_milli_base').notNull(),
    // Whole paise. Money the customer hands over, not a rate — the same boundary
    // rule as stock_movements.total_cost_paise.
    sellingPricePaise: paise('selling_price_paise').notNull(),
    // Distinct from deleted_at: off the menu today is not gone forever.
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('menu_items_tenant_name_uq')
      .on(t.tenantId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index('menu_items_tenant_active_idx').on(t.tenantId, t.isActive),
    // "This recipe recosted, which menu items moved."
    index('menu_items_tenant_recipe_idx').on(t.tenantId, t.recipeId),
    foreignKey({
      columns: [t.tenantId, t.recipeId],
      foreignColumns: [recipes.tenantId, recipes.id],
      name: 'menu_items_tenant_recipe_fk',
    }),
    check('menu_items_portion_positive', sql`${t.portionQtyMilliBase} > 0`),
    // Zero is legal — staff meals, samples. Negative is not.
    check('menu_items_price_nonneg', sql`${t.sellingPricePaise} >= 0`),
  ],
);
