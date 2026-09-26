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

export type MovementType =
  | 'purchase'
  | 'production'
  | 'adjustment'
  | 'wastage'
  | 'consumption'
  | 'reversal';

/**
 * Movements that bring stock in WITH A VALUE, and so are the only ones that move the
 * weighted average.
 *
 * A delivery and a batch the kitchen made are the same event to the store: stock arrives
 * and it cost something. Dough in the fridge has a quantity and a value just as a sack of
 * flour does. So production folds through the purchase branch below, unchanged - it does
 * not get an arithmetic of its own. T18 is the test that the two cannot drift apart.
 */
const VALUED_INFLOW: ReadonlySet<MovementType> = new Set(['purchase', 'production']);

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
 * Only valued inflows - purchases and production - move the average. Adjustment,
 * wastage, consumption and reversal change quantity and leave it exactly as it was.
 *
 * When old_qty <= 0 the average is simply the incoming price. This is not a rounding
 * nicety: with negative stock the formula subtracts a phantom quantity of value and
 * returns an average ABOVE every price ever paid (-500 @ 51875 buying 2000 @ 60000
 * gives 62708). Every subsequent recipe would cost more than the ingredient does.
 */
export function applyMovement(state: StockState, m: Movement): StockState {
  const qtyMilliBase = state.qtyMilliBase + m.quantityMilliBase;

  if (!VALUED_INFLOW.has(m.movementType)) {
    if (m.unitCostMillipaisePerBase != null) {
      throw new RangeError(`${m.movementType} movements must not carry a unit cost`);
    }
    return { qtyMilliBase, weightedAvgCostMillipaisePerBase: state.weightedAvgCostMillipaisePerBase };
  }

  const inPrice = m.unitCostMillipaisePerBase;
  if (inPrice == null) throw new RangeError(`${m.movementType} movements require a unit cost`);
  if (inPrice < 0n) throw new RangeError('unit cost cannot be negative');
  if (m.quantityMilliBase <= 0n) throw new RangeError(`${m.movementType} quantity must be positive`);

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

/**
 * Fold movements into stock state, oldest first.
 *
 * `from` is what makes snapshotting possible without a second implementation of the
 * arithmetic: a full rebuild folds the whole ledger from EMPTY_STOCK, and the
 * incremental path folds only the movements after the cached watermark, starting from
 * the cached state. Same reduce, same applyMovement, so the two cannot disagree about a
 * number - which is the property AGENTS.md 'One implementation of the cost arithmetic'
 * exists to protect, and the reason snapshotting was always going to be safe to add.
 */
export function replayLedger(
  movements: readonly Movement[],
  from: StockState = EMPTY_STOCK,
): StockState {
  return movements.reduce(applyMovement, from);
}
