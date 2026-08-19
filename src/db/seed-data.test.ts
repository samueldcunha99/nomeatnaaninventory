import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_INGREDIENTS, SEED_SUPPLIERS, unitCostMillipaisePerBase } from './seed-data.ts';

test('every seed price divides exactly into millipaise per base unit', () => {
  // If this fails the seed would have to round, and rounding lives in one place only.
  for (const i of SEED_INGREDIENTS) {
    assert.doesNotThrow(() => unitCostMillipaisePerBase(i), i.name);
  }
});

test('millipaise actually buys the precision it exists for', () => {
  const salt = SEED_INGREDIENTS.find((i) => i.name === 'Salt')!;
  // Rs 22/kg -> 2.2 paise/g. Whole paise would store 2 - a 9% error on every recipe.
  assert.equal(unitCostMillipaisePerBase(salt), 2200);

  const maida = SEED_INGREDIENTS.find((i) => i.name === 'Maida (refined flour)')!;
  assert.equal(unitCostMillipaisePerBase(maida), 4200); // 4.2 paise/g, not 4

  const eggs = SEED_INGREDIENTS.find((i) => i.name === 'Eggs')!;
  assert.equal(unitCostMillipaisePerBase(eggs), 700000); // Rs 210/tray of 30 = Rs 7/egg

  const cheapest = Math.min(...SEED_INGREDIENTS.map(unitCostMillipaisePerBase));
  assert.ok(cheapest < 10_000, 'seed must include an ingredient under 10 paise per base unit');
});

test('seed data satisfies the schema check constraints', () => {
  for (const i of SEED_INGREDIENTS) {
    assert.ok(i.purchaseUnitInBase > 0, `${i.name}: purchase_unit_in_base must be > 0`);
    assert.ok(i.lowStockQty >= 0, `${i.name}: threshold must be >= 0`);
    assert.ok(i.openingQty > 0, `${i.name}: purchase quantity must be > 0`);
    assert.ok(i.pricePaise > 0, `${i.name}: purchase cost must be > 0`);
    assert.ok(i.supplier in SEED_SUPPLIERS, `${i.name}: unknown supplier "${i.supplier}"`);
  }
});

test('ingredient names are unique case-insensitively', () => {
  const seen = new Set<string>();
  for (const i of SEED_INGREDIENTS) {
    const key = i.name.toLowerCase();
    assert.ok(!seen.has(key), `duplicate ingredient name: ${i.name}`);
    seen.add(key);
  }
  assert.ok(SEED_INGREDIENTS.length >= 30, `expected ~30 ingredients, got ${SEED_INGREDIENTS.length}`);
});
