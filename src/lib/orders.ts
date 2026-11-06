/** Order planning and tax arithmetic. No database, network or side effects. */
import { divRoundHalfUp, type UnitType } from './units.ts';
import { WASTAGE_SCALE, MissingSubRecipeError, type Recipe } from './costing.ts';
import { type Draw, NotStockedError, ProductionQuantityTooSmallError } from './production.ts';

export const ORDER_TYPES = ['dine_in', 'takeaway', 'delivery'] as const;
export type OrderType = typeof ORDER_TYPES[number];
export const ORDER_STATUSES = ['ordered', 'in_kitchen', 'baking', 'out_of_oven', 'ready', 'out_for_delivery', 'completed', 'cancelled'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];
export const TAX_MODES = ['none', 'exclusive', 'inclusive'] as const;
export type TaxMode = typeof TAX_MODES[number];
export type FulfillmentMode = 'stocked' | 'made_to_order';
export type PaymentMethod = 'cash' | 'external';
export type PaymentStatus = 'unpaid' | 'part_paid' | 'paid' | 'part_refunded' | 'refunded';
export const MAX_ORDER_PAISE = BigInt(Number.MAX_SAFE_INTEGER);

/** Inclusive menu prices are split into net subtotal + tax; exclusive prices add tax. */
export function calculateOrderTotals(menuAmountPaise: bigint, taxMode: TaxMode | null, taxRateMillipercent: bigint | null) {
  if (taxMode == null || taxRateMillipercent == null) throw new RangeError('Configure sales tax before taking orders.');
  if (menuAmountPaise < 0n || menuAmountPaise > MAX_ORDER_PAISE) throw new RangeError('The order amount is too large or negative.');
  if (taxRateMillipercent < 0n || taxRateMillipercent > 100000n || (taxMode === 'none' && taxRateMillipercent !== 0n)) throw new RangeError('Choose a valid sales tax mode and rate.');
  let subtotalPaise = menuAmountPaise, taxPaise = 0n, totalPaise = menuAmountPaise;
  if (taxMode === 'exclusive') { taxPaise = divRoundHalfUp(menuAmountPaise * taxRateMillipercent, 100000n); totalPaise += taxPaise; }
  else if (taxMode === 'inclusive') { taxPaise = divRoundHalfUp(menuAmountPaise * taxRateMillipercent, 100000n + taxRateMillipercent); subtotalPaise -= taxPaise; }
  else if (taxMode !== 'none') throw new RangeError('Choose a valid sales tax mode and rate.');
  if (totalPaise > MAX_ORDER_PAISE) throw new RangeError('The order amount is too large or negative.');
  return { subtotalPaise, taxPaise, totalPaise };
}

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  ordered: ['in_kitchen', 'ready', 'cancelled'],
  in_kitchen: ['ordered', 'baking', 'ready', 'cancelled'],
  baking: ['in_kitchen', 'out_of_oven', 'cancelled'],
  out_of_oven: ['baking', 'ready', 'cancelled'],
  ready: ['in_kitchen', 'out_for_delivery', 'completed', 'cancelled'],
  out_for_delivery: ['ready', 'completed', 'cancelled'],
  completed: [], cancelled: [],
};
export function allowedOrderStatuses(status: OrderStatus, orderType: OrderType): OrderStatus[] {
  return [...TRANSITIONS[status]].filter(next => next !== 'out_for_delivery' || orderType === 'delivery');
}
export function assertOrderTransition(from: OrderStatus, to: OrderStatus, orderType: OrderType, reason?: string | null) {
  if (!allowedOrderStatuses(from, orderType).includes(to)) throw new RangeError('That order status change is not allowed. Refresh the order and choose an available action.');
  const backward = ORDER_STATUSES.indexOf(to) < ORDER_STATUSES.indexOf(from);
  if ((to === 'cancelled' || backward) && !reason?.trim()) throw new RangeError('Enter a reason for cancelling or moving an order backwards.');
  return { backward };
}

export type OrderMenuSnapshot = {
  id: string; name: string; recipeId: string; portionQtyMilliBase: bigint;
  sellingPricePaise: bigint; fulfillmentMode: FulfillmentMode | null;
};

