import type { getDailyReport } from '../db/daily-report.ts';
import { baseUnitLabel, integerToDecimal, milliBaseToBaseUnits, paiseToRupees } from './units.ts';
import { formatYieldVariance } from './daily-report.ts';
import { translator, type Locale } from './i18n/index.ts';
import { TIMEZONE } from './time.ts';

type Report = Awaited<ReturnType<typeof getDailyReport>>;
/** Decimal cells come only from exact internal formatters, never from user-entered text. */
export type CsvCell = string | { decimal: string };

function escapeCell(value: CsvCell): string {
  let text: string;
  if (typeof value === 'string') {
    // Quoting does not stop spreadsheets executing a formula. Preserve text as text,
    // including formulas hidden behind whitespace, tabs or other control characters.
    text = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(value) ? "'" + value : value;
  } else {
    text = value.decimal;
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) throw new RangeError('CSV numeric cells must contain an exact decimal.');
  }
  return '"' + text.replaceAll('"', '""') + '"';
}

/** UTF-8 BOM lets Excel recognize Hindi/Marathi; CRLF and quoted cells follow CSV rules. */
export function encodeCsv(rows: readonly (readonly CsvCell[])[]): string {
  return '\uFEFF' + rows.map(row => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}

const COLUMNS = [
  'Record type', 'Report date', 'Recipe filter', 'Recipe / item', 'Ingredient / component',
  'Type', 'Unit', 'Quantity', 'Batches', 'Recorded runs', 'Expected output', 'Measured output',
  'Yield variance', 'Recorded input cost', 'Paid', 'Supplier', 'Reason', 'Recorded by', 'Recorded at', 'Notes',
  'Status', 'Reversal reason', 'Reversed by', 'Reversed at',
] as const;
type Column = typeof COLUMNS[number];

/** Exports the same saved report snapshot as the screen; no stock or cost arithmetic. */
export function dailyReportCsv(report: Report, locale: Locale, recipeName?: string): string {
  const t = translator(locale);
  const rows: CsvCell[][] = [COLUMNS.map(column => t(column) + (column === 'Paid' || column === 'Recorded input cost' ? ' (INR)' : ''))];
  const number = (value: string): CsvCell => ({ decimal: value });
  const quantity = (value: bigint): CsvCell => number(milliBaseToBaseUnits(value));
  const cost = (value: bigint | null): CsvCell => value === null ? t('Unknown') : number(paiseToRupees(value));
  const timestamp = (value: Date) => value.toLocaleString(t.intlLocale, { timeZone: TIMEZONE, hourCycle: 'h23' });
  const add = (recordType: string, values: Partial<Record<Column, CsvCell>>) => {
    const row: Partial<Record<Column, CsvCell>> = {
      'Record type': t(recordType), 'Report date': report.day,
      'Recipe filter': recipeName ?? t('All recipes'), ...values,
    };
    rows.push(COLUMNS.map(column => row[column] ?? ''));
  };

  add('Daily report', {
    Paid: cost(report.totalPaidPaise),
    Notes: t('The recipe filter applies to production and material usage. Purchases and extra wastage show the whole day.'),
  });
  add('Daily report', {
    Notes: t('Output and costs are saved at production time. Different yield units remain separate. Input costs for prepared components and finished items are not added into one daily total.'),
  });
  for (const p of report.purchases) add('Purchased ingredients', {
    'Ingredient / component': p.name, Unit: t(baseUnitLabel(p.unitType)), Quantity: quantity(p.quantityMilliBase), Paid: cost(p.paidPaise),
  });
  for (const p of report.purchaseDetails) add('Receipt details and suppliers', {
    'Ingredient / component': p.ingredientName, Unit: t(baseUnitLabel(p.unitType)), Quantity: quantity(p.quantityMilliBase),
    Paid: cost(p.totalCostPaise), Supplier: p.supplierName ?? t('Not specified'),
    'Recorded by': p.userName ?? '', 'Recorded at': timestamp(p.createdAt),
  });
  for (const p of report.production) add('Items and batches made', {
    'Recipe / item': p.name, Unit: t(baseUnitLabel(p.unitType)), Batches: number(integerToDecimal(p.batchesMilli, 1000n)),
    'Recorded runs': number(String(p.runs)), 'Expected output': quantity(p.expectedMilliBase),
    'Measured output': quantity(p.actualMilliBase), 'Yield variance': t(formatYieldVariance(p.actualMilliBase, p.expectedMilliBase)),
    'Recorded input cost': cost(p.costPaise),
  });
  for (const u of report.usage) add('Materials used in production', {
    'Ingredient / component': u.name, Type: t(u.prepared ? 'Prepared component' : 'Ingredient'),
    Unit: t(baseUnitLabel(u.unitType)), Quantity: quantity(u.quantityMilliBase),
  });
  for (const w of report.wastage) add('Extra wastage recorded', {
    'Ingredient / component': w.ingredientName, Unit: t(baseUnitLabel(w.unitType)), Quantity: quantity(-w.quantityMilliBase),
    Reason: w.reason ? t(w.reason) : '', 'Recorded by': w.userName ?? '', 'Recorded at': timestamp(w.createdAt),
  });
  for (const run of report.runs) add('Individual production records', {
    'Recipe / item': run.recipeName, Unit: t(baseUnitLabel(run.yieldUnitType)),
    Batches: number(integerToDecimal(run.batchesMilli, 1000n)), 'Recorded runs': number('1'),
    'Expected output': quantity(run.expectedYieldMilliBase), 'Measured output': quantity(run.actualYieldMilliBase),
    'Yield variance': t(formatYieldVariance(run.actualYieldMilliBase, run.expectedYieldMilliBase)),
    'Recorded input cost': cost(run.batchCostPaise), 'Recorded by': run.userName ?? '',
    'Recorded at': timestamp(run.createdAt), Notes: run.note ?? '',
    Status: t(run.reversal ? 'Reversed' : 'Recorded'),
    'Reversal reason': run.reversal?.reason ?? '', 'Reversed by': run.reversal?.userName ?? '',
    'Reversed at': run.reversal ? timestamp(run.reversal.createdAt) : '',
  });
  return encodeCsv(rows);
}
