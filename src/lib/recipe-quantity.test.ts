import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipeQuantity, changeRecipeQuantityUnit } from './recipe-quantity.ts';

test('metric recipe input stores the same batch and ingredient quantities', () => {
  assert.equal(parseRecipeQuantity('2.933', 'kg', 'weight'), 2933000n);
  assert.equal(parseRecipeQuantity('2933', 'g', 'weight'), 2933000n);
  assert.equal(parseRecipeQuantity('1.45', 'kg', 'weight'), 1450000n);
  assert.equal(parseRecipeQuantity('0.8', 'l', 'volume'), 800000n);
  assert.equal(parseRecipeQuantity('800', 'ml', 'volume'), 800000n);
  assert.equal(parseRecipeQuantity('9', 'unit', 'count'), 9000n);
});

test('a display-unit change preserves exact quantities through repeated edits', () => {
  assert.equal(changeRecipeQuantityUnit('1450', 'g', 'kg'), '1.45');
  assert.equal(changeRecipeQuantityUnit('1.45', 'kg', 'g'), '1450');
  assert.equal(changeRecipeQuantityUnit('0.001', 'g', 'kg'), '0.000001');
  assert.equal(changeRecipeQuantityUnit('0.000001', 'kg', 'g'), '0.001');
  assert.equal(changeRecipeQuantityUnit('0.8', 'l', 'ml'), '800');
  assert.equal(changeRecipeQuantityUnit('', 'g', 'kg'), '');
  assert.throws(() => changeRecipeQuantityUnit('1.', 'g', 'kg'), RangeError);
});

test('server input refuses a selected unit of the wrong measurement type', () => {
  assert.throws(() => parseRecipeQuantity('800', 'ml', 'weight'), /weight unit/);
  assert.throws(() => parseRecipeQuantity('800', 'g', 'volume'), /volume unit/);
  assert.throws(() => parseRecipeQuantity('9', 'kg', 'count'), /count unit/);
  assert.throws(() => changeRecipeQuantityUnit('800', 'g', 'ml'), /volume unit/);
});

test('metric input rejects finer-than-storage quantities and unsafe integers', () => {
  assert.throws(() => parseRecipeQuantity('0.0001', 'g', 'weight'), /more precise/);
  assert.throws(() => parseRecipeQuantity('0.0000001', 'kg', 'weight'), /more precise/);
  assert.throws(() => parseRecipeQuantity('9007199254.740992', 'kg', 'weight'), /too large/);
  assert.equal(parseRecipeQuantity('9007199254.740991', 'kg', 'weight'), 9007199254740991n);
  assert.throws(() => parseRecipeQuantity('10', 'cup' as never, 'volume'), /Choose/);
});
