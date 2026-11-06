import type { getSalesReport } from '../db/sales-report.ts';
import { encodeCsv, type CsvCell } from './report-csv.ts';
import { paiseToRupees } from './units.ts';
import { translator, type Locale } from './i18n/index.ts';

export function salesReportCsv(report: Awaited<ReturnType<typeof getSalesReport>>, locale: Locale) {
  const t = translator(locale);
  const amount = (value: bigint | null): CsvCell => value === null ? t('Unknown') : { decimal: paiseToRupees(value) };
  const rows: CsvCell[][] = [[t('Record type'), t('From'), t('To'), t('Item'), t('Servings sold'),
    t('Revenue excluding tax (₹)'), t('Recorded material cost (₹)'), t('Material margin before refunds (₹)'), t('Metric'), t('Value'), t('Unit')]];
  const metric = (label: string, value: CsvCell, unit: string) => rows.push([t('Summary'), report.from, report.to, '', '', '', '', '', t(label), value, unit]);
  metric('Completed orders', { decimal: String(report.completedCount) }, t('orders'));
  metric('Open orders', { decimal: String(report.openCount) }, t('orders'));
  metric('Cancelled orders', { decimal: String(report.cancelledCount) }, t('orders'));
  metric('Revenue excluding tax (₹)', amount(report.revenuePaise), 'INR');
  metric('Recorded material cost (₹)', amount(report.costPaise), 'INR');
  metric('Material margin before refunds (₹)', amount(report.marginPaise), 'INR');
  metric('Cancelled preparation material cost', amount(report.cancelledMaterialPaise), 'INR');
  metric('Payments recorded', amount(report.receivedPaise), 'INR');
  metric('Refunds recorded', amount(report.refundedPaise), 'INR');
  metric('Net payments recorded', amount(report.netReceivedPaise), 'INR');
  for (const item of report.byVolume) rows.push([t('Item sales'), report.from, report.to, item.name,
    { decimal: String(item.quantity) }, amount(item.revenuePaise), amount(item.costPaise), amount(item.marginPaise), '', '', 'INR']);
  return encodeCsv(rows);
}
