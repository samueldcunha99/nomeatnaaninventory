/**
 * Movement history and low stock. Read-only, both of them.
 *
 * There is no update or delete here and there never should be: a correction is a new
 * movement (PROJECT-SPEC 2.5). If a screen ever needs to "fix" a movement, it wants
 * recordCorrection() in src/db/movements.ts instead.
 */
import { and, asc, desc, eq, gte, lte, isNull, sql as raw } from 'drizzle-orm';
import { db } from './client.ts';
import { stockMovements, ingredients, ingredientStock, users, suppliers } from './schema.ts';
import { assertPermission, type Actor } from '../lib/auth.ts';
import type { UnitType } from '../lib/units.ts';

export const HISTORY_PAGE_SIZE = 50;

export type MovementRow = {
  seq: number;
  id: string;
  createdAt: Date;
  movementType: 'purchase' | 'adjustment' | 'wastage' | 'consumption' | 'reversal';
  quantityMilliBase: number;
  unitCostMillipaisePerBase: number | null;
  totalCostPaise: number | null;
  reason: string | null;
  note: string | null;
  referenceType: string | null;
  referenceId: string | null;
  ingredientId: string;
  ingredientName: string;
  unitType: UnitType;
  purchaseUnit: string;
  purchaseUnitInBase: number;
  userName: string | null;
  supplierName: string | null;
  /** stock after this movement, in ledger order */
  balanceMilliBase: number;
};

export type HistoryFilter = {
  ingredientId?: string;
  /** inclusive, interpreted as a UTC instant by the caller */
  from?: Date;
  /** exclusive */
  to?: Date;
  page?: number;
};

const MOVEMENT_COLUMNS = {
  seq: stockMovements.seq,
  id: stockMovements.id,
  createdAt: stockMovements.createdAt,
  movementType: stockMovements.movementType,
  quantityMilliBase: stockMovements.quantityMilliBase,
  unitCostMillipaisePerBase: stockMovements.unitCostMillipaisePerBase,
  totalCostPaise: stockMovements.totalCostPaise,
  reason: stockMovements.reason,
  note: stockMovements.note,
  referenceType: stockMovements.referenceType,
  referenceId: stockMovements.referenceId,
  ingredientId: stockMovements.ingredientId,
  // Aliased: three joined tables each expose a `name`, and duplicate output columns
  // make the enclosing subquery ambiguous.
  ingredientName: raw<string>`${ingredients.name}`.as('ingredient_name'),
  unitType: ingredients.unitType,
  purchaseUnit: ingredients.purchaseUnit,
  purchaseUnitInBase: ingredients.purchaseUnitInBase,
  userName: raw<string | null>`${users.name}`.as('user_name'),
  supplierName: raw<string | null>`${suppliers.name}`.as('supplier_name'),
};

/** Running total over one ingredient's ledger, in seq order. */
const BALANCE = raw<number>`sum(${stockMovements.quantityMilliBase}) over (
  order by ${stockMovements.seq}
  rows between unbounded preceding and current row
)`;

/**
 * One page of the ledger, newest first.
 *
 * A running balance is only meaningful within a single ingredient - across a mixed list
 * it would be adding grams of salt to millilitres of milk - so it is computed ONLY when
 * the filter names one ingredient, and the column is hidden otherwise.
 *
 * When it is computed, the window runs over that ingredient's entire ledger and the date
 * filter is applied OUTSIDE it, in the enclosing query. Putting the date filter alongside
 * the window would make the balance restart at the beginning of the filtered range - it
 * would read like a stock level while actually being a subtotal, which is worse than
 * showing nothing at all.
 *
 * ponytail: the windowed branch scans one ingredient's whole ledger per page view - the
 * same cost as a replay, ~87 ms at 50k rows. Acceptable for a screen someone opens
 * deliberately; the snapshot work blocking Module 4 gives this a cheaper start too.
 */
