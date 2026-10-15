import { z } from 'zod';
import type { Recipe } from './costing.ts';
import { parseDecimalToInteger } from './units.ts';
import { parseRecipeQuantity } from './recipe-quantity.ts';
import { istDayStart, istToday } from './time.ts';

export type ProductionRecipeOption = {
  id: string; name: string; yieldUnitType: Recipe['yieldUnitType']; yieldQtyMilliBase: string;
  stockIngredientId: string | null; updatedAt: string;
  lines: Array<{ ingredientId: string | null; subRecipeId: string | null;
    quantityMilliBase: string; wastageMillipercent: string }>;
};

export function productionGraph(options: readonly ProductionRecipeOption[]): Map<string, Recipe> {
  return new Map(options.map(r => [r.id, { ...r, yieldQtyMilliBase: BigInt(r.yieldQtyMilliBase),
    lines: r.lines.map(l => ({ ...l, quantityMilliBase: BigInt(l.quantityMilliBase),
      wastageMillipercent: BigInt(l.wastageMillipercent) })) }]));
}

const Input = z.object({
  requestId: z.string().uuid(), recipeId: z.string().uuid('Choose a recipe.'),
  recipeUpdatedAt: z.string().datetime(),
  producedOn: z.string().refine(v => Boolean(istDayStart(v)), 'Choose a valid production date.'),
  batches: z.string().trim().min(1, 'Enter how many batches were made.').max(24),
  actualYield: z.string().trim().min(1, 'Enter the measured output, including zero for a lost batch.').max(24),
  yieldUnitType: z.enum(['weight', 'volume', 'count']),
  actualUnit: z.enum(['g', 'kg', 'ml', 'l', 'unit']), note: z.string().trim().max(2000),
});

export function parseProductionForm(data: FormData, now = new Date()) {
  const parsed = Input.safeParse(Object.fromEntries(data));
  if (!parsed.success) throw new RangeError(parsed.error.issues[0].message);
  const p = parsed.data;
  if (p.producedOn > istToday(now)) throw new RangeError('Production cannot be recorded for a future day.');
  const batchesMilli = parseDecimalToInteger(p.batches, 1000n);
  if (batchesMilli <= 0n || batchesMilli > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Enter a positive batch count within the supported range.');
  const actualYieldMilliBase = parseRecipeQuantity(p.actualYield, p.actualUnit, p.yieldUnitType);
  if (actualYieldMilliBase < 0n) throw new RangeError('Measured output cannot be negative.');
  return { requestId: p.requestId, recipeId: p.recipeId, recipeUpdatedAt: p.recipeUpdatedAt,
    producedOn: p.producedOn, batchesMilli, actualYieldMilliBase, yieldUnitType: p.yieldUnitType, note: p.note };
}
