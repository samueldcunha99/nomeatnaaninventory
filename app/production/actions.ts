'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '../../src/auth/server.ts';
import { recordProductionRun, stockRecipe } from '../../src/db/production.ts';
import { parseProductionForm } from '../../src/lib/production-form.ts';

export type ProductionState = { error: string | null };

function refresh() {
  for (const path of ['/production', '/reports', '/ingredients', '/stock/history', '/stock/low', '/recipes', '/']) revalidatePath(path);
}

function message(error: unknown): string {
  if (error instanceof RangeError || (error instanceof Error && [
    'NotStockedError', 'UncostedStockError', 'MissingSubRecipeError', 'UnitMismatchError', 'ProductionAlreadyRecordedError',
  ].includes(error.name))) return (error as Error).message;
  throw error;
}

export async function recordProductionAction(_state: ProductionState, data: FormData): Promise<ProductionState> {
  const actor = await requirePermission('production.record');
  let destination: `/production?${string}`;
  try {
    const input = parseProductionForm(data);
    const result = await recordProductionRun(actor, input);
    destination = `/production?day=${input.producedOn}&recorded=${result.runId}&recipeId=${input.recipeId}`;
  } catch (error) { return { error: message(error) }; }
  refresh();
  redirect(destination);
}

export async function holdRecipeAction(_state: ProductionState, data: FormData): Promise<ProductionState> {
  const actor = await requirePermission('recipes.manage');
  const parsed = z.string().uuid('Choose a recipe.').safeParse(data.get('recipeId'));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try { await stockRecipe(actor, parsed.data); }
  catch (error) { return { error: message(error) }; }
  refresh();
  redirect(`/production?recipeId=${parsed.data}`);
}
