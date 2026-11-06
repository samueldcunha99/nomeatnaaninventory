import { and, asc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { db } from './client.ts';
import { orders, orderLines, paymentEvents } from './schema.ts';
import { assertPermission, type Actor } from '../lib/auth.ts';
import { istDayStart, istDayAfter } from '../lib/time.ts';
import { summarizeSales } from '../lib/sales-report.ts';

export async function getSalesReport(actor: Actor, from: string, to: string) {
  assertPermission(actor.role, 'sales.view');
  const start = istDayStart(from), end = istDayAfter(to);
  if (!start || !end || start >= end || end.getTime() - start.getTime() > 366 * 86400000) throw new RangeError('Choose a valid date range of at most 366 days.');
  return db.transaction(async tx => {
    const [saleRows, paymentRows] = await Promise.all([
      tx.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
        subtotalPaise: orders.subtotalPaise, totalPaise: orders.totalPaise, cancelledAfterPreparation: orders.cancelledAfterPreparation }).from(orders)
        .where(and(eq(orders.tenantId, actor.tenantId), isNull(orders.deletedAt), gte(orders.createdAt, start), lt(orders.createdAt, end)))
        .orderBy(asc(orders.createdAt), asc(orders.orderNumber)),
      tx.select({ eventType: paymentEvents.eventType, amountPaise: paymentEvents.amountPaise }).from(paymentEvents)
        .where(and(eq(paymentEvents.tenantId, actor.tenantId), gte(paymentEvents.createdAt, start), lt(paymentEvents.createdAt, end))),
    ]);
    const lines = saleRows.length ? await tx.select({ orderId: orderLines.orderId, menuItemId: orderLines.menuItemId,
      nameSnapshot: orderLines.nameSnapshot, quantity: orderLines.quantity, lineTotalPaise: orderLines.lineTotalPaise,
      costSnapshotPaise: orderLines.costSnapshotPaise }).from(orderLines)
      .where(and(eq(orderLines.tenantId, actor.tenantId), inArray(orderLines.orderId, saleRows.map(order => order.id)))).orderBy(asc(orderLines.lineNumber)) : [];
    return { from, to, ...summarizeSales(saleRows.map(order => ({ ...order, subtotalPaise: BigInt(order.subtotalPaise), totalPaise: BigInt(order.totalPaise),
      lines: lines.filter(line => line.orderId === order.id).map(line => ({ ...line, lineTotalPaise: BigInt(line.lineTotalPaise),
        costSnapshotPaise: line.costSnapshotPaise === null ? null : BigInt(line.costSnapshotPaise) })) })),
    paymentRows.map(event => ({ ...event, amountPaise: BigInt(event.amountPaise) }))) };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
