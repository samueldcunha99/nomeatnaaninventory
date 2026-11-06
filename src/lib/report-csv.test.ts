import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyReportCsv, encodeCsv } from './report-csv.ts';
import { translator } from './i18n/index.ts';

function parse(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const source = csv.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && char === '\r' && source[index + 1] === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; index++;
    } else cell += char;
  }
  assert.equal(quoted, false, 'unterminated CSV field');
  return rows;
}

type Report = Parameters<typeof dailyReportCsv>[0];
function fixture(): Report {
  const recordedAt = new Date('2026-11-06T18:00:00.000Z');
  const purchase = { id: 'receipt-line', referenceId: 'receipt', ingredientId: 'flour', ingredientName: 'Flour, "fine"',
    unitType: 'weight' as const, movementType: 'purchase' as const, quantityMilliBase: 1_234_567n,
    totalCostPaise: 9007199254740993n, supplierName: '=HYPERLINK("https://example.test")',
    userName: 'Asha', reason: null, createdAt: recordedAt };
  const run = { id: 'run', recipeId: 'brownies', recipeName: 'Brownies', producedOn: '2026-11-06',
    batchesMilli: 1500n, expectedYieldMilliBase: 30_000n, actualYieldMilliBase: 27_000n,
    yieldUnitType: 'count' as const, batchCostPaise: 12345n,
    note: '@SUM(1,2)\nSecond "line"', userName: 'Asha', createdAt: recordedAt };
  return {
    day: '2026-11-06', runs: [run],
    production: [{ recipeId: 'brownies', name: 'Brownies', unitType: 'count', runs: 1,
      batchesMilli: 1500n, expectedMilliBase: 30_000n, actualMilliBase: 27_000n, costPaise: 12345n, uncostedRuns: 0 }],
    purchases: [{ ingredientId: 'flour', name: purchase.ingredientName, unitType: 'weight', quantityMilliBase: 1_234_567n, paidPaise: purchase.totalCostPaise }],
    purchaseDetails: [purchase], totalPaidPaise: purchase.totalCostPaise,
    usage: [{ ingredientId: 'dough', name: 'Prepared dough', unitType: 'weight', prepared: true, quantity: '375125', quantityMilliBase: 375_125n }],
    wastage: [{ ...purchase, id: 'waste', referenceId: 'waste', movementType: 'wastage',
      quantityMilliBase: -1250n, totalCostPaise: null, reason: 'burnt' }],
  };
}

test('CSV quotes commas, quotes and line breaks and includes a UTF-8 marker for Excel', () => {
  const input = [['Name', 'Notes'], ['Flour, "fine"', 'First line\r\nSecond line'], ['मराठी', 'हिन्दी']];
  const output = encodeCsv(input);
  assert.equal(output.charCodeAt(0), 0xFEFF);
  assert.ok(output.endsWith('\r\n'));
  assert.deepEqual(parse(output), input);
});

test('spreadsheet formulas in saved names and notes remain literal text, including leading control characters', () => {
  const malicious = ['=1+1', '+SUM(1,2)', '-1+2', '@SUM(1,2)', '\t=HYPERLINK("https://example.test")', ' \r\n+1', '\u0000@SUM(1,2)'];
  const rows = parse(encodeCsv([malicious, ['Brownies', 'Asha', '123.45']]));
  assert.deepEqual(rows[0], malicious.map(text => "'" + text));
  assert.deepEqual(rows[1], ['Brownies', 'Asha', '123.45']);
});

test('internally formatted decimal cells stay exact and reject formula-shaped numeric input', () => {
  assert.deepEqual(parse(encodeCsv([[{ decimal: '90071992547409.93' }, { decimal: '-1.25' }, { decimal: '0' }]])),
    [['90071992547409.93', '-1.25', '0']]);
  for (const decimal of ['=1+1', '1e3', '1,000', 'NaN', '+2', '0\n=1']) {
    assert.throws(() => encodeCsv([[{ decimal }]]), RangeError);
  }
});

