'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '../../../src/auth/server.ts';
import { saveSalesSettings } from '../../../src/db/orders.ts';
import { parseDecimalToInteger } from '../../../src/lib/units.ts';
import { TAX_MODES } from '../../../src/lib/orders.ts';

export type SalesSettingsState = { error: string | null; ok: string | null };
const Input = z.object({ taxMode: z.enum(TAX_MODES), rate: z.string().trim().max(12, 'Tax rate is too long.') });

export async function saveSalesSettingsAction(_previous: SalesSettingsState, form: FormData): Promise<SalesSettingsState> {
  const actor = await requirePermission('sales.manage');
  const parsed = Input.safeParse({ taxMode: form.get('taxMode'), rate: String(form.get('rate') ?? '') });
  if (!parsed.success) return { error: parsed.error.issues[0].message, ok: null };
  try {
    if (parsed.data.taxMode !== 'none' && !parsed.data.rate) throw new RangeError('Enter the tax rate, or explicitly choose no tax.');
    await saveSalesSettings(actor, { taxMode: parsed.data.taxMode,
      taxRateMillipercent: parsed.data.taxMode === 'none' ? 0n : parseDecimalToInteger(parsed.data.rate, 1000n) });
  } catch (error) {
    if (error instanceof RangeError || (error instanceof Error && error.name === 'AuthzError')) return { error: error.message, ok: null };
    throw error;
  }
  revalidatePath('/settings/sales'); revalidatePath('/orders/new');
  return { error: null, ok: 'Sales settings saved.' };
}