export async function listMovements(actor: Actor, filter: HistoryFilter = {}) {
  assertPermission(actor.role, 'ingredients.view');

  const page = Math.max(1, Math.floor(filter.page ?? 1));
  const offset = (page - 1) * HISTORY_PAGE_SIZE;
  const limit = HISTORY_PAGE_SIZE + 1; // one extra row tells us whether a next page exists
  const showBalance = Boolean(filter.ingredientId);

  let rows: MovementRow[];

  if (filter.ingredientId) {
    const ledger = db
      .select({ ...MOVEMENT_COLUMNS, balanceMilliBase: BALANCE.as('balance_milli_base') })
      .from(stockMovements)
      .innerJoin(
        ingredients,
        and(eq(ingredients.tenantId, stockMovements.tenantId), eq(ingredients.id, stockMovements.ingredientId)),
      )
      .leftJoin(
        users,
        and(eq(users.tenantId, stockMovements.tenantId), eq(users.id, stockMovements.createdByUserId)),
      )
      .leftJoin(
        suppliers,
        and(eq(suppliers.tenantId, stockMovements.tenantId), eq(suppliers.id, stockMovements.supplierId)),
      )
      // Deliberately no date filter here: the window must see the whole ledger.
      .where(
        and(eq(stockMovements.tenantId, actor.tenantId), eq(stockMovements.ingredientId, filter.ingredientId)),
      )
      .as('ledger');

    rows = (await db
      .select()
      .from(ledger)
      .where(
        and(
          filter.from ? gte(ledger.createdAt, filter.from) : undefined,
          filter.to ? lte(ledger.createdAt, filter.to) : undefined,
        ),
      )
      .orderBy(desc(ledger.seq))
      .limit(limit)
      .offset(offset)) as MovementRow[];

    // sum() over a bigint yields numeric, which postgres.js hands back as a STRING.
    // Left alone, balanceMilliBase would be typed number and compared lexicographically
    // at every call site. Normalised once, here. Milli-base balances are far inside
    // Number's exact range.
    rows = rows.map((r) => ({ ...r, balanceMilliBase: Number(r.balanceMilliBase) }));
  } else {
    // No balance column, so no window, so no reason to scan beyond the page.
    const plain = await db
      .select(MOVEMENT_COLUMNS)
      .from(stockMovements)
      .innerJoin(
        ingredients,
        and(eq(ingredients.tenantId, stockMovements.tenantId), eq(ingredients.id, stockMovements.ingredientId)),
      )
      .leftJoin(
        users,
        and(eq(users.tenantId, stockMovements.tenantId), eq(users.id, stockMovements.createdByUserId)),
      )
      .leftJoin(
        suppliers,
        and(eq(suppliers.tenantId, stockMovements.tenantId), eq(suppliers.id, stockMovements.supplierId)),
      )
      .where(
        and(
          eq(stockMovements.tenantId, actor.tenantId),
          filter.from ? gte(stockMovements.createdAt, filter.from) : undefined,
          filter.to ? lte(stockMovements.createdAt, filter.to) : undefined,
        ),
      )
      .orderBy(desc(stockMovements.seq))
      .limit(limit)
      .offset(offset);

    rows = plain.map((r) => ({ ...r, balanceMilliBase: 0 })) as MovementRow[];
  }

  // Newest-first is right for the ledger overall, but within a single multi-line receipt
  // (shared referenceId), lines read in entry order (ascending seq).
  //
  // Slice to the page FIRST, then reorder. Reordering the fetched rows before slicing
  // permutes across the page boundary: when a receipt group straddles it, one line shows
  // on both pages and another disappears from the ledger view entirely. Page membership
  // must stay decided by the query's seq ordering, which is what OFFSET agrees with.
  return {
    rows: orderGroupLines(rows.slice(0, HISTORY_PAGE_SIZE)),
    page,
    pageSize: HISTORY_PAGE_SIZE,
    hasNextPage: rows.length > HISTORY_PAGE_SIZE,
    hasPreviousPage: page > 1,
    showBalance,
  };
}

/**
 * Preserves newest-first ordering for the ledger overall, but within a single
 * multi-line receipt (shared referenceId), orders lines in ascending entry order (seq).
 */
