import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IngredientFields, ingredientFormInput } from './ingredient-form.ts';

const raw = (lowStockThreshold: string, purchaseUnitInBase = 1) => IngredientFields.parse({
  name: 'Flour', brand: null, unitType: 'weight', purchaseUnit: 'g', purchaseUnitInBase, lowStockThreshold,
});
test('ingredient thresholds preserve fractional purchase quantities, explicit zero and the exact safe limit', () => {
  assert.equal(ingredientFormInput(raw('0.125', 1000)).lowStockThresholdMilliBase, 125000);
  assert.equal(ingredientFormInput(raw('')).lowStockThresholdMilliBase, 0);
  assert.equal(ingredientFormInput(raw('0')).lowStockThresholdMilliBase, 0);
  assert.equal(ingredientFormInput(raw('9007199254740.991')).lowStockThresholdMilliBase, Number.MAX_SAFE_INTEGER);
});
test('invalid ingredient thresholds fail before a database write instead of rounding or reaching a check constraint', () => {
  assert.throws(() => ingredientFormInput(raw('-1')), /zero or more/);
  assert.throws(() => ingredientFormInput(raw('9007199254740.993')), /too large to record exactly/);
  assert.throws(() => ingredientFormInput(raw('0.0001')), /more precise/);
  assert.throws(() => raw('1'.repeat(25)), /too long/);
  assert.throws(() => raw('0', 0));
  assert.throws(() => raw('0', 9007199254740992));
});
