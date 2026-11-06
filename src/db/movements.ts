/**
 * Stock receipts, adjustments and wastage.
 *
 * Every write goes through recordMovements(). There is no arithmetic here beyond
 * deriving a purchase's unit cost with the shared helper - the ledger fold, the cache
 * update and the audit entry all belong to recordMovements, and adding a second route
 * to any of them is how the cache starts disagreeing with the ledger.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql as raw } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './client.ts';
import { suppliers, stockMovements } from './schema.ts';
import { lockIngredients, recalculateStock, recordMovements, type MovementInput } from './stock.ts';
import { unitCostMillipaisePerBase } from '../lib/units.ts';
import { assertPermission, AuthzError, type Actor } from '../lib/auth.ts';

/** Lives here rather than in its own module: the receipt form is its only consumer. */
export async function listSuppliers(actor: Actor) {
  assertPermission(actor.role, 'stock.record');
  return db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, actor.tenantId), isNull(suppliers.deletedAt)))
    .orderBy(asc(suppliers.name));
}

export type ReceiptLine = {
  ingredientId: string;
  /** positive, milli-base, already converted at the input boundary */
  quantityMilliBase: bigint;
  /** whole paise actually paid for this line */
  totalCostPaise: bigint;
};

export type ReceiptInput = {
  /** Stable for one rendered receipt, including retries after a lost response. */
  requestId?: string;
  supplierId?: string | null;
  note?: string | null;
  lines: ReceiptLine[];
};

