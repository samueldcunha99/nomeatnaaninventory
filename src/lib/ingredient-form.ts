import { z } from 'zod';
import { purchaseUnitsToMilliBase } from './units.ts';
import type { IngredientInput } from '../db/ingredients.ts';

export const IngredientFields = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  brand: z.string().trim().max(120).nullable(),
  unitType: z.enum(['weight', 'volume', 'count']),
  purchaseUnit: z.string().trim().min(1, 'Purchase unit is required').max(40),
  purchaseUnitInBase: z.coerce.number().int('Conversion factor must be a whole number of base units')
    .positive('Conversion factor must be greater than zero'),
  lowStockThreshold: z.string().trim().max(24, 'Low-stock threshold is too long.').default('0'),
});

/** Convert exact decimal quantities before crossing into Drizzle's number-backed bigint. */
export function ingredientFormInput(raw: z.infer<typeof IngredientFields>): IngredientInput {
  const threshold = purchaseUnitsToMilliBase(raw.lowStockThreshold || '0', raw.purchaseUnitInBase);
  if (threshold < 0n) throw new RangeError('Low-stock threshold must be zero or more.');
  if (threshold > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Low-stock threshold is too large to record exactly.');
  return { name: raw.name, brand: raw.brand, unitType: raw.unitType, purchaseUnit: raw.purchaseUnit,
    purchaseUnitInBase: raw.purchaseUnitInBase, lowStockThresholdMilliBase: Number(threshold) };
}
