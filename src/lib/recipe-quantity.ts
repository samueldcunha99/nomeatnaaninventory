import { integerToDecimal, purchaseUnitsToMilliBase, type UnitType } from './units.ts';

export const RECIPE_UNITS = [
  { value: 'g', label: 'g (grams)', unitType: 'weight', inBase: 1 },
  { value: 'kg', label: 'kg (kilograms)', unitType: 'weight', inBase: 1000 },
  { value: 'ml', label: 'ml (millilitres)', unitType: 'volume', inBase: 1 },
  { value: 'l', label: 'L (litres)', unitType: 'volume', inBase: 1000 },
  { value: 'unit', label: 'pieces / units', unitType: 'count', inBase: 1 },
] as const;

export type RecipeQuantityUnit = typeof RECIPE_UNITS[number]['value'];

function definition(unit: RecipeQuantityUnit) {
  const found = RECIPE_UNITS.find(u => u.value === unit);
  if (!found) throw new RangeError('Choose g, kg, ml, L or pieces.');
  return found;
}

export function recipeUnitType(unit: RecipeQuantityUnit): UnitType {
  return definition(unit).unitType;
}

export function baseRecipeUnit(type: UnitType): RecipeQuantityUnit {
  return { weight: 'g', volume: 'ml', count: 'unit' }[type] as RecipeQuantityUnit;
}

/** Input boundary: a selected metric unit becomes exact canonical milli-base. */
export function parseRecipeQuantity(input: string, unit: RecipeQuantityUnit, expected: UnitType): bigint {
  const selected = definition(unit);
  if (selected.unitType !== expected) {
    throw new RangeError(`Choose a ${expected} unit for this quantity.`);
  }
  const quantity = purchaseUnitsToMilliBase(input, selected.inBase);
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  if (quantity > limit || quantity < -limit) throw new RangeError('Quantity is too large to store exactly.');
  return quantity;
}

/** Changing g to kg (or ml to L) preserves the amount already entered. */
export function changeRecipeQuantityUnit(input: string, from: RecipeQuantityUnit, to: RecipeQuantityUnit): string {
  const target = definition(to);
  if (input.trim() === '') return input;
  const quantity = parseRecipeQuantity(input, from, target.unitType);
  return integerToDecimal(quantity, BigInt(target.inBase) * 1000n);
}
