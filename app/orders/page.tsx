
import { orderLabel } from '../../src/lib/order-labels.ts';
import Link from 'next/link';
import { requirePermission } from '../../src/auth/server.ts';
import { listOrders } from '../../src/db/orders.ts';
import { hasPermission } from '../../src/lib/auth.ts';
import { ORDER_STATUSES, type OrderStatus } from '../../src/lib/orders.ts';
import { istDayStart, istToday, TIMEZONE } from '../../src/lib/time.ts';
import { formatINR } from '../../src/lib/units.ts';
import { WorkspaceHeader } from '../ui/workspace-header.tsx';
import { getTranslations } from '../i18n/server.ts';

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ day?: string; status?: string; q?: string }> }) {
  const actor = await requirePermission('orders.view');
  const t = await getTranslations();
  const parameters = await searchParams;
  const day = istDayStart(parameters.day) ? parameters.day! : istToday();
  const status = ORDER_STATUSES.includes(parameters.status as OrderStatus) ? parameters.status as OrderStatus : undefined;
  const q = parameters.q?.slice(0, 120) ?? '';
  const rows = await listOrders(actor, { day, status, q });
  return <><WorkspaceHeader actor={actor} title={t('Orders')} />
    <main className="page" id="main-content" tabIndex={-1}>
      <div className="page-heading"><h1>{t('Orders')}</h1>{hasPermission(actor.role, 'orders.record') ? <Link className="btn" href="/orders/new">{t('+ New order')}</Link> : null}</div>
      <p className="prose-note">{t('Find orders by their creation date in Asia/Kolkata. Prices and material costs are saved when an order is confirmed.')}</p>
      {parameters.day && !istDayStart(parameters.day) ? <p className="msg msg--warn" role="status">{t('Choose a valid date. Showing today.')}</p> : null}
      {parameters.status && !status ? <p className="msg msg--warn" role="status">{t('Choose a valid order status. Showing all statuses.')}</p> : null}
      <form method="get" className="toolbar">
        <div className="field"><label className="label" htmlFor="order-day">{t('Order date')}</label><input className="input" id="order-day" name="day" type="date" defaultValue={day} required /></div>
        <div className="field"><label className="label" htmlFor="order-status">{t('Status')}</label><select className="select" id="order-status" name="status" defaultValue={status ?? ''}>
          <option value="">{t('All statuses')}</option>{ORDER_STATUSES.map(value => <option key={value} value={value}>{t(orderLabel(value))}</option>)}</select></div>
        <div className="field grow"><label className="label" htmlFor="order-search">{t('Search orders')}</label><input className="input" id="order-search" name="q" defaultValue={q} maxLength={120} placeholder={t('Order number or customer name')} /></div>
        <button className="btn btn--secondary">{t('Show orders')}</button>
      </form>
      {rows.length ? <div className="table-wrap"><table className="table"><thead><tr>
        <th>{t('Order')}</th><th>{t('Created')}</th><th>{t('Type')}</th><th>{t('Customer')}</th><th>{t('Status')}</th><th>{t('Payment')}</th><th className="num">{t('Total')}</th>
      </tr></thead><tbody>{rows.map(order => <tr key={order.id}>
        <th scope="row"><Link href={`/orders/${order.id}`}>#{order.orderNumber}</Link></th>
        <td>{order.createdAt.toLocaleTimeString(t.intlLocale, { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' })}</td>
        <td>{t(orderLabel(order.orderType))}</td><td>{order.customerName || '—'}</td><td>{t(orderLabel(order.status))}</td><td>{t(orderLabel(order.paymentStatus))}</td><td className="num">{formatINR(order.totalPaise)}</td>
      </tr>)}</tbody></table></div> : <div className="empty-panel"><h2>{t('No orders match these filters')}</h2><p>{t('Choose another date or create the first order.')}</p></div>}
    </main></>;
}
