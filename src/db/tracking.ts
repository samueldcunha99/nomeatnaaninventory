import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './client.ts';
import { orders, orderLines, orderStatusEvents, tenants } from './schema.ts';

const Link = z.object({ tenantId: z.uuid(), token: z.string().regex(/^[A-Za-z0-9_-]{24,128}$/) });

/** The opaque link is a public capability. Return an explicit allowlist, never the order row. */
export async function getPublicTracking(tenantId: string, token: string) {
  const parsed = Link.safeParse({ tenantId, token });
  if (!parsed.success) return null;
  return db.transaction(async tx => {
    const [order] = await tx.select({ id: orders.id, orderNumber: orders.orderNumber,
      status: orders.status, createdAt: orders.createdAt, cafeName: tenants.name })
      .from(orders).innerJoin(tenants, eq(tenants.id, orders.tenantId))
      .where(and(eq(orders.tenantId, tenantId), eq(orders.trackingToken, token), isNull(orders.deletedAt)));
    if (!order) return null;
    const [items, events] = await Promise.all([
      tx.select({ name: orderLines.nameSnapshot, quantity: orderLines.quantity }).from(orderLines)
        .where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, order.id))).orderBy(asc(orderLines.lineNumber)),
      tx.select({ status: orderStatusEvents.toStatus, at: orderStatusEvents.createdAt }).from(orderStatusEvents)
        .where(and(eq(orderStatusEvents.tenantId, tenantId), eq(orderStatusEvents.orderId, order.id)))
        .orderBy(asc(orderStatusEvents.createdAt), asc(orderStatusEvents.id)),
    ]);
    return { cafeName: order.cafeName, orderNumber: order.orderNumber, status: order.status,
      createdAt: order.createdAt, items, events };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
