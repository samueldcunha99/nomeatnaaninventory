'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requirePermission } from '../../src/auth/server.ts';
import {
  createIngredient,
  updateIngredient,
  setIngredientActive,
  DuplicateIngredientError,
  type IngredientInput,
} from '../../src/db/ingredients.ts';
import { purchaseUnitsToMilliBase } from '../../src/lib/units.ts';

export type FormState = { error: string | null };

const Fields = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  // Blank is a real answer: plenty of the masala is bought loose from a bulk trader.
  brand: z.string().trim().max(120).nullable(),
  unitType: z.enum(['weight', 'volume', 'count']),
  purchaseUnit: z.string().trim().min(1, 'Purchase unit is required').max(40),
  purchaseUnitInBase: z.coerce
    .number()
    .int('Conversion factor must be a whole number of base units')
    .positive('Conversion factor must be greater than zero'),
  // Kept as text so it reaches purchaseUnitsToMilliBase as a decimal string. Parsing it
  // to a float here would reintroduce exactly the rounding the boundary rule forbids.
  lowStockThreshold: z.string().trim().default('0'),
});

/** The input boundary: operator decimals in, exact integers out. */
function toInput(raw: z.infer<typeof Fields>): IngredientInput {
  return {
    name: raw.name,
    brand: raw.brand,
    unitType: raw.unitType,
    purchaseUnit: raw.purchaseUnit,
    purchaseUnitInBase: raw.purchaseUnitInBase,
    lowStockThresholdMilliBase: Number(
      purchaseUnitsToMilliBase(raw.lowStockThreshold || '0', raw.purchaseUnitInBase),
    ),
  };
}

function parse(formData: FormData) {
  return Fields.safeParse({
    name: formData.get('name'),
    brand: String(formData.get('brand') ?? '').trim() || null,
    unitType: formData.get('unitType'),
    purchaseUnit: formData.get('purchaseUnit'),
    purchaseUnitInBase: formData.get('purchaseUnitInBase'),
    lowStockThreshold: formData.get('lowStockThreshold'),
  });
}

/** Conversion and duplicate-name failures are the operator's problem to fix, not a 500. */
function friendly(err: unknown): string {
  if (err instanceof DuplicateIngredientError) return err.message;
  if (err instanceof RangeError) return err.message;
  throw err;
}

export async function createIngredientAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission('ingredients.manage');
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await createIngredient(actor, toInput(parsed.data));
  } catch (err) {
    return { error: friendly(err) };
  }
  revalidatePath('/ingredients');
  redirect('/ingredients');
}

export async function updateIngredientAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission('ingredients.manage');
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Unknown ingredient.' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await updateIngredient(actor, id.data, toInput(parsed.data));
  } catch (err) {
    return { error: friendly(err) };
  }
  revalidatePath('/ingredients');
  redirect('/ingredients');
}

export async function setActiveAction(formData: FormData) {
  const actor = await requirePermission('ingredients.manage');
  const id = z.string().uuid().parse(formData.get('id'));
  const isActive = formData.get('isActive') === 'true';
  await setIngredientActive(actor, id, isActive);
  revalidatePath('/ingredients');
}
