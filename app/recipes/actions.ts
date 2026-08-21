'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requirePermission } from '../../src/auth/server.ts';
import { saveRecipe, saveMenuItem, type RecipeLineInput } from '../../src/db/recipes.ts';
import { baseUnitsToMilliBase, parseDecimalToInteger, rupeesToPaise } from '../../src/lib/units.ts';

export type FormState = { error: string | null };

/**
 * A save-time refusal is the operator's to fix, and every one of these already carries a
 * sentence written for them - the loop that would be created, the line whose unit does
 * not match, the name that is taken. Anything else is a bug and keeps its stack trace.
 */
const OPERATOR_ERRORS = new Set([
  'AuthzError',
  'DuplicateRecipeError',
  'DuplicateMenuItemError',
  'UnitMismatchError',
  'RecipeCycleError',
  'RecipeDepthError',
]);

function friendly(err: unknown): string {
  if (err instanceof RangeError) return err.message;
  if (err instanceof Error && OPERATOR_ERRORS.has(err.name)) return err.message;
  throw err;
}

const UNIT = z.enum(['weight', 'volume', 'count']);

const Line = z.object({
  sourceId: z.string().uuid('Pick an ingredient or a recipe on every line that has a quantity.'),
  /**
   * What the form believes it picked. It is NOT trusted: `saveRecipe` looks the id up in
   * this tenant's ingredients or this tenant's recipes accordingly, so a wrong claim can
   * only ever produce a refusal, never a wrong write.
   */
  sourceKind: z.enum(['ingredient', 'recipe']),
  /**
   * The unit the operator was shown beside the quantity box. Submitting it is what makes
   * that label an assertion rather than decoration: if the source's unit changed while
   * the page was open, the save is refused instead of silently reinterpreting grams as
   * millilitres.
   */
  entryUnit: UNIT,
  quantity: z.string().trim().min(1, 'Every line needs a quantity.'),
  wastage: z.string().trim(),
});

const Recipe = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().trim().min(1, 'A recipe needs a name.').max(120),
  yieldUnitType: UNIT,
  yieldQty: z.string().trim().min(1, 'Enter what one batch yields.'),
  notes: z.string().trim().max(2000).nullable(),
  lines: z.array(Line).min(1, 'A recipe needs at least one line.'),
});

/**
 * `lines[3][quantity]` back into an array. Same shape as the receipt form, for the same
 * reason: the row count is whatever the operator added, so the names carry the index.
 */
function collectLines(formData: FormData): Array<Record<string, string>> {
  // A Map, NOT an array indexed by the submitted number. `raw[2_000_000_000] = {}` costs
  // nothing to send and turns the next iteration over that array into a hang - the index
  // is attacker-controlled, so it never becomes a length.
  const raw = new Map<number, Record<string, string>>();
  for (const [key, value] of formData.entries()) {
    const m = /^lines\[(\d+)]\[(\w+)]$/.exec(key);
    if (!m) continue;
    const [, index, field] = m;
    const row = raw.get(Number(index)) ?? {};
    row[field] = String(value);
    raw.set(Number(index), row);
  }
  // A row with neither a source nor a quantity is an unused row, not an error. Anything
  // half-filled IS an error, and the messages above name which half.
  return [...raw.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row)
    .filter((r) => r.sourceId?.trim() !== '' || r.quantity?.trim() !== '');
}

export async function saveRecipeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission('recipes.manage');

  const parsed = Recipe.safeParse({
    id: String(formData.get('id') ?? '') || null,
    name: formData.get('name'),
    yieldUnitType: formData.get('yieldUnitType'),
    yieldQty: formData.get('yieldQty'),
    notes: String(formData.get('notes') ?? '').trim() || null,
    lines: collectLines(formData),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let recipeId: string;
  try {
    // The input boundary: operator decimals in, exact integers out. Quantities are in the
    // source's own base unit - grams, millilitres, or a count - which is how recipes are
    // written down in the kitchen.
    const lines: RecipeLineInput[] = parsed.data.lines.map((l) => ({
      ingredientId: l.sourceKind === 'ingredient' ? l.sourceId : null,
      subRecipeId: l.sourceKind === 'recipe' ? l.sourceId : null,
      quantityMilliBase: baseUnitsToMilliBase(l.quantity),
      wastageMillipercent: l.wastage ? parseDecimalToInteger(l.wastage, 1000n) : 0n,
      entryUnitType: l.entryUnit,
    }));

    recipeId = await saveRecipe(actor, {
      id: parsed.data.id ?? undefined,
      name: parsed.data.name,
      yieldUnitType: parsed.data.yieldUnitType,
      yieldQtyMilliBase: baseUnitsToMilliBase(parsed.data.yieldQty),
      notes: parsed.data.notes,
      lines,
    });
  } catch (err) {
    // Nothing was written - the whole recipe is one transaction, and every validator
    // runs before it opens.
    return { error: friendly(err) };
  }

  revalidatePath('/recipes');
  redirect(`/recipes/${recipeId}/cost`);
}

const MenuItem = z.object({
  id: z.string().uuid().nullable(),
  recipeId: z.string().uuid('Unknown recipe.'),
  name: z.string().trim().min(1, 'A menu item needs a name.').max(120),
  portionQty: z.string().trim().min(1, 'Enter how much of the batch one portion takes.'),
  sellingPrice: z.string().trim().min(1, 'Enter a selling price.'),
  isActive: z.boolean(),
});

export async function saveMenuItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission('recipes.manage');

  const parsed = MenuItem.safeParse({
    id: String(formData.get('id') ?? '') || null,
    recipeId: formData.get('recipeId'),
    name: formData.get('name'),
    portionQty: formData.get('portionQty'),
    sellingPrice: formData.get('sellingPrice'),
    // An unchecked box submits nothing at all, which is the whole encoding.
    isActive: formData.get('isActive') !== null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await saveMenuItem(actor, {
      id: parsed.data.id ?? undefined,
      recipeId: parsed.data.recipeId,
      name: parsed.data.name,
      // A portion is measured in the recipe's yield unit, and the price is money the
      // customer hands over - whole paise, through the one helper that rounds.
      portionQtyMilliBase: baseUnitsToMilliBase(parsed.data.portionQty),
      sellingPricePaise: rupeesToPaise(parsed.data.sellingPrice),
      isActive: parsed.data.isActive,
    });
  } catch (err) {
    return { error: friendly(err) };
  }

  revalidatePath(`/recipes/${parsed.data.recipeId}/cost`);
  redirect(`/recipes/${parsed.data.recipeId}/cost`);
}
