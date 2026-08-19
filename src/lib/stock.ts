/**
 * Weighted average cost and stock state. Pure - no database, no I/O.
 *
 * ONE implementation of this arithmetic, used by both paths that maintain stock:
 * the incremental cache update on every movement insert, and recalculateStock()
 * rebuilding from the ledger. They cannot disagree arithmetically because they run
 * the same fold; the only way the cache can diverge from the ledger is a write that
 * never happened, which is what the database-level test checks.
 */
import { divRoundHalfUp } from './units.ts';

export type MovementType = 'purchase' | 'adjustment' | 'wastage' | 'consumption' | 'reversal';

export type Movement = {
  movementType: MovementType;
  /** signed, milli-base. positive in, negative out. */
  quantityMilliBase: bigint;
  /** required on purchases, forbidden on everything else */
  unitCostMillipaisePerBase?: bigint | null;
};

export type StockState = {
  qtyMilliBase: bigint;
  weightedAvgCostMillipaisePerBase: bigint;
};

export const EMPTY_STOCK: StockState = { qtyMilliBase: 0n, weightedAvgCostMillipaisePerBase: 0n };

/**
 * new_avg = (old_qty * old_avg + in_qty * in_price) / (old_qty + in_qty)
 *
 * Only purchases move the average. Adjustment, wastage, consumption and reversal
 * change quantity and leave the average exactly as it was.
 *
 * When old_qty <= 0 the average is simply the incoming price. This is not a rounding
 * nicety: with negative stock the formula subtracts a phantom quantity of value and
 * returns an average ABOVE every price ever paid (-500 @ 51875 buying 2000 @ 60000
 * gives 62708). Every subsequent recipe would cost more than the ingredient does.
 */
export function applyMovement(state: StockState, m: Movement): StockState {
  const qtyMilliBase = state.qtyMilliBase + m.quantityMilliBase;

  if (m.movementType !== 'purchase') {
    if (m.unitCostMillipaisePerBase != null) {
      throw new RangeError(`${m.movementType} movements must not carry a unit cost`);
    }
    return { qtyMilliBase, weightedAvgCostMillipaisePerBase: state.weightedAvgCostMillipaisePerBase };
  }

  const inPrice = m.unitCostMillipaisePerBase;
  if (inPrice == null) throw new RangeError('purchase movements require a unit cost');
  if (inPrice < 0n) throw new RangeError('unit cost cannot be negative');
  if (m.quantityMilliBase <= 0n) throw new RangeError('purchase quantity must be positive');

  if (state.qtyMilliBase <= 0n) {
    return { qtyMilliBase, weightedAvgCostMillipaisePerBase: inPrice };
  }

  const numerator =
    state.qtyMilliBase * state.weightedAvgCostMillipaisePerBase + m.quantityMilliBase * inPrice;
  return {
    qtyMilliBase,
    weightedAvgCostMillipaisePerBase: divRoundHalfUp(numerator, qtyMilliBase),
  };
}

/** Rebuild stock state from the full ledger, oldest movement first. */
export function replayLedger(movements: readonly Movement[]): StockState {
  return movements.reduce(applyMovement, EMPTY_STOCK);
}
