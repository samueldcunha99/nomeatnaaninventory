'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '../../src/auth/server.ts';
import { disableRecipeStockOutput, recordProductionRun, reverseProductionRun, stockRecipe } from '../../src/db/production.ts';
import { parseProductionForm, parseProductionReversalForm } from '../../src/lib/production-form.ts';
import { istDayStart } from '../../src/lib/time.ts';

export type ProductionState = { error: string | null };

function refresh() {
  for (const path of ['/production', '/reports', '/ingredients', '/stock/history', '/stock/low', '/recipes', '/']) revalidatePath(path);
}

function message(error: unknown): string {
  if (error instanceof RangeError || (error instanceof Error && [
    'NotStockedError', 'UncostedStockError', 'MissingSubRecipeError', 'UnitMismatchError', 'ProductionAlreadyRecordedError', 'ProductionQuantityTooSmallError',
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

export async function changeRecipeStockAction(_state: ProductionState, data: FormData): Promise<ProductionState> {
  const actor = await requirePermission('recipes.manage');
  const parsed = z.object({ recipeId: z.string().uuid('Choose a recipe.'), enabled: z.enum(['on', 'off']) }).safeParse(Object.fromEntries(data));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    if (parsed.data.enabled === 'on') await stockRecipe(actor, parsed.data.recipeId);
    else await disableRecipeStockOutput(actor, parsed.data.recipeId);
  } catch (error) { return { error: message(error) }; }
  refresh();
  redirect(`/production?recipeId=${parsed.data.recipeId}`);
}

export async function reverseProductionAction(_state: ProductionState, data: FormData): Promise<ProductionState> {
  const actor = await requirePermission('production.record');
  const day = String(data.get('day') ?? '');
  const parsedDay = z.string().refine(value => Boolean(istDayStart(value))).safeParse(day);
  if (!parsedDay.success) return { error: 'Choose a valid production date.' };
  let reversalId: string;
  try { reversalId = (await reverseProductionRun(actor, parseProductionReversalForm(data))).reversalId; }
  catch (error) { return { error: message(error) }; }
  refresh();
  redirect(`/production?day=${day}&reversed=${reversalId}`);
}
