import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { messages } from './i18n/messages.ts';
import { isLocale, resolveLocale, translate, translateMessage, translator } from './i18n/index.ts';
import { MissingCostError, UnitMismatchError, type Recipe } from './costing.ts';
import { planDraws, planProductionRun } from './production.ts';

test('only supported language cookies are accepted, with English as the fallback', () => {
  for (const locale of ['en', 'hi', 'mr']) assert.equal(isLocale(locale), true);
  for (const value of [undefined, null, '', 'HI', 'de', '__proto__', '<script>', 'mr; path=/']) {
    assert.equal(isLocale(value), false);
    assert.equal(resolveLocale(value), 'en');
  }
});

test('Hindi and Marathi translators remain independent and preserve saved data', async () => {
  const hi = translator('hi'), mr = translator('mr');
  const [h, m] = await Promise.all([Promise.resolve(hi('Daily production')), Promise.resolve(mr('Daily production'))]);
  assert.equal(h, 'दैनिक उत्पादन'); assert.equal(m, 'दैनंदिन उत्पादन');
  assert.equal(hi.intlLocale, 'hi-IN'); assert.equal(mr.intlLocale, 'mr-IN');
  const name = 'Brownies "special" ₹150 {not_a_token}';
  assert.equal(hi(name), name); assert.equal(mr(name), name);
  assert.equal(hi('Hold {0} in stock', { '0': name }), `${name} को स्टॉक में रखें`);
  assert.equal(mr('Not costed ({0} runs)', { '0': 9007199254740993n }), 'खर्च अपूर्ण (9007199254740993 नोंदी)');
  assert.equal(translate('en', 'Hold {0} in stock', { '0': name }), `Hold ${name} in stock`);
  for (const inherited of ['__proto__', 'constructor', 'toString']) assert.equal(hi(inherited), inherited);
  assert.equal(hi.quantity(-1250n, 'count'), '-1.25 नग');
  assert.equal(mr.quantity(100001n, 'weight'), '100.001 g');
  assert.equal(translator('en').quantity(0n, 'count'), '0 unit');
});

test('every catalogue entry has both translations and valid interpolation placeholders', () => {
  assert.ok(Object.keys(messages).length > 500);
  for (const [source, pair] of Object.entries(messages)) {
    const allowed = new Set([...source.matchAll(/\{(\w+)\}/g)].map(m => m[1]));
    for (const [i, text] of pair.entries()) {
      assert.match(text, /[\u0900-\u097f]/, `Missing Devanagari translation: ${source}, ${i}`);
      for (const token of text.matchAll(/\{(\w+)\}/g)) assert.ok(allowed.has(token[1]), `Unknown placeholder ${token[1]} in ${source}`);
    }
  }
});

const walkFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walkFiles(join(directory, entry.name)) : [join(directory, entry.name)]);

test('every statically translated UI key and selectable metric label has both languages', () => {
  const required = new Set<string>([
    'Workspace', 'Inventory', 'Settings', 'Daily reports', 'Stock receipts', 'Adjustments & waste',
    'Include inactive', 'owner', 'manager', 'counter', 'kitchen', 'Receipt', 'Reversal',
    'Count correction', 'Theft', 'Other', 'Spoilage', 'Expiry', 'Burnt', 'Dropped', 'Trim',
    'Everything, including staff and hourly rates.', 'Everything except granting the owner role.',
    'Takes deliveries and records stock. No costing.', 'No workspace access yet.', 'Not changed.', 'Not added.',
    'per kg', 'per litre', 'each', 'Type to search…',
  ]);
  for (const file of [...walkFiles('app').filter(f => /\.tsx?$/.test(f)), 'src/lib/recipe-quantity.ts']) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        required.add(node.arguments[0].text.trim());
      }
      if (ts.isPropertyAssignment(node) && ['label', 'group'].includes(node.name.getText(source)) && ts.isStringLiteral(node.initializer)) {
        required.add(node.initializer.text.trim());
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          ['min', 'max', 'regex', 'refine', 'uuid'].includes(node.expression.name.text)) {
        for (const argument of node.arguments.slice(1)) {
          if (ts.isStringLiteral(argument) && /[A-Za-z]+ [A-Za-z]+/.test(argument.text)) required.add(argument.text);
        }
      }
      if (ts.isJsxText(node) && /[A-Za-z]{2}/.test(node.text)) {
        assert.ok(['ESTD. 2021', 'No Meat Naan ·', 'No Meat Naan'].includes(node.text.trim()),
          `Untranslated interface text in ${file}: ${node.text.trim()}`);
      }
      if (ts.isJsxAttribute(node) && ['title', 'alt', 'aria-label', 'placeholder'].includes(node.name.getText(source)) &&
          node.initializer && ts.isStringLiteral(node.initializer)) {
        assert.ok(!/[A-Za-z]{3}/.test(node.initializer.text), `Untranslated ${node.name.getText(source)} in ${file}`);
      }
      if (ts.isJsxAttribute(node) && ['value', 'defaultValue', 'name', 'id', 'key', 'href', 'action', 'htmlFor'].includes(node.name.getText(source))) {
        function checkValue(child: ts.Node) {
          assert.ok(!(ts.isCallExpression(child) && /^t(?:\.|$)/.test(child.expression.getText(source))),
            `Translation changes a submitted value or identity in ${file}: ${node.getText(source)}`);
          ts.forEachChild(child, checkValue);
        }
        if (node.initializer) checkValue(node.initializer);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const missing = [...required].filter(key => !Object.hasOwn(messages, key));
  assert.deepEqual(missing, [], `Missing interface translations: ${missing.join('; ')}`);
});

