import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseUnitLabel,
  divRoundHalfUp,
  parseDecimalToInteger,
  integerToDecimal,
  purchaseUnitsToMilliBase,
  baseUnitsToMilliBase,
  rupeesToPaise,
  unitCostMillipaisePerBase,
  formatINR,
  formatQty,
  costPerPurchaseUnitPaise,
  milliBaseToPurchaseUnits,
  milliBaseToBaseUnits,
  millipercentToPercent,
  paiseToRupees,
  isLowStock,
} from './units.ts';

test('base unit label is derived from unit type', () => {
  assert.equal(baseUnitLabel('weight'), 'g');
  assert.equal(baseUnitLabel('volume'), 'ml');
  assert.equal(baseUnitLabel('count'), 'unit');
});

test('half-up rounding, including exact ties', () => {
  assert.equal(divRoundHalfUp(95_001_000n, 2000n), 47501n); // 47500.5 -> up, not to even
  assert.equal(divRoundHalfUp(330_000_000n, 7000n), 47143n); // 47142.857
  assert.equal(divRoundHalfUp(295_000_000n, 5800n), 50862n); // 50862.068
  assert.equal(divRoundHalfUp(415_000_000n, 8000n), 51875n); // exact, must not drift
  assert.equal(divRoundHalfUp(3n, 2n), 2n); // 1.5 -> 2
  assert.equal(divRoundHalfUp(1n, 2n), 1n); // 0.5 -> 1
  assert.equal(divRoundHalfUp(0n, 2n), 0n);
});

test('rounding refuses negative values outright', () => {
  // Half-up and half-away-from-zero disagree below zero. Quantities are signed and
  // are never rounded; this guard is what stops one being passed in by accident.
  assert.throws(() => divRoundHalfUp(-1n, 2n), RangeError);
  assert.throws(() => divRoundHalfUp(1n, 0n), RangeError);
});

test('decimals parse exactly, at any scale', () => {
  assert.equal(parseDecimalToInteger('2.5', 1000n), 2500n);
  assert.equal(parseDecimalToInteger('0', 1000n), 0n);
  assert.equal(parseDecimalToInteger('-1.25', 100n), -125n);
  assert.equal(parseDecimalToInteger('1000000', 1n), 1_000_000n);
});

test('an entry finer than the scale is rejected, never rounded away', () => {
  assert.throws(() => rupeesToPaise('10.001'), RangeError); // paise is the floor
  assert.throws(() => baseUnitsToMilliBase('0.0001'), RangeError); // milli-base is the floor
  assert.throws(() => rupeesToPaise('abc'), RangeError);
  assert.throws(() => rupeesToPaise('1e5'), RangeError);
  assert.throws(() => rupeesToPaise(''), RangeError);
});

test('purchase units convert to milli-base', () => {
  assert.equal(purchaseUnitsToMilliBase('2.5', 1000), 2_500_000n); // 2.5 kg -> 2500 g
  assert.equal(purchaseUnitsToMilliBase('1', 30), 30_000n); // 1 tray of 30 eggs
  assert.equal(purchaseUnitsToMilliBase('0.0004', 1000), 400n); // 0.4 g of salt
  assert.throws(() => purchaseUnitsToMilliBase('1', 0), RangeError);
  assert.throws(() => purchaseUnitsToMilliBase('1', 1.5), RangeError);
});

test('rupees convert to paise', () => {
  assert.equal(rupeesToPaise('450.01'), 45001n);
  assert.equal(rupeesToPaise('2500'), 250000n);
  assert.equal(rupeesToPaise('0.05'), 5n);
});

test('unit cost derivation rejects impossible inputs', () => {
  assert.equal(unitCostMillipaisePerBase(250000n, 5_000_000n), 50000n);
  assert.throws(() => unitCostMillipaisePerBase(1000n, 0n), RangeError);
  assert.throws(() => unitCostMillipaisePerBase(1000n, -5n), RangeError);
  assert.throws(() => unitCostMillipaisePerBase(-1n, 1000n), RangeError);
});

test('formatINR groups in the Indian convention', () => {
  assert.equal(formatINR(34999), '₹349.99');
  assert.equal(formatINR(0), '₹0.00');
  assert.equal(formatINR(5), '₹0.05');
  assert.equal(formatINR(100000), '₹1,000.00');
  assert.equal(formatINR(15000000), '₹1,50,000.00'); // the project fee, not ₹150,000.00
  assert.equal(formatINR(-34999), '-₹349.99');
});

