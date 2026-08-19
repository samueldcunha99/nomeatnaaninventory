/**
 * The input and display boundary. Everything between these two functions works in
 * integers only - see the header of src/db/schema.ts for the three scales.
 *
 * All arithmetic here is BigInt. Not caution for its own sake: the weighted-average
 * numerator reaches ~5e12 for a hundred kilos of butter and grows with catalogue size,
 * and a silent float rounding inside a costing chain is precisely the failure mode
 * that produces confident, clean-looking, wrong numbers.
 */

export type UnitType = 'weight' | 'volume' | 'count';

/** Base unit label, derived - deliberately not a stored column. */
export function baseUnitLabel(unitType: UnitType): string {
  return { weight: 'g', volume: 'ml', count: 'unit' }[unitType];
}

/**
 * Half-up division for NON-NEGATIVE numerators. Exact, no floats.
 *
 * Never call this on a signed quantity: half-up and half-away-from-zero disagree
 * below zero, and rounding a quantity at all would deplete stock that was never used.
 * Quantities are exact by construction; only costs are ever rounded.
 */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('divRoundHalfUp: denominator must be positive');
  if (numerator < 0n) throw new RangeError('divRoundHalfUp: refusing to round a negative value');
  return (2n * numerator + denominator) / (2n * denominator);
}

/**
 * Parse an operator-typed decimal into a scaled integer, EXACTLY.
 *
 * Throws rather than rounds when the entry is finer than the scale can hold. Silently
 * truncating an operator's input is how a system starts disagreeing with the shelf.
 */
export function parseDecimalToInteger(input: string, scale: bigint): bigint {
  const text = input.trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new RangeError(`"${input}" is not a decimal number`);
  const [, sign, whole, frac = ''] = m;

  const digits = BigInt(whole + frac);
  const divisor = 10n ** BigInt(frac.length);
  const numerator = digits * scale;
  if (numerator % divisor !== 0n) {
    throw new RangeError(`"${input}" is more precise than this field can store exactly`);
  }
  const value = numerator / divisor;
  return sign === '-' ? -value : value;
}

/** "2.5" kg with purchase_unit_in_base 1000 -> 2_500_000 milli-base. */
export function purchaseUnitsToMilliBase(input: string, purchaseUnitInBase: number): bigint {
  if (!Number.isInteger(purchaseUnitInBase) || purchaseUnitInBase <= 0) {
    throw new RangeError('purchase_unit_in_base must be a positive integer');
  }
  return parseDecimalToInteger(input, BigInt(purchaseUnitInBase) * 1000n);
}

/** "0.4" g -> 400 milli-base. */
export function baseUnitsToMilliBase(input: string): bigint {
  return parseDecimalToInteger(input, 1000n);
}

/** "450.01" -> 45001 paise. */
export function rupeesToPaise(input: string): bigint {
  return parseDecimalToInteger(input, 100n);
}

/**
 * What one base unit cost, from what was actually paid for the whole lot.
 *   total_cost_paise x 1000 (to millipaise) x 1000 (milli-base -> base) / qty_milli_base
 * This is the one place a purchase price gets rounded, and it happens once.
 */
export function unitCostMillipaisePerBase(totalCostPaise: bigint, qtyMilliBase: bigint): bigint {
  if (qtyMilliBase <= 0n) throw new RangeError('cannot derive a unit cost from a non-positive quantity');
  if (totalCostPaise < 0n) throw new RangeError('total cost cannot be negative');
  return divRoundHalfUp(totalCostPaise * 1_000_000n, qtyMilliBase);
}

/**
 * Stored cost is millipaise per BASE unit; nobody thinks in paise per gram. This turns
 * it into whole paise per purchase unit - "what a kilo costs" - rounding half-up once,
 * here, at the display boundary.
 *
 * Components must call this rather than doing the multiply inline. An ad-hoc conversion
 * in a component is a second rounding site, and the two will disagree.
 */
export function costPerPurchaseUnitPaise(
  millipaisePerBase: number | bigint,
  purchaseUnitInBase: number | bigint,
): bigint {
  const rate = BigInt(millipaisePerBase);
  const per = BigInt(purchaseUnitInBase);
  if (rate < 0n) throw new RangeError('cost cannot be negative');
  if (per <= 0n) throw new RangeError('purchase_unit_in_base must be positive');
  return divRoundHalfUp(rate * per, 1000n);
}

/**
 * The inverse of purchaseUnitsToMilliBase: back to a decimal string in purchase units,
 * for putting a stored value into a form field. Exact - no float, no rounding - because
 * a value that survives a round trip through an edit form must come back unchanged.
 */
export function milliBaseToPurchaseUnits(
  milliBase: number | bigint,
  purchaseUnitInBase: number,
): string {
  if (!Number.isInteger(purchaseUnitInBase) || purchaseUnitInBase <= 0) {
    throw new RangeError('purchase_unit_in_base must be a positive integer');
  }
  const scale = BigInt(purchaseUnitInBase) * 1000n;
  const v = BigInt(milliBase);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / scale;
  const rem = abs % scale;
  if (rem === 0n) return `${neg ? '-' : ''}${whole}`;
  // Longest exact decimal the scale can produce, then trim.
  const frac = ((rem * 10n ** 9n) / scale).toString().padStart(9, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** True when an ingredient is at or below its reorder threshold. */
export function isLowStock(qtyMilliBase: number | bigint, thresholdMilliBase: number | bigint): boolean {
  return BigInt(qtyMilliBase) <= BigInt(thresholdMilliBase);
}

/** 34999 -> "₹349.99". The only place paise become rupees. */
export function formatINR(paise: number | bigint): string {
  const v = BigInt(paise);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const rupees = abs / 100n;
  const sub = abs % 100n;
  // Indian digit grouping: last three, then pairs. 1234567 -> 12,34,567
  const s = rupees.toString();
  const head = s.length > 3 ? s.slice(0, -3) : '';
  const grouped =
    (head ? head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + s.slice(-3);
  return `${neg ? '-' : ''}₹${grouped}.${sub.toString().padStart(2, '0')}`;
}

/** 2_500_000 milli-base, weight -> "2500 g". Trailing zeros trimmed. */
export function formatQty(milliBase: number | bigint, unitType: UnitType): string {
  const v = BigInt(milliBase);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / 1000n;
  const frac = (abs % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''} ${baseUnitLabel(unitType)}`;
}
