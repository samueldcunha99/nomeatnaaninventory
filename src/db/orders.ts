/** Authenticated staff orders. Every financial/usage snapshot is written atomically. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, or, sql as raw } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './client.ts';
import { auditLog, ingredients, menuItems, orders, orderCounters, orderLines, orderLineDraws,
  orderStatusEvents, paymentEvents, recipes, stockMovements, tenants, users } from './schema.ts';
import { assertPermission, hasPermission, type Actor } from '../lib/auth.ts';
import { loadCostLookupForTenant, loadRecipeGraphForTenant } from './recipes.ts';
import { lockIngredients, recordMovements, type MovementInput } from './stock.ts';
import { valueDraws } from '../lib/production.ts';
import { ORDER_STATUSES, ORDER_TYPES, TAX_MODES, MAX_ORDER_PAISE, assertOrderTransition, calculateOrderTotals,
  planOrderLine, summarizePayments, type FulfillmentMode, type OrderStatus, type OrderType, type TaxMode } from '../lib/orders.ts';
import { istDayAfter, istDayStart } from '../lib/time.ts';
import type { UnitType } from '../lib/units.ts';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const money = z.bigint().min(0n).max(MAX_ORDER_PAISE);
const optionalText = (maximum: number) => z.string().trim().max(maximum).nullish().transform(value => value || null);
const CreateInput = z.object({
  requestId: z.string().uuid(), orderType: z.enum(ORDER_TYPES),
  customerName: optionalText(120), customerPhone: optionalText(40), deliveryAddress: optionalText(1000), note: optionalText(2000),
  expectedTaxMode: z.enum(TAX_MODES).optional(), expectedTaxRateMillipercent: z.bigint().min(0n).max(100000n).optional(),
  lines: z.array(z.object({ menuItemId: z.string().uuid(), quantity: z.number().int().min(1).max(1000),
    expectedUnitPricePaise: money.optional(), expectedMenuUpdatedAt: z.string().datetime({ offset: true }).optional() })).min(1).max(100),
  paymentMethod: z.enum(['unpaid', 'cash', 'external']).default('unpaid'), paymentReference: optionalText(200),
});
export type CreateOrderInput = z.input<typeof CreateInput>;
const StatusInput = z.object({ orderId: z.string().uuid(), toStatus: z.enum(ORDER_STATUSES),
  fromStatus: z.enum(ORDER_STATUSES).optional(), reason: optionalText(1000) });
export type ChangeOrderStatusInput = z.input<typeof StatusInput>;
const PaymentInput = z.object({ orderId: z.string().uuid(), requestId: z.string().uuid(),
  method: z.enum(['cash', 'external']), amountPaise: money.refine(value => value > 0n),
  reference: optionalText(200), eventType: z.enum(['payment', 'refund']).default('payment') });
export type RecordOrderPaymentInput = z.input<typeof PaymentInput>;

function stored(value: bigint): number {
  if (value > MAX_ORDER_PAISE || value < -MAX_ORDER_PAISE) throw new RangeError('This order contains a quantity or amount too large to record exactly.');
  return Number(value);
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value,
  (_key, item) => typeof item === 'bigint' ? item.toString() : item)).digest('hex');
const recipeLock = (tx: Tx, actor: Actor) => tx.execute(raw`select pg_advisory_xact_lock(hashtextextended(${`recipes:${actor.tenantId}`}, 0))`);

async function settings(tenantId: string, tx: Tx | typeof db = db) {
  const [row] = await tx.select({ taxMode: tenants.salesTaxMode, taxRateMillipercent: tenants.salesTaxRateMillipercent })
    .from(tenants).where(eq(tenants.id, tenantId));
  if (!row) throw new RangeError('The cafe sales settings are unavailable.');
  return { taxMode: row.taxMode as TaxMode | null,
    taxRateMillipercent: row.taxRateMillipercent == null ? null : BigInt(row.taxRateMillipercent) };
}
export async function loadSalesSettings(actor: Actor) {
  assertPermission(actor.role, 'orders.record');
  return settings(actor.tenantId);
}
export async function saveSalesSettings(actor: Actor, input: { taxMode: TaxMode; taxRateMillipercent: bigint }) {
  assertPermission(actor.role, 'sales.manage');
  const parsed = z.object({ taxMode: z.enum(TAX_MODES), taxRateMillipercent: z.bigint().min(0n).max(100000n) }).parse(input);
  calculateOrderTotals(0n, parsed.taxMode, parsed.taxRateMillipercent);
  await db.transaction(async tx => {
    await recipeLock(tx, actor);
    const before = await settings(actor.tenantId, tx);
    await tx.update(tenants).set({ salesTaxMode: parsed.taxMode, salesTaxRateMillipercent: Number(parsed.taxRateMillipercent) }).where(eq(tenants.id, actor.tenantId));
    await tx.insert(auditLog).values({ tenantId: actor.tenantId, userId: actor.id, action: 'sales.settings_update', entityType: 'tenant', entityId: actor.tenantId,
      beforeJson: { taxMode: before.taxMode, taxRateMillipercent: before.taxRateMillipercent?.toString() ?? null },
      afterJson: { taxMode: parsed.taxMode, taxRateMillipercent: parsed.taxRateMillipercent.toString() } });
  });
}

export async function listOrderMenu(actor: Actor) {
  assertPermission(actor.role, 'orders.record');
  const rows = await db.select({ id: menuItems.id, name: menuItems.name, sellingPricePaise: menuItems.sellingPricePaise,
    portionQtyMilliBase: menuItems.portionQtyMilliBase, fulfillmentMode: menuItems.fulfillmentMode, updatedAt: menuItems.updatedAt,
    yieldUnitType: recipes.yieldUnitType, recipeName: recipes.name }).from(menuItems)
    .innerJoin(recipes, and(eq(recipes.tenantId, menuItems.tenantId), eq(recipes.id, menuItems.recipeId)))
    .where(and(eq(menuItems.tenantId, actor.tenantId), isNull(menuItems.deletedAt), eq(menuItems.isActive, true), isNull(recipes.deletedAt)))
    .orderBy(asc(menuItems.name));
  return rows.map(row => ({ ...row, sellingPricePaise: BigInt(row.sellingPricePaise), portionQtyMilliBase: BigInt(row.portionQtyMilliBase),
    fulfillmentMode: row.fulfillmentMode as FulfillmentMode | null }));
}

export async function createOrder(actor: Actor, input: CreateOrderInput) {
  assertPermission(actor.role, 'orders.record');
  const parsed = CreateInput.parse(input), requestHash = hash(parsed);
  if (parsed.paymentMethod === 'external' && !parsed.paymentReference) throw new RangeError('Enter the reference for the payment already received outside this app.');
  if (parsed.orderType === 'delivery' && (!parsed.customerPhone || !parsed.deliveryAddress)) throw new RangeError('Delivery orders need a customer phone number and delivery address.');
  return db.transaction(async tx => {
    // Same graph -> ingredient ordering as recipe edits, production and corrections.
    await recipeLock(tx, actor);
    const [prior] = await tx.select().from(orders).where(and(eq(orders.tenantId, actor.tenantId), eq(orders.requestId, parsed.requestId)));
    if (prior) {
      if (prior.requestHash !== requestHash) throw new RangeError('This order form was already used for different details. Reload before creating another order.');
      return { orderId: prior.id, orderNumber: prior.orderNumber, tenantId: actor.tenantId, alreadyRecorded: true };
    }
    const rates = await settings(actor.tenantId, tx);
    if ((parsed.expectedTaxMode !== undefined && parsed.expectedTaxMode !== rates.taxMode) ||
        (parsed.expectedTaxRateMillipercent !== undefined && parsed.expectedTaxRateMillipercent !== rates.taxRateMillipercent)) {
      throw new RangeError('Sales tax settings changed since this form was opened. Reload and check the total before taking payment.');
    }
    const graph = await loadRecipeGraphForTenant(actor.tenantId, tx);
    const menuRows = await tx.select().from(menuItems).where(and(eq(menuItems.tenantId, actor.tenantId),
      inArray(menuItems.id, parsed.lines.map(line => line.menuItemId)), isNull(menuItems.deletedAt), eq(menuItems.isActive, true)));
    const menu = new Map(menuRows.map(row => [row.id, row]));
    const quantities = new Map<string, number>();
    for (const line of parsed.lines) {
      const item = menu.get(line.menuItemId);
      if (!item) throw new RangeError('An item is no longer available. Reload the menu before taking this order.');
      if ((line.expectedUnitPricePaise !== undefined && line.expectedUnitPricePaise !== BigInt(item.sellingPricePaise)) ||
          (line.expectedMenuUpdatedAt !== undefined && new Date(line.expectedMenuUpdatedAt).getTime() !== item.updatedAt.getTime())) {
        throw new RangeError(`"${item.name}" changed since this form was opened. Reload and check its price and serving quantity.`);
      }
      quantities.set(item.id, (quantities.get(item.id) ?? 0) + line.quantity);
    }
    const plans = [...quantities].map(([id, quantity]) => {
      const row = menu.get(id)!;
      return planOrderLine({ id: row.id, name: row.name, recipeId: row.recipeId, portionQtyMilliBase: BigInt(row.portionQtyMilliBase),
        sellingPricePaise: BigInt(row.sellingPricePaise), fulfillmentMode: row.fulfillmentMode as FulfillmentMode | null }, quantity, graph);
    });
    const totals = calculateOrderTotals(plans.reduce((sum, plan) => sum + plan.lineTotalPaise, 0n), rates.taxMode, rates.taxRateMillipercent);
    await lockIngredients(tx, actor.tenantId, plans.flatMap(plan => plan.draws.map(draw => draw.ingredientId)));
    const lookup = await loadCostLookupForTenant(actor.tenantId, tx);
    const valuations = plans.map(plan => valueDraws(plan.draws, lookup));
    const [counter] = await tx.insert(orderCounters).values({ tenantId: actor.tenantId, nextNumber: 2 })
      .onConflictDoUpdate({ target: orderCounters.tenantId, set: { nextNumber: raw`${orderCounters.nextNumber} + 1` } }).returning();
    const orderNumber = counter.nextNumber - 1, orderId = randomUUID();
    await tx.insert(orders).values({ id: orderId, tenantId: actor.tenantId, requestId: parsed.requestId, requestHash,
      orderNumber, orderType: parsed.orderType, customerName: parsed.customerName, customerPhone: parsed.customerPhone,
      deliveryAddress: parsed.deliveryAddress, note: parsed.note, trackingToken: randomBytes(24).toString('base64url'),
      subtotalPaise: stored(totals.subtotalPaise), taxPaise: stored(totals.taxPaise), totalPaise: stored(totals.totalPaise),
      taxMode: rates.taxMode!, taxRateMillipercent: Number(rates.taxRateMillipercent!),
      paymentStatus: parsed.paymentMethod === 'unpaid' && totals.totalPaise > 0n ? 'unpaid' : 'paid', createdByUserId: actor.id });
    const movements: MovementInput[] = [];
    const draws: (typeof orderLineDraws.$inferInsert)[] = [];
    for (const [index, plan] of plans.entries()) {
      const lineId = randomUUID(), valuation = valuations[index];
      await tx.insert(orderLines).values({ id: lineId, tenantId: actor.tenantId, orderId, lineNumber: index + 1,
        menuItemId: plan.menuItem.id, recipeId: plan.menuItem.recipeId, nameSnapshot: plan.menuItem.name, quantity: plan.quantity,
        portionQtyMilliBase: stored(plan.menuItem.portionQtyMilliBase), yieldUnitType: plan.yieldUnitType,
        fulfillmentMode: plan.menuItem.fulfillmentMode!, unitPricePaise: stored(plan.menuItem.sellingPricePaise),
        lineTotalPaise: stored(plan.lineTotalPaise), costSnapshotPaise: valuation.costPaise == null ? null : stored(valuation.costPaise) });
      for (const value of valuation.valuedDraws) {
        const movementId = randomUUID();
        movements.push({ id: movementId, tenantId: actor.tenantId, ingredientId: value.draw.ingredientId, movementType: 'consumption',
          quantityMilliBase: stored(-value.draw.issuedMilliBase), referenceType: 'order', referenceId: orderId, createdByUserId: actor.id });
        draws.push({ tenantId: actor.tenantId, orderLineId: lineId, ingredientId: value.draw.ingredientId, stockMovementId: movementId,
          quantityMilliBase: stored(value.draw.issuedMilliBase), unitCostMillipaisePerBase: value.rateMillipaisePerBase == null ? null : stored(value.rateMillipaisePerBase),
          costPaise: value.costPaise == null ? null : stored(value.costPaise) });
      }
    }
    await recordMovements(movements, tx); await tx.insert(orderLineDraws).values(draws);
    await tx.insert(orderStatusEvents).values({ tenantId: actor.tenantId, orderId, toStatus: 'ordered', createdByUserId: actor.id });
    if (parsed.paymentMethod !== 'unpaid' && totals.totalPaise > 0n) {
      await tx.insert(paymentEvents).values({ tenantId: actor.tenantId, orderId, requestId: parsed.requestId, method: parsed.paymentMethod,
        eventType: 'payment', amountPaise: stored(totals.totalPaise), reference: parsed.paymentReference, createdByUserId: actor.id });
    }
    await tx.insert(auditLog).values({ tenantId: actor.tenantId, userId: actor.id, action: 'order.create', entityType: 'order', entityId: orderId,
      afterJson: { orderNumber, lines: plans.length, totalPaise: stored(totals.totalPaise), paymentMethod: parsed.paymentMethod } });
    return { orderId, orderNumber, tenantId: actor.tenantId, alreadyRecorded: false };
  });
}

export async function listOrders(actor: Actor, options: { day?: string; status?: string; search?: string; q?: string; limit?: number } = {}) {
  assertPermission(actor.role, 'orders.view');
  const start = options.day ? istDayStart(options.day) : undefined, end = options.day ? istDayAfter(options.day) : undefined;
  if (options.day && !start) throw new RangeError('Choose a valid order date.');
  const status = options.status && options.status !== 'all' ? z.enum(ORDER_STATUSES).parse(options.status) : undefined;
  const search = (options.search ?? options.q)?.trim().slice(0, 120);
  const orderNumber = search && /^\d+$/.test(search) && Number.isSafeInteger(Number(search)) && Number(search) < 2147483647 ? Number(search) : undefined;
  const limit = Math.min(200, Math.max(1, Number.isSafeInteger(options.limit) ? options.limit! : 100));
  const rows = await db.select({ id: orders.id, orderNumber: orders.orderNumber, orderType: orders.orderType, status: orders.status,
    customerName: orders.customerName, createdAt: orders.createdAt, totalPaise: orders.totalPaise, paymentStatus: orders.paymentStatus,
    stockReversed: orders.stockReversed, cancelledAfterPreparation: orders.cancelledAfterPreparation }).from(orders).where(and(
      eq(orders.tenantId, actor.tenantId), isNull(orders.deletedAt), start ? gte(orders.createdAt, start) : undefined,
      end ? lt(orders.createdAt, end) : undefined, status ? eq(orders.status, status) : undefined,
      search ? or(ilike(orders.customerName, `%${search}%`), orderNumber !== undefined ? eq(orders.orderNumber, orderNumber) : undefined) : undefined,
    )).orderBy(desc(orders.createdAt), desc(orders.orderNumber)).limit(limit);
  return rows.map(row => ({ ...row, totalPaise: BigInt(row.totalPaise), status: row.status as OrderStatus, orderType: row.orderType as OrderType }));
}

export async function getOrder(actor: Actor, orderId: string) {
  assertPermission(actor.role, 'orders.view');
  z.string().uuid().parse(orderId);
  return db.transaction(async tx => {
  const [row] = await tx.select().from(orders).where(and(eq(orders.tenantId, actor.tenantId), eq(orders.id, orderId), isNull(orders.deletedAt)));
  if (!row) return null;
  const [lines, events, payments] = await Promise.all([
    tx.select().from(orderLines).where(and(eq(orderLines.tenantId, actor.tenantId), eq(orderLines.orderId, orderId))).orderBy(asc(orderLines.lineNumber)),
    tx.select({ id: orderStatusEvents.id, fromStatus: orderStatusEvents.fromStatus, toStatus: orderStatusEvents.toStatus,
      reason: orderStatusEvents.reason, createdAt: orderStatusEvents.createdAt, userName: users.name }).from(orderStatusEvents)
      .leftJoin(users, and(eq(users.tenantId, orderStatusEvents.tenantId), eq(users.id, orderStatusEvents.createdByUserId)))
      .where(and(eq(orderStatusEvents.tenantId, actor.tenantId), eq(orderStatusEvents.orderId, orderId))).orderBy(asc(orderStatusEvents.createdAt)),
    tx.select({ id: paymentEvents.id, method: paymentEvents.method, eventType: paymentEvents.eventType, amountPaise: paymentEvents.amountPaise,
      reference: paymentEvents.reference, createdAt: paymentEvents.createdAt, userName: users.name }).from(paymentEvents)
      .leftJoin(users, and(eq(users.tenantId, paymentEvents.tenantId), eq(users.id, paymentEvents.createdByUserId)))
      .where(and(eq(paymentEvents.tenantId, actor.tenantId), eq(paymentEvents.orderId, orderId))).orderBy(asc(paymentEvents.createdAt)),
  ]);
  const convertedPayments = payments.map(payment => ({ ...payment, amountPaise: BigInt(payment.amountPaise) }));
  return { ...row, orderType: row.orderType as OrderType, status: row.status as OrderStatus,
    subtotalPaise: BigInt(row.subtotalPaise), taxPaise: BigInt(row.taxPaise), totalPaise: BigInt(row.totalPaise), taxRateMillipercent: BigInt(row.taxRateMillipercent),
    lines: lines.map(({ costSnapshotPaise, ...line }) => ({ ...line, portionQtyMilliBase: BigInt(line.portionQtyMilliBase),
      unitPricePaise: BigInt(line.unitPricePaise), lineTotalPaise: BigInt(line.lineTotalPaise),
      ...(hasPermission(actor.role, 'recipes.view') ? { costSnapshotPaise: costSnapshotPaise == null ? null : BigInt(costSnapshotPaise) } : {}) })),
    events, payments: convertedPayments, ...summarizePayments(BigInt(row.totalPaise), convertedPayments) };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

export async function listKitchenOrders(actor: Actor) {
  assertPermission(actor.role, 'kitchen.view');
  const rows = await db.select({ id: orders.id, orderNumber: orders.orderNumber, orderType: orders.orderType, status: orders.status,
    createdAt: orders.createdAt, note: orders.note }).from(orders).where(and(eq(orders.tenantId, actor.tenantId), isNull(orders.deletedAt),
      inArray(orders.status, ORDER_STATUSES.filter(status => !['completed', 'cancelled'].includes(status))))).orderBy(asc(orders.createdAt)).limit(200);
  if (!rows.length) return [];
  const lines = await db.select({ id: orderLines.id, orderId: orderLines.orderId, nameSnapshot: orderLines.nameSnapshot, quantity: orderLines.quantity })
    .from(orderLines).where(and(eq(orderLines.tenantId, actor.tenantId), inArray(orderLines.orderId, rows.map(row => row.id)))).orderBy(asc(orderLines.lineNumber));
  return rows.map(row => ({ ...row, status: row.status as OrderStatus, orderType: row.orderType as OrderType,
    lines: lines.filter(line => line.orderId === row.id).map(({ orderId: _id, ...line }) => line) }));
}

export async function changeOrderStatus(actor: Actor, input: ChangeOrderStatusInput) {
  assertPermission(actor.role, 'orders.status');
  const parsed = StatusInput.parse(input);
  if (parsed.toStatus === 'cancelled') assertPermission(actor.role, 'orders.cancel');
  return db.transaction(async tx => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.tenantId, actor.tenantId), eq(orders.id, parsed.orderId), isNull(orders.deletedAt))).for('update');
    if (!order) throw new RangeError('That order is unavailable.');
    if (order.status === parsed.toStatus) return { orderId: order.id, alreadyChanged: true, stockReversed: order.stockReversed };
    if (parsed.fromStatus !== undefined && parsed.fromStatus !== order.status) throw new RangeError('This order changed while the page was open. Refresh before changing its status.');
    const { backward } = assertOrderTransition(order.status as OrderStatus, parsed.toStatus, order.orderType as OrderType, parsed.reason);
    let stockReversed = order.stockReversed, cancelledAfterPreparation = order.cancelledAfterPreparation;
    if (parsed.toStatus === 'cancelled') {
      const [prepared] = await tx.select({ id: orderStatusEvents.id }).from(orderStatusEvents).where(and(eq(orderStatusEvents.tenantId, actor.tenantId),
        eq(orderStatusEvents.orderId, order.id), inArray(orderStatusEvents.toStatus, ['in_kitchen', 'baking', 'out_of_oven', 'ready', 'out_for_delivery', 'completed']))).limit(1);
      cancelledAfterPreparation = Boolean(prepared);
      if (!prepared) {
        const originals = await tx.select().from(stockMovements).where(and(eq(stockMovements.tenantId, actor.tenantId),
          eq(stockMovements.referenceType, 'order'), eq(stockMovements.referenceId, order.id))).orderBy(asc(stockMovements.seq));
        if (!originals.length) throw new RangeError('This order has no recorded stock movements. Ask the owner to review its stock history.');
        const cutoffs = new Map<string, number>(); for (const movement of originals) cutoffs.set(movement.ingredientId, movement.seq);
        await lockIngredients(tx, actor.tenantId, cutoffs.keys());
        const [later] = await tx.select({ name: ingredients.name }).from(stockMovements).innerJoin(ingredients,
          and(eq(ingredients.tenantId, stockMovements.tenantId), eq(ingredients.id, stockMovements.ingredientId))).where(and(
          eq(stockMovements.tenantId, actor.tenantId), or(...[...cutoffs].map(([ingredientId, seq]) => and(eq(stockMovements.ingredientId, ingredientId), gt(stockMovements.seq, seq)))))).limit(1);
        if (later) throw new RangeError(`This order cannot restore stock because later activity uses "${later.name}". Ask the owner to review it before cancellation.`);
        await recordMovements(originals.map(movement => ({ tenantId: actor.tenantId, ingredientId: movement.ingredientId, movementType: 'reversal' as const,
          quantityMilliBase: stored(-BigInt(movement.quantityMilliBase)), reversesMovementId: movement.id, referenceType: 'order_cancellation',
          referenceId: order.id, note: parsed.reason, createdByUserId: actor.id })), tx);
        stockReversed = true;
      }
    }
    await tx.update(orders).set({ status: parsed.toStatus, stockReversed, cancelledAfterPreparation, updatedAt: new Date() })
      .where(and(eq(orders.tenantId, actor.tenantId), eq(orders.id, order.id)));
    await tx.insert(orderStatusEvents).values({ tenantId: actor.tenantId, orderId: order.id, fromStatus: order.status,
      toStatus: parsed.toStatus, reason: parsed.reason, createdByUserId: actor.id, createdAt: new Date() });
    await tx.insert(auditLog).values({ tenantId: actor.tenantId, userId: actor.id, action: 'order.status_change', entityType: 'order', entityId: order.id,
      beforeJson: { status: order.status }, afterJson: { status: parsed.toStatus, reason: parsed.reason, backward, stockReversed, cancelledAfterPreparation } });
    return { orderId: order.id, alreadyChanged: false, stockReversed };
  });
}

export async function recordOrderPayment(actor: Actor, input: RecordOrderPaymentInput) {
  assertPermission(actor.role, 'orders.record');
  const parsed = PaymentInput.parse(input);
  if (parsed.eventType === 'refund') assertPermission(actor.role, 'sales.manage');
  if (parsed.method === 'external' && !parsed.reference) throw new RangeError('Enter the reference for the payment already received outside this app.');
  return db.transaction(async tx => {
    await tx.execute(raw`select pg_advisory_xact_lock(hashtextextended(${`payment:${actor.tenantId}:${parsed.requestId}`}, 0))`);
    const [order] = await tx.select().from(orders).where(and(eq(orders.tenantId, actor.tenantId), eq(orders.id, parsed.orderId), isNull(orders.deletedAt))).for('update');
    if (!order) throw new RangeError('That order is unavailable.');
    const [existing] = await tx.select().from(paymentEvents).where(and(eq(paymentEvents.tenantId, actor.tenantId), eq(paymentEvents.requestId, parsed.requestId)));
    if (existing) {
      if (existing.orderId !== order.id || existing.method !== parsed.method || existing.eventType !== parsed.eventType ||
          BigInt(existing.amountPaise) !== parsed.amountPaise || existing.reference !== parsed.reference) throw new RangeError('This payment form was already used for different details. Refresh before recording another payment.');
      return { paymentId: existing.id, alreadyRecorded: true, paymentStatus: order.paymentStatus };
    }
    if (order.status === 'cancelled' && parsed.eventType !== 'refund') throw new RangeError('A cancelled order can only have a refund recorded.');
    const previous = await tx.select({ eventType: paymentEvents.eventType, amountPaise: paymentEvents.amountPaise }).from(paymentEvents)
      .where(and(eq(paymentEvents.tenantId, actor.tenantId), eq(paymentEvents.orderId, order.id)));
    const events = previous.map(event => ({ ...event, amountPaise: BigInt(event.amountPaise) }));
    const before = summarizePayments(BigInt(order.totalPaise), events);
    if ((parsed.eventType === 'payment' && parsed.amountPaise > before.balancePaise) ||
        (parsed.eventType === 'refund' && parsed.amountPaise > before.paidPaise)) throw new RangeError('The payment or refund amount exceeds the available order balance.');
    const after = summarizePayments(BigInt(order.totalPaise), [...events, { eventType: parsed.eventType, amountPaise: parsed.amountPaise }]);
    const paymentId = randomUUID();
    await tx.insert(paymentEvents).values({ id: paymentId, tenantId: actor.tenantId, orderId: order.id, requestId: parsed.requestId,
      method: parsed.method, eventType: parsed.eventType, amountPaise: stored(parsed.amountPaise), reference: parsed.reference, createdByUserId: actor.id, createdAt: new Date() });
    await tx.update(orders).set({ paymentStatus: after.paymentStatus, updatedAt: new Date() }).where(and(eq(orders.tenantId, actor.tenantId), eq(orders.id, order.id)));
    await tx.insert(auditLog).values({ tenantId: actor.tenantId, userId: actor.id, action: `order.${parsed.eventType}`, entityType: 'order', entityId: order.id,
      afterJson: { paymentId, amountPaise: stored(parsed.amountPaise), method: parsed.method, reference: parsed.reference, paymentStatus: after.paymentStatus } });
    return { paymentId, alreadyRecorded: false, paymentStatus: after.paymentStatus };
  });
}
