import { PageTutorial } from '../ui/page-tutorial.tsx';

import { orderLabel } from '../../src/lib/order-labels.ts';
import Link from 'next/link';
import { requirePermission } from '../../src/auth/server.ts';
import { listKitchenOrders } from '../../src/db/orders.ts';
import { hasPermission } from '../../src/lib/auth.ts';
import type { OrderStatus, OrderType } from '../../src/lib/orders.ts';
import { TIMEZONE } from '../../src/lib/time.ts';
import { WorkspaceHeader } from '../ui/workspace-header.tsx';
import { getTranslations } from '../i18n/server.ts';
import { OrderStatusControls } from '../orders/order-controls.tsx';
import { RefreshKitchenBoard } from './refresh-board.tsx';

export default async function KitchenPage() {
  const actor = await requirePermission('kitchen.view');
  const t = await getTranslations();
  const rows = await listKitchenOrders(actor);
  return <><WorkspaceHeader actor={actor} title={t('Kitchen board')} />
    <main className="page" id="main-content" tabIndex={-1}>
      <PageTutorial topic="kitchen" role={actor.role} />
      <div className="page-heading"><h1>{t('Kitchen board')}</h1><RefreshKitchenBoard /></div>
      <p className="prose-note">{t('Active orders, oldest first. Updating preparation status does not deduct stock again.')}</p>
      {rows.length ? <div className="recipe-grid">{rows.map(order => <article className="form-section mt-0" key={order.id}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2>{t('Order #{number}', { number: order.orderNumber })}</h2><span className="badge">{t(orderLabel(order.status))}</span></div>
        <p>{t(orderLabel(order.orderType))} · {order.createdAt.toLocaleTimeString(t.intlLocale, { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' })}</p>
        <p className="prose-note">{t('{minutes} min since order', { minutes: Math.max(0, Math.floor((Date.now() - order.createdAt.getTime()) / 60000)) })}</p>
        <ul className="mb-4">{order.lines.map(line => <li key={line.id}><strong>{line.quantity} × </strong>{line.nameSnapshot}</li>)}</ul>
        {order.note ? <p className="msg msg--warn">{order.note}</p> : null}
        <OrderStatusControls orderId={order.id} status={order.status as OrderStatus} orderType={order.orderType as OrderType} canCancel={hasPermission(actor.role, 'orders.cancel')} />
        {hasPermission(actor.role, 'orders.view') ? <p className="mt-4"><Link href={`/orders/${order.id}`}>{t('Open order')}</Link></p> : null}
      </article>)}</div> : <div className="empty-panel"><h2>{t('No active kitchen orders')}</h2><p>{t('New confirmed orders will appear here.')}</p></div>}
    </main></>;
}
