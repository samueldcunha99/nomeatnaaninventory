import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { getSalesReport } from '../../../src/db/sales-report.ts';
import { istToday, istDayStart, istDayAfter } from '../../../src/lib/time.ts';
import { formatINR } from '../../../src/lib/units.ts';
import { WorkspaceHeader } from '../../ui/workspace-header.tsx';
import { getTranslations } from '../../i18n/server.ts';

export default async function SalesReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const actor = await requirePermission('sales.view');
  const t = await getTranslations(); const query = await searchParams; const today = istToday();
  const start = istDayStart(query.from), end = istDayAfter(query.to);
  const valid = start && end && start < end && end.getTime() - start.getTime() <= 366 * 86400000;
  const from = valid ? query.from! : today, to = valid ? query.to! : today;
  const report = await getSalesReport(actor, from, to);
  const week = istToday(new Date(istDayStart(today)!.getTime() - 6 * 86400000));
  const value = (amount: bigint | null) => amount === null ? t('Unknown') : formatINR(amount);
  return <><WorkspaceHeader actor={actor} title={t('Sales reports')} /><main className="page" id="main-content" tabIndex={-1}>
    <div className="page-heading"><h1>{t('Sales reports')}</h1><a className="btn btn--secondary" href={`/reports/sales/export?from=${from}&to=${to}`}>{t('Download CSV')}</a></div>
    <p className="prose-note">{t('Completed orders are grouped by their creation date in India. Sales exclude tax and are shown before refunds. Material margins exclude labour, overhead and other expenses.')}</p>
    {(query.from || query.to) && !valid ? <p className="msg msg--warn">{t('Choose a valid date range of at most 366 days.')}</p> : null}
    <div className="flex flex-wrap gap-3"><Link href={{ pathname: '/reports/sales', query: { from: today, to: today } }}>{t('Today')}</Link>
      <Link href={{ pathname: '/reports/sales', query: { from: week, to: today } }}>{t('Last 7 days')}</Link>
      <Link href={{ pathname: '/reports/sales', query: { from: today.slice(0, 8) + '01', to: today } }}>{t('This month')}</Link></div>
    <form method="get" className="toolbar"><div className="field"><label className="label" htmlFor="from">{t('From')}</label><input className="input" id="from" name="from" type="date" defaultValue={from} required /></div>
      <div className="field"><label className="label" htmlFor="to">{t('To')}</label><input className="input" id="to" name="to" type="date" defaultValue={to} required /></div>
      <button className="btn btn--secondary">{t('Show report')}</button></form>
    <ul className="statgrid"><li className="stat"><span className="stat__label">{t('Completed orders')}</span><strong className="stat__value">{report.completedCount}</strong></li>
      <li className="stat"><span className="stat__label">{t('Revenue excluding tax (₹)')}</span><strong className="stat__value">{value(report.revenuePaise)}</strong></li>
      <li className="stat"><span className="stat__label">{t('Recorded material cost (₹)')}</span><strong className="stat__value">{value(report.costPaise)}</strong></li>
      <li className="stat"><span className="stat__label">{t('Material margin before refunds (₹)')}</span><strong className="stat__value">{value(report.marginPaise)}</strong></li></ul>
    {report.costPaise === null ? <p className="msg msg--warn">{t('Some orders had unknown material costs when sold. Their margin remains unknown; later purchases do not change saved sale costs.')}</p> : null}
    <h2 className="section-title mt-8">{t('Item sales')}</h2>
    {report.items.length ? <><p className="prose-note">{t('Most servings: {name}', { name: report.byVolume[0].name })}{' · '}{t('Fewest servings: {name}', { name: report.byVolume[report.byVolume.length - 1].name })}</p>
      {report.byMargin.length ? <p className="prose-note">{t('Highest material margin: {name}', { name: report.byMargin[0].name })}{' · '}{t('Lowest material margin: {name}', { name: report.byMargin[report.byMargin.length - 1].name })}</p> : null}
      <div className="table-wrap"><table className="table"><thead><tr><th>{t('Item')}</th><th className="num">{t('Servings sold')}</th><th className="num">{t('Revenue excluding tax (₹)')}</th><th className="num">{t('Recorded material cost (₹)')}</th><th className="num">{t('Material margin before refunds (₹)')}</th></tr></thead>
        <tbody>{report.byVolume.map(item => <tr key={item.menuItemId}><th scope="row">{item.name}</th><td className="num">{String(item.quantity)}</td><td className="num">{value(item.revenuePaise)}</td><td className="num">{value(item.costPaise)}</td><td className="num">{value(item.marginPaise)}</td></tr>)}</tbody></table></div></>
      : <p className="prose-note">{t('No completed sales in this period.')}</p>}
    <section className="form-section"><h2>{t('Payments and cancellations')}</h2><p className="prose-note">{t('Payment figures use the date the payment or refund was recorded, including payments for orders created outside this period. No payment gateway transfer is made here.')}</p>
      <dl><dt>{t('Payments recorded')}</dt><dd>{value(report.receivedPaise)}</dd><dt>{t('Refunds recorded')}</dt><dd>{value(report.refundedPaise)}</dd><dt>{t('Net payments recorded')}</dt><dd>{value(report.netReceivedPaise)}</dd>
        <dt>{t('Open orders')}</dt><dd>{report.openCount}</dd><dt>{t('Cancelled orders')}</dt><dd>{report.cancelledCount}</dd><dt>{t('Cancelled preparation material cost')}</dt><dd>{value(report.cancelledMaterialPaise)}</dd></dl></section>
  </main></>;
}
