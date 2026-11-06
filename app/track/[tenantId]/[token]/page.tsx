
import { orderLabel } from '../../../../src/lib/order-labels.ts';
import { notFound } from 'next/navigation';
import { getPublicTracking } from '../../../../src/db/tracking.ts';
import { TIMEZONE } from '../../../../src/lib/time.ts';
import { getTranslations } from '../../../i18n/server.ts';
import { LanguageSwitcher } from '../../../i18n/language-switcher.tsx';
import { RefreshKitchenBoard } from '../../../kitchen/refresh-board.tsx';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function TrackingPage({ params }: { params: Promise<{ tenantId: string; token: string }> }) {
  const { tenantId, token } = await params;
  const order = await getPublicTracking(tenantId, token);
  if (!order) notFound();
  const t = await getTranslations();
  return <main className="page page--narrow" id="main-content">
    <div className="page-heading"><p className="eyebrow">{order.cafeName}</p><LanguageSwitcher /></div>
    <h1>{t('Track your order')}</h1>
    <p>{t('Order #{number}', { number: order.orderNumber })}</p>
    <p className="msg msg--info" role="status"><strong>{t(orderLabel(order.status))}</strong></p>
    <p className="prose-note">{t('Your order status updates here as the cafe prepares it. Keep this private link to check again.')}</p>
    <RefreshKitchenBoard />
    <section className="form-section"><h2>{t('Your items')}</h2>
      <ul>{order.items.map((item, i) => <li key={i}>{item.quantity} × {item.name}</li>)}</ul></section>
    <section className="form-section"><h2>{t('Order progress')}</h2>
      <ol>{order.events.map((event, i) => <li key={i}>{t(orderLabel(event.status))} · {event.at.toLocaleString(t.intlLocale, { timeZone: TIMEZONE })}</li>)}</ol>
    </section>
  </main>;
}
