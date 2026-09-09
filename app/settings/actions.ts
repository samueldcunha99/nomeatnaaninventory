'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requirePermission } from '../../src/auth/server.ts';
import { saveOverheadRates } from '../../src/db/recipes.ts';
import { rupeesToPaise } from '../../src/lib/units.ts';

export type FormState = { error: string | null };

function friendly(err: unknown): string {
  if (err instanceof RangeError) return err.message;
  if (err instanceof Error && err.name === 'AuthzError') return err.message;
  throw err;
}

/**
 * Blank is a real answer and it is NOT zero. A cafe that has not worked out its wage bill
 * gets recipe costs labelled "ingredients only"; a cafe that enters 0 is asserting that an
 * hour of somebody's time costs nothing. The screens read differently for the two, so the
 * form has to keep them apart.
 */
const Rate = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v));

const Rates = z.object({
  labour: Rate,
  kitchen: Rate,
});

export async function saveRatesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission('recipes.manage');

  const parsed = Rates.safeParse({
    labour: formData.get('labour'),
    kitchen: formData.get('kitchen'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await saveOverheadRates(actor, {
      // The one conversion, through the shared helper: rupees in, whole paise stored.
      labourPaisePerHour: parsed.data.labour === null ? null : rupeesToPaise(parsed.data.labour),
      kitchenPaisePerHour: parsed.data.kitchen === null ? null : rupeesToPaise(parsed.data.kitchen),
    });
  } catch (err) {
    return { error: friendly(err) };
  }

  // Every recipe cost in the tenant just changed, so nothing cached about them survives.
  revalidatePath('/recipes', 'layout');
  revalidatePath('/');
  redirect('/recipes');
}
