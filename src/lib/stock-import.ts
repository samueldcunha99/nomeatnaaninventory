import { z } from 'zod';
import { IngredientFields, ingredientFormInput } from './ingredient-form.ts';
import { purchaseUnitsToMilliBase, rupeesToPaise, unitCostMillipaisePerBase } from './units.ts';

export const STOCK_IMPORT_LIMIT = 100;
export const STOCK_IMPORT_BYTES = 256 * 1024;
export const STOCK_IMPORT_COLUMNS = ['name', 'brand', 'unit_type', 'purchase_unit', 'purchase_unit_in_base',
  'quantity', 'total_cost', 'low_stock_threshold'] as const;
export const STOCK_IMPORT_TEMPLATE = STOCK_IMPORT_COLUMNS.join(',') + '\r\n';
export const StockImportMode = z.enum(['opening', 'receipt']);
export type StockImportMode = z.infer<typeof StockImportMode>;
export type ImportIssue = { row: number; message: string };
export type StockImportRow = z.infer<typeof IngredientFields> & { quantity: string; totalCost: string };
export type ImportIngredient = { id: string; name: string; unitType: string; purchaseUnit: string;
  purchaseUnitInBase: number; isActive: boolean };

/** Strict quoted CSV, including Excel's semicolon delimiter and UTF-8 BOM. Never evaluates cells. */
function csvRows(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  if (text.length > STOCK_IMPORT_BYTES) throw new RangeError('The CSV file is too large. Maximum size is 256 KB.');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) throw new RangeError('The CSV contains unsupported control characters.');
  const header = text.split(/\r?\n/, 1)[0];
  const delimiter = header.includes(';') && !header.includes(',') ? ';' : ',';
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false;
  const addField = () => { row.push(field.trim()); field = ''; closed = false; };
  const addRow = () => { addField(); if (row.some(cell => cell !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; }
      } else field += ch;
    } else if (ch === delimiter) addField();
    else if (ch === '\n' || ch === '\r') { addRow(); if (ch === '\r' && text[i + 1] === '\n') i++; }
    else if (ch === '"' && field === '' && !closed) quoted = true;
    else if (closed && /\s/.test(ch)) continue;
    else if (closed || ch === '"') throw new RangeError('The CSV has invalid quotation marks. Save it again as CSV UTF-8.');
    else field += ch;
    if (field.length > 1000 || row.length > STOCK_IMPORT_COLUMNS.length) throw new RangeError('A CSV row has too many columns or an oversized cell.');
    if (rows.length > STOCK_IMPORT_LIMIT + 1) throw new RangeError('Import up to 100 ingredients at a time.');
  }
  if (quoted) throw new RangeError('The CSV has invalid quotation marks. Save it again as CSV UTF-8.');
  if (field || row.length || closed) addRow();
  return rows;
}

export function stockImportAmounts(row: StockImportRow) {
  if (!row.quantity && !row.totalCost) return null;
  if (!row.quantity || !row.totalCost) throw new RangeError('Enter both quantity and total cost, or leave both blank for an ingredient list.');
  const quantityMilliBase = purchaseUnitsToMilliBase(row.quantity, row.purchaseUnitInBase);
  const totalCostPaise = rupeesToPaise(row.totalCost);
  if (quantityMilliBase <= 0n) throw new RangeError('Received quantity must be more than zero.');
  if (totalCostPaise < 0n) throw new RangeError('Cost paid cannot be negative.');
  const rate = unitCostMillipaisePerBase(totalCostPaise, quantityMilliBase);
  if ([quantityMilliBase, totalCostPaise, rate].some(value => value > BigInt(Number.MAX_SAFE_INTEGER))) {
    throw new RangeError('An import quantity or cost is too large to record exactly.');
  }
  return { quantityMilliBase, totalCostPaise };
}

export function parseStockImport(csv: string): { rows: StockImportRow[]; issues: ImportIssue[] } {
  const table = csvRows(csv);
  const columns = (table.shift() ?? []).map(cell => cell.toLowerCase());
  if (columns.length !== STOCK_IMPORT_COLUMNS.length || new Set(columns).size !== columns.length ||
      STOCK_IMPORT_COLUMNS.some(key => !columns.includes(key))) {
    throw new RangeError('CSV columns do not match the template. Keep all eight column headings unchanged.');
  }
  if (!table.length) throw new RangeError('The CSV has no ingredient rows.');
  if (table.length > STOCK_IMPORT_LIMIT) throw new RangeError('Import up to 100 ingredients at a time.');
  const issues: ImportIssue[] = [], rows: StockImportRow[] = [];
  const names = new Set<string>();
  for (const [index, cells] of table.entries()) {
    const row = index + 2;
    if (cells.length !== columns.length) { issues.push({ row, message: 'This row needs all eight columns. Use the template.' }); continue; }
    const values = Object.fromEntries(columns.map((key, i) => [key, cells[i]]));
    const parsed = IngredientFields.extend({
      quantity: z.string().max(24, 'Import quantities must be at most 24 characters.'),
      totalCost: z.string().max(24, 'Import costs must be at most 24 characters.'),
    }).safeParse({ name: values.name, brand: values.brand || null, unitType: values.unit_type,
      purchaseUnit: values.purchase_unit, purchaseUnitInBase: values.purchase_unit_in_base,
      lowStockThreshold: values.low_stock_threshold || '0', quantity: values.quantity, totalCost: values.total_cost });
    if (!parsed.success) { issues.push({ row, message: 'Check the name, unit type, purchase unit, whole-number pack size and decimal values.' }); continue; }
    try {
      ingredientFormInput(parsed.data);
      stockImportAmounts(parsed.data);
      const key = parsed.data.name.toLowerCase();
      if (names.has(key)) throw new RangeError('The same ingredient appears more than once. Combine it into one row.');
      names.add(key); rows.push(parsed.data);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      issues.push({ row, message: error.message });
    }
  }
  return { rows, issues };
}

/** Names match case-insensitively within this cafe. Import never edits an existing ingredient. */
export function matchStockImport(rows: StockImportRow[], ingredients: ImportIngredient[]) {
  const byName = new Map(ingredients.map(ingredient => [ingredient.name.toLowerCase(), ingredient]));
  return rows.map(row => {
    const existing = byName.get(row.name.toLowerCase());
    let error: string | null = null;
    if (existing && !existing.isActive) error = 'This ingredient is inactive. Reactivate it before importing stock.';
    else if (existing && (existing.unitType !== row.unitType || existing.purchaseUnitInBase !== row.purchaseUnitInBase ||
        existing.purchaseUnit.toLowerCase() !== row.purchaseUnit.toLowerCase())) {
      error = 'The file measurement or purchase pack differs from the existing ingredient. Correct the file first.';
    }
    return { ingredientId: existing?.id ?? null, error };
  });
}
