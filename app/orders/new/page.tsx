import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { listOrderMenu, loadSalesSettings } from '../../../src/db/orders.ts';
import { hasPermission } from '../../../src/lib/auth.ts';
import { WorkspaceHeader } from '../../ui/workspace-header.tsx';
import { getTranslations } from '../../i18n/server.ts';
import { OrderForm } from '../order-form.tsx';

export default async function NewOrderPage() {
  const actor = await requirePermission('orders.record');
  const t = await getTranslations();
  const [menu, settings] = await Promise.all([listOrderMenu(actor), loadSalesSettings(actor)]);
  const canManage = hasPermission(actor.role, 'sales.manage');
  const ready = settings.taxMode != null && settings.taxRateMillipercent != null;
  return <><WorkspaceHeader actor={actor} title={t('New order')} />
    <main className="page" id="main-content" tabIndex={-1}>
      <p><Link href="/orders">{t('← Orders')}</Link></p><h1>{t('New order')}</h1>
      <p className="prose-note">{t('Choose the items and quantities. Each confirmed order keeps its own prices, tax and material-cost snapshot.')}</p>
      {!ready ? <p className="msg msg--warn" role="status">{t('Sales tax settings need an explicit choice before an order can be confirmed.')} {' '}
        {canManage ? <Link href="/settings/sales">{t('Set sales settings')}</Link> : t('Ask an owner or manager to configure sales settings.')}</p> : null}
      {!menu.some(item => item.fulfillmentMode != null) ? <p className="msg msg--warn" role="status">{t('No menu items are ready for orders. Set a serving size, selling price and inventory method on a recipe first.')} {' '}
        {hasPermission(actor.role, 'recipes.manage') ? <Link href="/recipes">{t('Open recipes')}</Link> : t('Ask an owner or manager to finish the menu setup.')}</p> : null}
      {menu.length ? <OrderForm requestId={crypto.randomUUID()} menu={menu.map(item => ({ id: item.id, name: item.name,
        sellingPricePaise: item.sellingPricePaise.toString(), fulfillmentMode: item.fulfillmentMode, updatedAt: item.updatedAt.toISOString() }))}
        taxMode={settings.taxMode} taxRate={settings.taxRateMillipercent?.toString() ?? null} /> : null}
    </main></>;
}
