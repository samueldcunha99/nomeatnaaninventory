import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStockImport, STOCK_IMPORT_TEMPLATE, matchStockImport, stockImportAmounts } from './stock-import.ts';
import { translator } from './i18n/index.ts';
import { stockImportMessages } from './stock-import-messages.ts';

const row = 'Sugar,,weight,kg,1000,1.25,125,0.5';
const parse = (body: string) => parseStockImport(STOCK_IMPORT_TEMPLATE + body);

test('CSV stock quantities and paid money cross the exact integer boundary once', () => {
  const parsed = parse(row);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(stockImportAmounts(parsed.rows[0]), { quantityMilliBase: 1250000n, totalCostPaise: 12500n });
  assert.equal(parsed.rows[0].lowStockThreshold, '0.5');
});

test('CSV reads Excel UTF-8 BOM, semicolons, escaped quotes, commas, multiline names and final empty cells', () => {
  const csv = '\uFEFF' + STOCK_IMPORT_TEMPLATE.replaceAll(',', ';') + '"Caster; sugar ""fine""";;weight;kg;1000;1;0;\r\n';
  const parsed = parseStockImport(csv);
  assert.deepEqual(parsed.issues, []); assert.equal(parsed.rows[0].name, 'Caster; sugar "fine"');
  assert.equal(stockImportAmounts(parsed.rows[0])!.totalCostPaise, 0n);
  assert.equal(parse('"Sugar, fine\nwhite",,weight,kg,1000,,,').rows[0].name, 'Sugar, fine\nwhite');
});

test('ingredient-only file leaves cost unknown, and partial quantity/value pairs are refused', () => {
  assert.equal(stockImportAmounts(parse('Sugar,,weight,kg,1000,,,').rows[0]), null);
  for (const text of ['Sugar,,weight,kg,1000,1,,', 'Sugar,,weight,kg,1000,,0,']) {
    assert.match(parse(text).issues[0].message, /both quantity and total cost/);
  }
});

test('invalid CSV never quietly drops columns, malformed quotes, duplicate names or excessive rows', () => {
  assert.throws(() => parseStockImport('name,name\nSugar,Sugar'), /column headings/);
  assert.throws(() => parse('"Sugar,,weight,kg,1000,1,1,'), /quotation/);
  assert.throws(() => parse('"Sugar"oops,,weight,kg,1000,1,1,'), /quotation/);
  assert.equal(parse('Sugar,,weight,kg,1000,1,1').issues[0].row, 2);
  assert.match(parse(row + '\n' + row.toUpperCase()).issues[0].message, /Check the name/);
  assert.match(parse(row + '\nsugar,,weight,kg,1000,1,1,').issues[0].message, /more than once/);
  assert.throws(() => parse(Array.from({ length: 101 }, (_, i) => row.replace('Sugar', `Sugar ${i}`)).join('\n')), /100 ingredients/);
  assert.throws(() => parseStockImport('x'.repeat(256 * 1024 + 1)), /too large/);
  assert.throws(() => parse('Sugar\u0000,,weight,kg,1000,1,1,'), /control characters/);
});

test('negative, sub-milli and unsafe numbers fail before any stored number conversion', () => {
  for (const [quantity, cost, threshold] of [['-1', '1', '0'], ['0.0000001', '1', '0'],
    ['9007199254740.993', '1', '0'], ['1', '-1', '0'], ['1', '1', '-1'], ['1', '1', '9007199254740.993']]) {
    assert.equal(parse(`Sugar,,weight,kg,1000,${quantity},${cost},${threshold}`).issues.length, 1);
  }
});

test('matching refuses inactive ingredients and different displayed units or purchase packs', () => {
  const rows = parse(row).rows;
  const ingredient = { id: crypto.randomUUID(), name: 'SUGAR', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, isActive: true };
  assert.equal(matchStockImport(rows, [ingredient])[0].ingredientId, ingredient.id);
  for (const change of [{ unitType: 'volume' }, { purchaseUnit: 'bag' }, { purchaseUnitInBase: 500 }, { isActive: false }]) {
    assert.ok(matchStockImport(rows, [{ ...ingredient, ...change }])[0].error);
  }
});

test('every stock-import instruction and error has specific Hindi and Marathi translations', () => {
  for (const locale of ['hi', 'mr'] as const) {
    const t = translator(locale);
    for (const key of Object.keys(stockImportMessages)) {
      assert.notEqual(t(key), key);
      assert.notEqual(t.message(key), t('Please check the entered details and try again.'));
    }
  }
});