test('formatQty trims trailing zeros and keeps the base unit', () => {
  assert.equal(formatQty(2_500_000n, 'weight'), '2500 g');
  assert.equal(formatQty(400n, 'weight'), '0.4 g');
  assert.equal(formatQty(1500n, 'weight'), '1.5 g');
  assert.equal(formatQty(30_000n, 'count'), '30 unit');
  assert.equal(formatQty(-1_350_000n, 'weight'), '-1350 g'); // oversold reads correctly
});

test('stored cost converts to what a purchase unit costs', () => {
  // butter 50000 millipaise/g, bought by the kg -> Rs 500.00/kg
  assert.equal(costPerPurchaseUnitPaise(50_000, 1000), 50_000n);
  assert.equal(formatINR(costPerPurchaseUnitPaise(50_000, 1000)), '₹500.00');
  // salt 2200 millipaise/g -> Rs 22.00/kg. The canary survives the display boundary.
  assert.equal(formatINR(costPerPurchaseUnitPaise(2200, 1000)), '₹22.00');
  // eggs 700000 millipaise/unit, bought by the tray of 30 -> Rs 210.00/tray
  assert.equal(formatINR(costPerPurchaseUnitPaise(700_000, 30)), '₹210.00');
  assert.equal(costPerPurchaseUnitPaise(0, 1000), 0n);
  assert.throws(() => costPerPurchaseUnitPaise(-1, 1000), RangeError);
  assert.throws(() => costPerPurchaseUnitPaise(1, 0), RangeError);
});

test('a stored quantity survives a round trip through an edit form unchanged', () => {
  for (const [text, per] of [['2.5', 1000], ['0', 1000], ['10', 1000], ['0.0004', 1000], ['1', 30], ['12.345', 1000], ['0.5', 50]] as const) {
    const stored = purchaseUnitsToMilliBase(text, per);
    const back = milliBaseToPurchaseUnits(stored, per);
    assert.equal(purchaseUnitsToMilliBase(back, per), stored, `${text} per ${per} must round trip`);
  }
  assert.equal(milliBaseToPurchaseUnits(2_500_000, 1000), '2.5');
  assert.equal(milliBaseToPurchaseUnits(0, 1000), '0');
  assert.throws(() => milliBaseToPurchaseUnits(1000, 0), RangeError);
});

test('every stored scale has an exact inverse, for putting a value back in a box', () => {
  // Each pair is a boundary the editors cross: a recipe line quantity, a wastage
  // percent, a selling price. Every one of them goes out to a form and comes back.
  for (const text of ['0', '4200', '0.4', '2160', '0.001']) {
    assert.equal(milliBaseToBaseUnits(baseUnitsToMilliBase(text)), text);
  }
  for (const text of ['0', '3', '2.5', '0.001', '100']) {
    assert.equal(millipercentToPercent(parseDecimalToInteger(text, 1000n)), text);
  }
  for (const text of ['0', '350', '450.01', '39']) {
    assert.equal(paiseToRupees(rupeesToPaise(text)), text);
  }
});

test('low stock triggers at the threshold, not below it', () => {
  assert.ok(isLowStock(1000, 1000), 'exactly at the threshold counts as low');
  assert.ok(isLowStock(999, 1000));
  assert.ok(!isLowStock(1001, 1000));
  assert.ok(isLowStock(-500, 0), 'oversold is low');
  assert.ok(isLowStock(0, 0), 'nothing on hand with no threshold set is low');
});

test('a pack size with an odd factor is the one shape that cannot round-trip', () => {
  // Pinning a known ceiling, not asserting it is desirable. A tray of 30 gives scale
  // 30000, and ten eggs is a third of a tray - no finite decimal exists, so the display
  // truncates and the truncation will not parse back. Verified unreachable through the
  // forms (see the note on integerToDecimal); this test is here so that if an importer
  // ever makes it reachable, the behaviour is already written down.
  const scale = 30_000n; // a tray of 30, in milli-base
  const tenEggs = 10_000n;
  const shown = integerToDecimal(tenEggs, scale);
  assert.equal(shown, '0.333333333');
  assert.throws(() => parseDecimalToInteger(shown, scale), /more precise/);

  // Anything whose scale is only twos and fives is exact, which is every pack the
  // forms can actually produce.
  for (const [value, s] of [[15_000n, 30_000n], [2_500_000n, 1_000_000n], [400n, 1000n]] as const) {
    assert.equal(parseDecimalToInteger(integerToDecimal(value, s), s), value);
  }
});