test('cost and unit errors retain the input names while translating their instructions', () => {
  const error = new MissingCostError([{ ingredientId: 'butter', name: 'Butter (Amul)' }, { ingredientId: 'sugar', name: 'Caster sugar' }]);
  for (const locale of ['hi', 'mr'] as const) {
    const result = translateMessage(locale, error.message);
    assert.ok(result.includes('Butter (Amul)')); assert.ok(result.includes('Caster sugar'));
    assert.ok(!result.includes('purchase history'));
    assert.notEqual(result, translate(locale, 'Please check the entered details and try again.'));
    const units = translateMessage(locale, new UnitMismatchError('weight', 'volume', 'Lemon curd').message);
    assert.ok(units.includes('Lemon curd')); assert.ok(!units.includes('weight')); assert.ok(!units.includes('volume'));
  }
});

test('production refusals keep recipe and missing ingredient names in both languages', () => {
  const graph = new Map<string, Recipe>([['dough', { id: 'dough', name: 'Dough starter', yieldUnitType: 'weight',
    yieldQtyMilliBase: 1000000n, stockIngredientId: 'shelf',
    lines: [{ ingredientId: 'flour', subRecipeId: null, quantityMilliBase: 1000000n, wastageMillipercent: 0n }] }]]);
  let error: Error | undefined;
  try { planProductionRun('dough', graph, () => { throw new MissingCostError([{ ingredientId: 'flour', name: 'Maida' }]); }, 1000n, 900000n); }
  catch (caught) { error = caught as Error; }
  assert.ok(error);
  for (const locale of ['hi', 'mr'] as const) {
    const message = translateMessage(locale, error.message);
    assert.ok(message.includes('Dough starter')); assert.ok(message.includes('Maida'));
    assert.ok(!message.includes('goes into stock'));
  }
  graph.set('dough', { ...graph.get('dough')!, stockIngredientId: '' });
  graph.set('roll', { id: 'roll', name: 'Cinnamon roll', yieldUnitType: 'count', yieldQtyMilliBase: 1000n,
    stockIngredientId: '', lines: [{ ingredientId: null, subRecipeId: 'dough', quantityMilliBase: 200000n, wastageMillipercent: 0n }] });
  assert.throws(() => planDraws('roll', graph, 1000n), caught => {
    const message = translateMessage('mr', (caught as Error).message);
    return message.includes('Dough starter') && message.includes('Cinnamon roll') && !message.includes('draws on');
  });
});

test('unknown validation details have a localized fallback, without changing English diagnostics', () => {
  assert.equal(translateMessage('en', 'Unexpected internal issue'), 'Unexpected internal issue');
  assert.equal(translateMessage('hi', 'Unexpected internal issue'), 'दर्ज की गई जानकारी जांचकर फिर कोशिश करें।');
  assert.equal(translateMessage('mr', 'Unexpected internal issue'), 'नोंदवलेली माहिती तपासून पुन्हा प्रयत्न करा.');
});

test('rendered success messages translate roles but preserve the staff member name', () => {
  const message = translate('mr', 'Asha can now sign in as manager.');
  assert.equal(message, 'Asha आता व्यवस्थापक म्हणून साइन इन करू शकतात.');
  assert.equal(translate('hi', 'Receipt recorded: 2 line(s).'), 'खरीद रसीद दर्ज हुई: 2 पंक्तियां।');
});
