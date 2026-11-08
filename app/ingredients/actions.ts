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
} from '../../src/db/ingredients.ts';
import { IngredientFields as Fields, ingredientFormInput as toInput } from '../../src/lib/ingredient-form.ts';

export type FormState = { error: string | null };

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
