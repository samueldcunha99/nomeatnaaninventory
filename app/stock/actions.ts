'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '../../src/auth/server.ts';
import { recordReceipt, recordCorrection } from '../../src/db/movements.ts';
import { getIngredient } from '../../src/db/ingredients.ts';
import { purchaseUnitsToMilliBase, rupeesToPaise } from '../../src/lib/units.ts';
import { collectIndexedRows, isBlankRow, staleUnitMessage } from '../../src/lib/form.ts';

export type FormState = { error: string | null; ok: string | null };

/** Conversion and domain failures are the operator's to fix; anything else is a bug. */
function friendly(err: unknown): string {
  if (err instanceof RangeError) return err.message;
  if (err instanceof Error && err.name === 'AuthzError') return err.message;
  throw err;
}

/** 24 chars is past any real entry; it bounds the BigInt parse behind it. */
const DECIMAL_MAX = 24;

const Line = z.object({
  ingredientId: z.string().uuid(),
  quantity: z.string().trim().min(1).max(DECIMAL_MAX),
  totalCost: z.string().trim().min(1).max(DECIMAL_MAX),
  /** The pack size the form displayed. Checked, never calculated with. See staleUnit. */
  unitInBase: z.coerce.number().int().positive().optional(),
});

const Receipt = z.object({
  supplierId: z.string().uuid().nullable(),
  note: z.string().trim().max(500).nullable(),
  lines: z.array(Line).min(1, 'Add at least one line.'),
});

export async function recordReceiptAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission('stock.record');

  const supplierId = String(formData.get('supplierId') ?? '') || null;
  const note = String(formData.get('note') ?? '').trim() || null;

  // A row the operator left entirely blank is not an error, it is an unused row.
  const lines = collectIndexedRows(formData.entries()).filter((r) => !isBlankRow(r));

  const parsed = Receipt.safeParse({ supplierId, note, lines });
  if (!parsed.success) return { error: parsed.error.issues[0].message, ok: null };

  try {
    // Quantity is entered in the ingredient's own purchase unit, so each line needs its
    // conversion factor. Always the fetched one, never the submitted one: the form's
    // hidden unitInBase is a claim about what it displayed, and staleUnit compares it.
    const converted = [];
    for (const line of parsed.data.lines) {
      const ingredient = await getIngredient(actor, line.ingredientId);
      if (!ingredient) return { error: 'One of the ingredients no longer exists.', ok: null };
      const stale = staleUnitMessage(line.unitInBase, ingredient.purchaseUnitInBase, ingredient.name);
      if (stale) return { error: stale, ok: null };
      converted.push({
        ingredientId: line.ingredientId,
        quantityMilliBase: purchaseUnitsToMilliBase(line.quantity, ingredient.purchaseUnitInBase),
        totalCostPaise: rupeesToPaise(line.totalCost),
      });
    }

    const result = await recordReceipt(actor, {
      supplierId: parsed.data.supplierId,
      note: parsed.data.note,
      lines: converted,
    });
    revalidatePath('/ingredients');
    return { error: null, ok: `Receipt recorded: ${result.lineCount} line(s).` };
  } catch (err) {
    // Nothing was written - recordMovements runs the whole receipt in one transaction.
    return { error: friendly(err), ok: null };
  }
}

const Correction = z.object({
  kind: z.enum(['adjustment', 'wastage']),
  ingredientId: z.string().uuid('Choose an ingredient.'),
  direction: z.enum(['add', 'remove']),
  quantity: z.string().trim().min(1, 'Enter a quantity.').max(DECIMAL_MAX),
  reason: z.enum(['count_correction', 'theft', 'spoilage', 'expiry', 'burnt', 'dropped', 'trim', 'other']),
  note: z.string().trim().max(500).nullable(),
  unitInBase: z.coerce.number().int().positive().optional(),
});

export async function recordCorrectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission('stock.record');

  const parsed = Correction.safeParse({
    kind: formData.get('kind'),
    ingredientId: formData.get('ingredientId'),
    direction: formData.get('direction') ?? 'remove',
    quantity: formData.get('quantity'),
    reason: formData.get('reason'),
    note: String(formData.get('note') ?? '').trim() || null,
    unitInBase: formData.get('unitInBase') ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message, ok: null };

  try {
    const ingredient = await getIngredient(actor, parsed.data.ingredientId);
    if (!ingredient) return { error: 'That ingredient no longer exists.', ok: null };
    const stale = staleUnitMessage(parsed.data.unitInBase, ingredient.purchaseUnitInBase, ingredient.name);
    if (stale) return { error: stale, ok: null };

    const magnitude = purchaseUnitsToMilliBase(parsed.data.quantity, ingredient.purchaseUnitInBase);
    // Sign is applied here, once, from an explicit direction choice - never by asking
    // the operator to type a minus sign they will forget half the time.
    const signed = parsed.data.direction === 'remove' ? -magnitude : magnitude;

    await recordCorrection(actor, parsed.data.kind, {
      ingredientId: parsed.data.ingredientId,
      quantityMilliBase: signed,
      reason: parsed.data.reason,
      note: parsed.data.note,
    });
    revalidatePath('/ingredients');
    return { error: null, ok: `${parsed.data.kind === 'wastage' ? 'Wastage' : 'Adjustment'} recorded.` };
  } catch (err) {
    return { error: friendly(err), ok: null };
  }
}