function storedInteger(value: bigint, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label} is too large to record exactly.`);
  return result;
}

/**
 * A multi-line delivery. All lines share one reference_id so the receipt can be seen
 * as one event later, and all of them land in a single transaction - a bad line rolls
 * the whole receipt back rather than half-recording a delivery.
 */
export async function recordReceipt(actor: Actor, input: ReceiptInput) {
  assertPermission(actor.role, 'stock.record');
  return recordValuedInflow(actor, input, 'receipt');
}

/** An opening valuation is a priced inflow, distinguished from a new purchase in all reports. */
export async function recordOpeningStock(actor: Actor, input: ReceiptInput) {
  assertPermission(actor.role, 'ingredients.manage');
  return recordValuedInflow(actor, input, 'opening_stock');
}

async function recordValuedInflow(actor: Actor, input: ReceiptInput, referenceType: 'receipt' | 'opening_stock') {
  if (input.lines.length === 0) throw new AuthzError('A receipt needs at least one line.');
  if (referenceType === 'opening_stock' && new Set(input.lines.map(line => line.ingredientId)).size !== input.lines.length) {
    throw new RangeError('Enter each ingredient once when recording opening stock.');
  }

  const referenceId = z.uuid().parse(input.requestId ?? randomUUID());
  const lines: MovementInput[] = input.lines.map((line) => {
    if (line.quantityMilliBase <= 0n) throw new RangeError('Received quantity must be more than zero.');
    if (line.totalCostPaise < 0n) throw new RangeError('Cost paid cannot be negative.');
    return {
      tenantId: actor.tenantId,
      ingredientId: line.ingredientId,
      movementType: 'purchase',
      quantityMilliBase: storedInteger(line.quantityMilliBase, 'Received quantity'),
      // The one rounding in this path, via the shared helper.
      unitCostMillipaisePerBase: storedInteger(
        unitCostMillipaisePerBase(line.totalCostPaise, line.quantityMilliBase), 'Unit cost',
      ),
      totalCostPaise: storedInteger(line.totalCostPaise, 'Cost paid'),
      supplierId: referenceType === 'receipt' ? input.supplierId || null : null,
      referenceType,
      referenceId,
      note: input.note?.trim() || null,
      createdByUserId: actor.id,
    };
  });

  return db.transaction(async tx => {
    // Lock the submission before looking for it. Concurrent retries then see the first
    // transaction's committed group. Ingredient locks still belong to recordMovements.
    await tx.execute(raw`select pg_advisory_xact_lock(hashtextextended(${`receipt:${actor.tenantId}:${referenceId}`}, 0))`);
    const previous = await tx.select().from(stockMovements).where(and(
      eq(stockMovements.tenantId, actor.tenantId), inArray(stockMovements.referenceType, ['receipt', 'opening_stock']),
      eq(stockMovements.referenceId, referenceId),
    )).orderBy(asc(stockMovements.seq));
    if (previous.length) {
      const inflows = previous.filter(row => row.movementType === 'purchase');
      const identical = previous.every(row => row.referenceType === referenceType) && inflows.length === lines.length && inflows.every((saved, i) => {
        const line = lines[i];
        return saved.movementType === 'purchase' && saved.ingredientId === line.ingredientId &&
          saved.quantityMilliBase === line.quantityMilliBase && saved.totalCostPaise === line.totalCostPaise &&
          saved.unitCostMillipaisePerBase === line.unitCostMillipaisePerBase &&
          saved.supplierId === line.supplierId && saved.note === line.note;
      });
      if (!identical) throw new RangeError('This receipt was already recorded with different details. Open a new receipt for another delivery.');
      return { referenceId, lineCount: inflows.length, replayed: true };
    }
    const resets: MovementInput[] = [];
    if (referenceType === 'opening_stock') {
      await lockIngredients(tx, actor.tenantId, lines.map(line => line.ingredientId));
      for (const line of lines) {
        const current = await recalculateStock(tx, actor.tenantId, line.ingredientId, { rebuild: true });
        if (current.weightedAvgCostMillipaisePerBase !== null) {
          throw new RangeError('This ingredient already has a recorded cost. Use receipts for new purchases instead of replacing its opening value.');
        }
        const [history] = await tx.select({ id: stockMovements.id }).from(stockMovements).where(and(
          eq(stockMovements.tenantId, actor.tenantId), eq(stockMovements.ingredientId, line.ingredientId),
        )).limit(1);
        if (history) {
          if (current.qtyMilliBase <= 0n || current.qtyMilliBase !== BigInt(line.quantityMilliBase)) {
            throw new RangeError('To value existing unknown stock, enter its current positive quantity exactly. Record any physical count correction first.');
          }
          // Quantity-neutral valuation of an UNKNOWN balance. Both entries stay in
          // history; this does not rewrite a purchase or claim another delivery arrived.
          resets.push({ tenantId: actor.tenantId, ingredientId: line.ingredientId,
            movementType: 'adjustment', quantityMilliBase: -line.quantityMilliBase,
            referenceType, referenceId, reason: 'count_correction',
            note: 'Opening stock valuation: clear unknown value before establishing the recorded basis.', createdByUserId: actor.id });
        }
      }
    }
    await recordMovements([...resets, ...lines], tx);
    return { referenceId, lineCount: lines.length, replayed: false };
  });
}

export type CorrectionInput = {
  ingredientId: string;
  /** signed, milli-base. Negative reduces stock. */
  quantityMilliBase: bigint;
  reason: 'count_correction' | 'theft' | 'spoilage' | 'expiry' | 'burnt' | 'dropped' | 'trim' | 'other';
  note?: string | null;
};

const ADJUSTMENT_REASONS = ['count_correction', 'theft', 'other'] as const;
const WASTAGE_REASONS = ['spoilage', 'expiry', 'burnt', 'dropped', 'trim', 'other'] as const;

/**
 * A manual correction. `wastage` and `adjustment` are the same shape with different
 * meanings - wastage is stock lost, an adjustment is the count being wrong - so they
 * share this function and differ only in movement type and which reasons are valid.
 *
 * The database enforces both the reason requirement and the type/reason pairing; these
 * checks exist to fail with something an operator can read rather than a constraint name.
 */
export async function recordCorrection(
  actor: Actor,
  kind: 'adjustment' | 'wastage',
  input: CorrectionInput,
) {
  assertPermission(actor.role, 'stock.record');

  if (input.quantityMilliBase === 0n) {
    throw new RangeError('A correction of zero changes nothing - enter the amount to add or remove.');
  }
  if (kind === 'wastage' && input.quantityMilliBase > 0n) {
    throw new RangeError('Wastage removes stock, so the quantity must be negative.');
  }

  const allowed: readonly string[] = kind === 'wastage' ? WASTAGE_REASONS : ADJUSTMENT_REASONS;
  if (!allowed.includes(input.reason)) {
    throw new RangeError(`"${input.reason}" is not a valid reason for ${kind}.`);
  }
  if (input.reason === 'other' && !input.note?.trim()) {
    throw new RangeError('A note is required when the reason is "other".');
  }

  const referenceId = randomUUID();
  await recordMovements([
    {
      tenantId: actor.tenantId,
      ingredientId: input.ingredientId,
      movementType: kind,
      quantityMilliBase: Number(input.quantityMilliBase),
      referenceType: kind,
      referenceId,
      reason: input.reason,
      note: input.note?.trim() || null,
      createdByUserId: actor.id,
    },
  ]);
  return { referenceId };
}

export { ADJUSTMENT_REASONS, WASTAGE_REASONS };