test('daily export includes all report panels with exact quantities, saved costs, filter scope and India timestamps', () => {
  const rows = parse(dailyReportCsv(fixture(), 'en', 'Brownies'));
  const header = rows[0];
  const at = (row: string[], name: string) => row[header.indexOf(name)];
  for (const row of rows) assert.equal(row.length, header.length, 'every row has the same columns');
  const purchase = rows.find(row => at(row, 'Record type') === 'Purchased ingredients')!;
  assert.equal(at(purchase, 'Quantity'), '1234.567');
  assert.equal(at(purchase, 'Paid (INR)'), '90071992547409.93');
  assert.equal(at(purchase, 'Unit'), 'g');
  const production = rows.find(row => at(row, 'Record type') === 'Items and batches made')!;
  assert.equal(at(production, 'Batches'), '1.5');
  assert.equal(at(production, 'Expected output'), '30');
  assert.equal(at(production, 'Measured output'), '27');
  assert.equal(at(production, 'Yield variance'), "'-10%");
  assert.equal(at(production, 'Recorded input cost (INR)'), '123.45');
  const usage = rows.find(row => at(row, 'Record type') === 'Materials used in production')!;
  assert.equal(at(usage, 'Quantity'), '375.125');
  assert.equal(at(usage, 'Type'), 'Prepared component');
  const waste = rows.find(row => at(row, 'Record type') === 'Extra wastage recorded')!;
  assert.equal(at(waste, 'Quantity'), '1.25');
  const detail = rows.find(row => at(row, 'Record type') === 'Receipt details and suppliers')!;
  assert.equal(at(detail, 'Supplier'), '\'=HYPERLINK("https://example.test")');
  assert.match(at(detail, 'Recorded at'), /23:30/);
  const run = rows.find(row => at(row, 'Record type') === 'Individual production records')!;
  assert.equal(at(run, 'Notes'), '\'@SUM(1,2)\nSecond "line"');
  for (const row of rows.slice(1)) {
    assert.equal(at(row, 'Report date'), '2026-11-06');
    assert.equal(at(row, 'Recipe filter'), 'Brownies');
  }
  assert.ok(rows.some(row => at(row, 'Notes').includes('Purchases and extra wastage show the whole day')));
});

test('unknown material costs remain unknown while a genuinely zero cost exports zero', () => {
  const report = fixture();
  report.production[0].costPaise = null;
  report.production[0].uncostedRuns = 1;
  report.runs[0].batchCostPaise = 0n;
  report.totalPaidPaise = null;
  const rows = parse(dailyReportCsv(report, 'en'));
  const typeIndex = rows[0].indexOf('Record type'), costIndex = rows[0].indexOf('Recorded input cost (INR)');
  assert.equal(rows.find(row => row[typeIndex] === 'Items and batches made')![costIndex], 'Unknown');
  assert.equal(rows.find(row => row[typeIndex] === 'Individual production records')![costIndex], '0');
  assert.equal(rows[1][rows[0].indexOf('Paid (INR)')], 'Unknown');
});

test('Hindi and Marathi exports use their interface labels while preserving recipe and staff names', () => {
  for (const locale of ['hi', 'mr'] as const) {
    const t = translator(locale);
    const rows = parse(dailyReportCsv(fixture(), locale));
    assert.ok(rows[0].includes(t('Report date')));
    assert.ok(rows[0].some(cell => /[\u0900-\u097f]/.test(cell)));
    const recipeColumn = rows[0].indexOf(t('Recipe / item'));
    const staffColumn = rows[0].indexOf(t('Recorded by'));
    const unitColumn = rows[0].indexOf(t('Unit'));
    assert.ok(rows.some(row => row[recipeColumn] === 'Brownies'));
    assert.ok(rows.some(row => row[staffColumn] === 'Asha'));
    assert.ok(rows.some(row => row[unitColumn] === t('unit')));
  }
});

test('CSV correction history identifies reversed runs and retains the reason and actor as safe text', () => {
  const report = fixture();
  report.production = []; report.usage = [];
  report.runs[0].reversal = { id: 'correction', reason: '=Unsafe user note', userName: 'Manager', createdAt: new Date('2026-11-07T00:00:00Z') };
  const rows = parse(dailyReportCsv(report, 'en'));
  const header = rows[0], row = rows.find(r => r[header.indexOf('Record type')] === 'Individual production records')!;
  assert.equal(row[header.indexOf('Status')], 'Reversed');
  assert.equal(row[header.indexOf('Reversal reason')], "'=Unsafe user note");
  assert.equal(row[header.indexOf('Reversed by')], 'Manager');
  assert.ok(!rows.some(r => r[header.indexOf('Record type')] === 'Items and batches made'));
});