export function orderGroupLines(rows: MovementRow[]): MovementRow[] {
  const result: MovementRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const ref = rows[i].referenceId;
    if (!ref) {
      result.push(rows[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].referenceId === ref) {
      j++;
    }
    const group = rows.slice(i, j).sort((a, b) => a.seq - b.seq);
    result.push(...group);
    i = j;
  }
  return result;
}

/**
 * How many separate DELIVERIES were recorded since an instant - not how many lines.
 *
 * A receipt is one delivery however many ingredients arrived on it, and every line of it
 * shares a reference_id (see recordReceipt). Counting rows would report a five-line
 * delivery as five, which is not what anybody at the counter means by "deliveries today".
 *
 * The coalesce covers a purchase written without a reference: it then counts as a
 * delivery of its own rather than collapsing every such row into a single null group.
 */
export async function countDeliveriesSince(actor: Actor, from: Date): Promise<number> {
  assertPermission(actor.role, 'ingredients.view');

  const [row] = await db
    .select({
      deliveries: raw<string>`count(distinct coalesce(${stockMovements.referenceId}::text, ${stockMovements.id}::text))`,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.tenantId, actor.tenantId),
        eq(stockMovements.movementType, 'purchase'),
        gte(stockMovements.createdAt, from),
      ),
    );

  // count() is bigint, which the driver hands back as a string. AGENTS.md, Aggregates
  // come back as strings.
  return Number(row?.deliveries ?? 0);
}

export type LowStockRow = {
  ingredientId: string;
  name: string;
  unitType: UnitType;
  purchaseUnit: string;
  purchaseUnitInBase: number;
  qtyMilliBase: number;
  lowStockThresholdMilliBase: number;
  weightedAvgCostMillipaisePerBase: number;
};

/**
 * Ingredients at or below their threshold, worst first.
 *
 * "Worst" is the shortfall as a fraction of the threshold, not the raw gap: being 2 kg
 * short of a 3 kg threshold is more urgent than being 2 kg short of a 50 kg one, and
 * sorting by the absolute gap would bury the first behind the second. Anything oversold
 * (negative stock) sorts to the top by construction.
 *
 * Ingredients with a zero threshold are only listed once actually negative - otherwise
 * every ingredient nobody has set a threshold for would sit permanently in the list and
 * the list would stop being read.
 */
export async function listLowStock(actor: Actor): Promise<LowStockRow[]> {
  assertPermission(actor.role, 'ingredients.view');

  const severity = raw<number>`(${ingredients.lowStockThresholdMilliBase} - ${ingredientStock.qtyMilliBase})::numeric
    / greatest(${ingredients.lowStockThresholdMilliBase}, 1)`;

  const rows = await db
    .select({
      ingredientId: ingredients.id,
      name: ingredients.name,
      unitType: ingredients.unitType,
      purchaseUnit: ingredients.purchaseUnit,
      purchaseUnitInBase: ingredients.purchaseUnitInBase,
      qtyMilliBase: ingredientStock.qtyMilliBase,
      lowStockThresholdMilliBase: ingredients.lowStockThresholdMilliBase,
      weightedAvgCostMillipaisePerBase: ingredientStock.weightedAvgCostMillipaisePerBase,
    })
    .from(ingredients)
    .innerJoin(
      ingredientStock,
      and(
        eq(ingredientStock.tenantId, ingredients.tenantId),
        eq(ingredientStock.ingredientId, ingredients.id),
      ),
    )
    .where(
      and(
        eq(ingredients.tenantId, actor.tenantId),
        eq(ingredients.isActive, true),
        isNull(ingredients.deletedAt),
        raw`${ingredientStock.qtyMilliBase} <= ${ingredients.lowStockThresholdMilliBase}`,
        raw`(${ingredients.lowStockThresholdMilliBase} > 0 or ${ingredientStock.qtyMilliBase} < 0)`,
      ),
    )
    .orderBy(desc(severity), asc(raw`lower(${ingredients.name})`));

  return rows as LowStockRow[];
}
