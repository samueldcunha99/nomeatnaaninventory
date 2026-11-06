import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateNetRevenue, summarizeSales, type SaleSnapshot } from './sales-report.ts';
import { salesReportCsv } from './sales-csv.ts';
import { translator } from './i18n/index.ts';

const sale = (overrides: Partial<SaleSnapshot> = {}): SaleSnapshot => ({ id: 'one', orderNumber: 1, status: 'completed', subtotalPaise: 100n,
  totalPaise: 105n, cancelledAfterPreparation: false, lines: [{ menuItemId: 'brownie', nameSnapshot: 'Brownie', quantity: 2,
    lineTotalPaise: 100n, costSnapshotPaise: 25n }], ...overrides });

test('inclusive-tax allocation preserves every paise and deterministic largest remainders', () => {
  assert.deepEqual(allocateNetRevenue(2n, [1n, 1n, 1n]), [1n, 1n, 0n]);
  assert.deepEqual(allocateNetRevenue(0n, [0n, 0n]), [0n, 0n]);
  assert.deepEqual(allocateNetRevenue(9007199254740991n, [9007199254740991n]), [9007199254740991n]);
  assert.throws(() => allocateNetRevenue(1n, [0n]), RangeError);
  assert.throws(() => allocateNetRevenue(1n, [-1n, 2n]), RangeError);
});

test('sales count completed snapshots, keep unknowns, rank volume separately, and report refunds separately', () => {
  const other = sale({ id: 'two', lines: [{ menuItemId: 'chai', nameSnapshot: 'Chai', quantity: 5, lineTotalPaise: 100n, costSnapshotPaise: null }] });
  const report = summarizeSales([sale(), other, sale({ status: 'ordered' }), sale({ status: 'cancelled', cancelledAfterPreparation: true }),
    sale({ status: 'cancelled', cancelledAfterPreparation: false })], [{ eventType: 'payment', amountPaise: 210n }, { eventType: 'refund', amountPaise: 10n }]);
  assert.equal(report.completedCount, 2); assert.equal(report.openCount, 1); assert.equal(report.cancelledCount, 2);
  assert.equal(report.revenuePaise, 200n); assert.equal(report.costPaise, null); assert.equal(report.marginPaise, null);
  assert.equal(report.soldQuantity, 7n); assert.equal(report.cancelledMaterialPaise, 25n);
  assert.equal(report.netReceivedPaise, 200n); assert.equal(report.byVolume[0].name, 'Chai');
  assert.equal(report.byMargin.length, 1); assert.equal(report.byMargin[0].marginPaise, 75n);
  const free = summarizeSales([sale({ subtotalPaise: 0n, totalPaise: 0n, lines: [{ ...sale().lines[0], lineTotalPaise: 0n, costSnapshotPaise: 0n }] })], []);
  assert.equal(free.marginPaise, 0n, 'a recorded zero cost is known');
});

test('sales CSV exports exact signed values, formula-safe saved names, and localized unknowns', () => {
  const report = { from: '2026-11-06', to: '2026-11-06', ...summarizeSales([sale({ lines: [{ ...sale().lines[0], nameSnapshot: '=HYPERLINK("secret")', costSnapshotPaise: 150n }] })], []) };
  const en = salesReportCsv(report, 'en');
  assert.ok(en.startsWith('\uFEFF')); assert.ok(en.includes('"-0.5"')); assert.ok(en.includes('"\'=HYPERLINK(""secret"")"'));
  assert.ok(!en.includes('0.5000000000000001'));
  const unknown = { ...report, ...summarizeSales([sale({ lines: [{ ...sale().lines[0], costSnapshotPaise: null }] })], []) };
  for (const locale of ['hi', 'mr'] as const) {
    const label = translator(locale)('Unknown'); assert.notEqual(label, 'Unknown');
    assert.ok(salesReportCsv(unknown, locale).includes(label));
  }
});