/** Scale a portion as an exact rational; never approximate a fractional batch first. */
export function planOrderLine(item: OrderMenuSnapshot, quantity: number, graph: ReadonlyMap<string, Recipe>) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) throw new RangeError('Enter a whole item quantity between 1 and 1000.');
  if (item.portionQtyMilliBase <= 0n) throw new RangeError(`"${item.name}" needs a positive serving quantity.`);
  if (item.sellingPricePaise < 0n) throw new RangeError(`"${item.name}" has an invalid selling price.`);
  const recipe = graph.get(item.recipeId);
  if (!recipe) throw new RangeError(`"${item.name}" uses an unavailable recipe. Choose another item.`);
  const outputMilliBase = item.portionQtyMilliBase * BigInt(quantity);
  const draws: Draw[] = [];
  if (item.fulfillmentMode === 'stocked') {
    if (!recipe.stockIngredientId) throw new RangeError(`"${item.name}" must have prepared stock configured before it can be sold from stock.`);
    draws.push({ ingredientId: recipe.stockIngredientId, issuedMilliBase: outputMilliBase,
      source: { kind: 'sub-recipe', recipeId: recipe.id, name: recipe.name } });
  } else if (item.fulfillmentMode === 'made_to_order') {
    if (recipe.stockIngredientId) throw new RangeError(`"${item.name}" is held in prepared stock. Change its menu stock policy before taking orders.`);
    if (!recipe.lines.length) throw new RangeError(`"${item.name}" has no ingredient lines. Complete its recipe before taking orders.`);
    for (const [index, line] of recipe.lines.entries()) {
      const issued = divRoundHalfUp(line.quantityMilliBase * outputMilliBase * (WASTAGE_SCALE + line.wastageMillipercent), recipe.yieldQtyMilliBase * WASTAGE_SCALE);
      if (issued <= 0n) throw new ProductionQuantityTooSmallError(recipe.name, index + 1);
      if (line.ingredientId) draws.push({ ingredientId: line.ingredientId, issuedMilliBase: issued, source: { kind: 'ingredient' } });
      else {
        const sub = graph.get(line.subRecipeId!);
        if (!sub) throw new MissingSubRecipeError(line.subRecipeId!, [recipe.name]);
        if (!sub.stockIngredientId) throw new NotStockedError(`"${sub.name}" must be held in stock and its batches recorded before taking this order.`);
        draws.push({ ingredientId: sub.stockIngredientId, issuedMilliBase: issued,
          source: { kind: 'sub-recipe', recipeId: sub.id, name: sub.name } });
      }
    }
  } else throw new RangeError(`Choose whether "${item.name}" is sold from prepared stock or made to order before taking orders.`);
  const lineTotalPaise = item.sellingPricePaise * BigInt(quantity);
  if (lineTotalPaise > MAX_ORDER_PAISE) throw new RangeError('The order amount is too large or negative.');
  return { menuItem: item, quantity, yieldUnitType: recipe.yieldUnitType as UnitType, outputMilliBase, draws, lineTotalPaise };
}

export function summarizePayments(totalPaise: bigint, events: readonly { eventType: string; amountPaise: bigint }[]) {
  if (totalPaise < 0n || totalPaise > MAX_ORDER_PAISE) throw new RangeError('The order amount is too large or negative.');
  let receivedPaise = 0n, refundedPaise = 0n;
  for (const event of events) {
    if (event.amountPaise <= 0n || event.amountPaise > MAX_ORDER_PAISE) throw new RangeError('A recorded payment or refund must have a positive amount.');
    if (event.eventType === 'payment') receivedPaise += event.amountPaise;
    else if (event.eventType === 'refund') refundedPaise += event.amountPaise;
    else throw new RangeError('Choose a payment or refund event.');
  }
  const paidPaise = receivedPaise - refundedPaise, balancePaise = totalPaise - paidPaise;
  if (paidPaise < 0n || balancePaise < 0n) throw new RangeError('Recorded payments do not match the order balance. Ask the owner to review them.');
  const paymentStatus: PaymentStatus = paidPaise === totalPaise ? 'paid' :
    paidPaise === 0n && refundedPaise > 0n ? 'refunded' : refundedPaise > 0n ? 'part_refunded' : paidPaise > 0n ? 'part_paid' : 'unpaid';
  return { receivedPaise, refundedPaise, paidPaise, balancePaise, paymentStatus };
}
