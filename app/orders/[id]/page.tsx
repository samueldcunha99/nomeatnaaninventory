import { PageTutorial } from '../../ui/page-tutorial.tsx';

import { orderLabel } from '../../../src/lib/order-labels.ts';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requirePermission } from '../../../src/auth/server.ts';
import { getOrder } from '../../../src/db/orders.ts';
import { hasPermission } from '../../../src/lib/auth.ts';
import { formatINR, millipercentToPercent, paiseToRupees } from '../../../src/lib/units.ts';
import { TIMEZONE } from '../../../src/lib/time.ts';
import type { OrderStatus, OrderType } from '../../../src/lib/orders.ts';
import { WorkspaceHeader } from '../../ui/workspace-header.tsx';
import { getTranslations } from '../../i18n/server.ts';
import { BillTools, OrderPaymentControls, OrderStatusControls } from '../order-controls.tsx';
import '../print.css';

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('orders.view');
  const t = await getTranslations();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const order = await getOrder(actor, id);
  if (!order) notFound();
  const canRecord = hasPermission(actor.role, 'orders.record');
  const canViewCosts = hasPermission(actor.role, 'recipes.view');
  const trackingPath = `/track/${actor.tenantId}/${order.trackingToken}`;
  return <><WorkspaceHeader actor={actor} title={t('Order #{number}', { number: order.orderNumber })} />
    <main className="page order-page" id="main-content" tabIndex={-1}>
      <PageTutorial topic="orderDetail" role={actor.role} />
      <p className="no-print"><Link href="/orders">{t('← Orders')}</Link></p>
      <div className="page-heading no-print"><h1>{t('Order #{number}', { number: order.orderNumber })}</h1><span className="badge">{t(orderLabel(order.status))}</span></div>
      {order.stockReversed ? <p className="msg msg--warn no-print">{t('This order was cancelled before preparation. Its reserved stock was restored.')}</p> : null}
      {order.cancelledAfterPreparation ? <p className="msg msg--warn no-print">{t('This order was cancelled after preparation started. Materials remain used and are recorded as a cancellation loss.')}</p> : null}
      <section className="form-section order-bill">
        <h2>{t('Order bill')} — <span>No Meat Naan</span></h2>
        <p>{t('Order #{number}', { number: order.orderNumber })} · {t(orderLabel(order.orderType))} · {t(orderLabel(order.status))}</p>
        <p className="muted">{order.createdAt.toLocaleString(t.intlLocale, { timeZone: TIMEZONE })}</p>
        {order.customerName ? <p>{t('Customer:')} {order.customerName}</p> : null}
        {order.customerPhone ? <p>{t('Contact:')} {order.customerPhone}</p> : null}
        {order.deliveryAddress ? <p>{t('Delivery address:')} {order.deliveryAddress}</p> : null}
        <div className="table-wrap"><table className="table"><thead><tr><th>{t('Item')}</th><th className="num">{t('Quantity')}</th><th className="num">{t('Unit price')}</th><th className="num">{t('Amount')}</th></tr></thead>
          <tbody>{order.lines.map(line => <tr key={line.id}><td>{line.nameSnapshot}</td><td className="num">{line.quantity}</td><td className="num">{formatINR(line.unitPricePaise)}</td><td className="num">{formatINR(line.lineTotalPaise)}</td></tr>)}</tbody>
          <tfoot><tr><th colSpan={3}>{t('Subtotal')}</th><td className="num">{formatINR(order.subtotalPaise)}</td></tr>
            <tr><th colSpan={3}>{t('Tax')} ({millipercentToPercent(order.taxRateMillipercent)}%)</th><td className="num">{formatINR(order.taxPaise)}</td></tr>
            <tr><th colSpan={3}>{t('Total')}</th><td className="num font-semibold">{formatINR(order.totalPaise)}</td></tr>
            <tr><th colSpan={3}>{t('Net received')}</th><td className="num">{formatINR(order.paidPaise)}</td></tr>
            <tr><th colSpan={3}>{t('Balance due')}</th><td className="num">{order.status === 'cancelled' ? t('Order cancelled — no balance due') : formatINR(order.balancePaise)}</td></tr>
          </tfoot></table></div>
        <p>{t('Payment status:')} <strong>{t(orderLabel(order.paymentStatus))}</strong></p>
        {order.note ? <p>{t('Notes:')} {order.note}</p> : null}
        <BillTools trackingPath={trackingPath} />
      </section>
      <section className="form-section no-print"><h2>{t('Preparation status')}</h2>
        <OrderStatusControls orderId={id} status={order.status as OrderStatus} orderType={order.orderType as OrderType} canCancel={hasPermission(actor.role, 'orders.cancel')} />
      </section>
      {canRecord && order.status !== 'cancelled' && order.balancePaise > 0n ? <OrderPaymentControls orderId={id} requestId={crypto.randomUUID()} eventType="payment" amount={paiseToRupees(order.balancePaise)} /> : null}
      {hasPermission(actor.role, 'sales.manage') && order.paidPaise > 0n ? <OrderPaymentControls orderId={id} requestId={crypto.randomUUID()} eventType="refund" amount={paiseToRupees(order.paidPaise)} /> : null}
      {canViewCosts ? <section className="form-section no-print"><h2>{t('Saved material costs')}</h2><p className="prose-note">{t('These are the material costs saved at confirmation, not a recalculation from today’s prices. Labour and kitchen overhead are separate.')}</p>
        <div className="table-wrap"><table className="table"><thead><tr><th>{t('Item')}</th><th className="num">{t('Material cost')}</th></tr></thead><tbody>
          {order.lines.map(line => <tr key={line.id}><td>{line.nameSnapshot}</td><td className="num">{line.costSnapshotPaise == null ? t('Unknown') : formatINR(line.costSnapshotPaise)}</td></tr>)}
        </tbody></table></div></section> : null}
      <section className="form-section no-print"><h2>{t('Order history')}</h2>
        <div className="table-wrap"><table className="table"><thead><tr><th>{t('Time')}</th><th>{t('Status change')}</th><th>{t('Recorded by')}</th><th>{t('Reason / note')}</th></tr></thead>
          <tbody>{order.events.map(event => <tr key={event.id}><td>{event.createdAt.toLocaleString(t.intlLocale, { timeZone: TIMEZONE })}</td><td>{event.fromStatus ? `${t(orderLabel(event.fromStatus))} → ` : ''}{t(orderLabel(event.toStatus))}</td><td>{event.userName ?? '—'}</td><td>{event.reason ?? '—'}</td></tr>)}</tbody></table></div>
      </section>
      <section className="form-section no-print"><h2>{t('Payments and refunds')}</h2>
        {order.payments.length ? <div className="table-wrap"><table className="table"><thead><tr><th>{t('Time')}</th><th>{t('Type')}</th><th>{t('Method')}</th><th className="num">{t('Amount')}</th><th>{t('Reference')}</th><th>{t('Recorded by')}</th></tr></thead>
          <tbody>{order.payments.map(payment => <tr key={payment.id}><td>{payment.createdAt.toLocaleString(t.intlLocale, { timeZone: TIMEZONE })}</td><td>{t(orderLabel(payment.eventType))}</td><td>{t(orderLabel(payment.method))}</td><td className="num">{formatINR(payment.amountPaise)}</td><td>{payment.reference ?? '—'}</td><td>{payment.userName ?? '—'}</td></tr>)}</tbody></table></div> : <p className="prose-note">{t('No payments have been recorded.')}</p>}
      </section>
    </main></>;
}
