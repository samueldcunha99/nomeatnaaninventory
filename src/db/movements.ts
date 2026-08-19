/**
 * Stock receipts, adjustments and wastage.
 *
 * Every write goes through recordMovements(). There is no arithmetic here beyond
 * deriving a purchase's unit cost with the shared helper - the ledger fold, the cache
 * update and the audit entry all belong to recordMovements, and adding a second route
 * to any of them is how the cache starts disagreeing with the ledger.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from './client.ts';
import { suppliers } from './schema.ts';
import { recordMovements, type MovementInput } from './stock.ts';
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
  supplierId?: string | null;
  note?: string | null;
  lines: ReceiptLine[];
};

/**
 * A multi-line delivery. All lines share one reference_id so the receipt can be seen
 * as one event later, and all of them land in a single transaction - a bad line rolls
 * the whole receipt back rather than half-recording a delivery.
 */
export async function recordReceipt(actor: Actor, input: ReceiptInput) {
  assertPermission(actor.role, 'stock.record');
  if (input.lines.length === 0) throw new AuthzError('A receipt needs at least one line.');

  const referenceId = randomUUID();
  const lines: MovementInput[] = input.lines.map((line) => {
    if (line.quantityMilliBase <= 0n) throw new RangeError('Received quantity must be more than zero.');
    if (line.totalCostPaise < 0n) throw new RangeError('Cost paid cannot be negative.');
    return {
      tenantId: actor.tenantId,
      ingredientId: line.ingredientId,
      movementType: 'purchase',
      quantityMilliBase: Number(line.quantityMilliBase),
      // The one rounding in this path, via the shared helper.
      unitCostMillipaisePerBase: Number(
        unitCostMillipaisePerBase(line.totalCostPaise, line.quantityMilliBase),
      ),
      totalCostPaise: Number(line.totalCostPaise),
      supplierId: input.supplierId || null,
      referenceType: 'receipt',
      referenceId,
      note: input.note || null,
      createdByUserId: actor.id,
    };
  });

  await recordMovements(lines);
  return { referenceId, lineCount: lines.length };
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
