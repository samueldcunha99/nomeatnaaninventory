'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '../../../src/auth/server.ts';
import { listIngredients, DuplicateIngredientError } from '../../../src/db/ingredients.ts';
import { saveStockImport, StockImportSubmission } from '../../../src/db/stock-import.ts';
import { parseStockImport, matchStockImport, STOCK_IMPORT_BYTES, StockImportMode,
  type StockImportRow, type ImportIssue } from '../../../src/lib/stock-import.ts';

export type PreviewState = { error: string | null; issues: ImportIssue[]; preview?: {
  id: string; csv: string; filename: string; mode: StockImportMode; reference: string;
  rows: StockImportRow[]; expectedIds: (string | null)[];
} };
export type ImportState = { error: string | null; previewId?: string; result?: { created: number; stockLines: number; replayed: boolean } };
const Settings = z.object({ mode: StockImportMode, reference: z.string().trim().max(120) });

export async function previewStockImportAction(_previous: PreviewState, form: FormData): Promise<PreviewState> {
  const actor = await requirePermission('ingredients.manage');
  const settings = Settings.safeParse({ mode: form.get('mode'), reference: form.get('reference') ?? '' });
  if (!settings.success) return { error: 'Choose the import type and a reference of at most 120 characters.', issues: [] };
  const file = form.get('file');
  if (!(file instanceof File) || !file.size || !file.name.toLowerCase().endsWith('.csv')) {
    return { error: 'Choose a CSV UTF-8 file. In Excel, use Save As and select CSV UTF-8.', issues: [] };
  }
  if (file.size > STOCK_IMPORT_BYTES) return { error: 'The CSV file is too large. Maximum size is 256 KB.', issues: [] };
  let csv: string;
  try { csv = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
  catch { return { error: 'Choose a CSV UTF-8 file. In Excel, use Save As and select CSV UTF-8.', issues: [] }; }
  try {
    const parsed = parseStockImport(csv);
    if (parsed.issues.length) return { error: 'Fix every file error and preview the file again before importing.', issues: parsed.issues };
    const ingredients = await listIngredients(actor, { activeOnly: false });
    const matches = matchStockImport(parsed.rows, ingredients);
    const issues = matches.flatMap((match, i) => match.error ? [{ row: i + 2, message: match.error }] : []);
    return { error: issues.length ? 'Fix every file error and preview the file again before importing.' : null, issues,
      preview: { id: crypto.randomUUID(), csv, filename: file.name.slice(0, 180), ...settings.data, rows: parsed.rows, expectedIds: matches.map(match => match.ingredientId) } };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { error: error.message, issues: [] };
  }
}

export async function confirmStockImportAction(_previous: ImportState, form: FormData): Promise<ImportState> {
  const actor = await requirePermission('ingredients.manage');
  const previewId = String(form.get('previewId') ?? '');
  try {
    const rawIds = String(form.get('expectedIds') ?? '');
    if (rawIds.length > 5000) return { previewId, error: 'Fix every file error and preview the file again before importing.' };
    let expectedIds: unknown;
    try { expectedIds = JSON.parse(rawIds); } catch { return { previewId, error: 'Fix every file error and preview the file again before importing.' }; }
    const input = StockImportSubmission.safeParse({ csv: form.get('csv'), mode: form.get('mode'), reference: form.get('reference') ?? '', expectedIds });
    if (!input.success) return { previewId, error: 'Fix every file error and preview the file again before importing.' };
    // Reparse on the server. The preview's rows, totals and ingredient IDs are claims, never trusted data.
    const result = await saveStockImport(actor, input.data);
    for (const path of ['/ingredients', '/stock/history', '/stock/low', '/recipes', '/reports', '/']) revalidatePath(path);
    return { error: null, previewId, result };
  } catch (error) {
    if (error instanceof RangeError || error instanceof DuplicateIngredientError) return { previewId, error: error.message };
    throw error;
  }
}
