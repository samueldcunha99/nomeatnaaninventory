'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '../../src/auth/server.ts';
import { recordReceipt, recordCorrection } from '../../src/db/movements.ts';
import { getIngredient } from '../../src/db/ingredients.ts';
import { purchaseUnitsToMilliBase, rupeesToPaise } from '../../src/lib/units.ts';

export type FormState = { error: string | null; ok: string | null };

/** Conversion and domain failures are the operator's to fix; anything else is a bug. */
function friendly(err: unknown): string {
  if (err instanceof RangeError) return err.message;
  if (err instanceof Error && err.name === 'AuthzError') return err.message;
  throw err;
}

const Line = z.object({
  ingredientId: z.string().uuid(),
  quantity: z.string().trim().min(1),
  totalCost: z.string().trim().min(1),
  /** The pack size the form displayed. Checked, never calculated with. See staleUnit. */
  unitInBase: z.coerce.number().int().positive().optional(),
});

/**
 * "2" against a 1 kg bag is two kilos; against a 25 kg sack it is fifty. The form shows
 * which one it means, but the submission used to carry only an id and a number, so a
 * manager editing the purchase pack while a receipt sat open on another screen turned
 * that receipt into a different delivery - silently, and with a unit-cost preview that
 * had been calculated against the old pack.
 *
 * So the form states the pack it priced against and the server compares. The claim is
 * never used as a conversion factor: a tampered value can only produce this refusal.
 */
function staleUnit(claimed: number | undefined, actual: number, name: string): string | null {
  if (claimed === undefined || claimed === actual) return null;
  return (
    `"${name}" was bought in a different pack size when this page opened, and someone has ` +
    `changed it since. Nothing was saved. Reload the page and enter the delivery again so ` +
    `the quantity means what you intend.`
  );
}

const Receipt = z.object({
  supplierId: z.string().uuid().nullable(),
  note: z.string().trim().max(500).nullable(),
  lines: z.array(Line).min(1, 'Add at least one line.'),
});

export async function recordReceiptAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission('stock.record');

  const supplierId = String(formData.get('supplierId') ?? '') || null;
  const note = String(formData.get('note') ?? '').trim() || null;

  // A Map, NOT an array indexed by the submitted number. `lines[2000000000][quantity]`
  // costs nothing to send and turns the next iteration over that array into a hang - the
  // index is attacker-controlled, so it never becomes a length. Entry order is the sort.
  const raw = new Map<number, Record<string, string>>();
  for (const [key, value] of formData.entries()) {
    const m = /^lines\[(\d+)]\[(\w+)]$/.exec(key);
    if (!m) continue;
    const [, index, field] = m;
    const row = raw.get(Number(index)) ?? {};
    row[field] = String(value);
    raw.set(Number(index), row);
  }
  // A row the operator left entirely blank is not an error, it is an unused row.
  const lines = [...raw.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row)
    .filter((r) => Object.values(r).some((v) => v.trim() !== ''));

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
      const stale = staleUnit(line.unitInBase, ingredient.purchaseUnitInBase, ingredient.name);
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
  quantity: z.string().trim().min(1, 'Enter a quantity.'),
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
    const stale = staleUnit(parsed.data.unitInBase, ingredient.purchaseUnitInBase, ingredient.name);
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
