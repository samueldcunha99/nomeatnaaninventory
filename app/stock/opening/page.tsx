import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { listIngredients } from '../../../src/db/ingredients.ts';
import { WorkspaceHeader } from '../../ui/workspace-header.tsx';
import { getTranslations } from '../../i18n/server.ts';
import { ReceiptForm } from '../receipt/receipt-form.tsx';

export default async function OpeningStockPage() {
  const actor = await requirePermission('ingredients.manage');
  const t = await getTranslations();
  const ingredients = await listIngredients(actor, { activeOnly: false });
  return <><WorkspaceHeader actor={actor} title={t('Opening stock / valuation')} />
    <main className="page" id="main-content" tabIndex={-1}>
      <p><Link href="/ingredients">{t('← Ingredients')}</Link></p>
      <h1>{t('Opening stock / valuation')}</h1>
      <p className="prose-note">{t('Enter verified starting quantities and their total inventory value. These entries establish a cost basis and are excluded from new purchases and money paid today.')}</p>
      <p className="msg msg--warn">{t('For existing stock with an unknown value, enter its current positive quantity exactly. Its quantity stays the same while the supplied value is recorded. Make physical count corrections separately. Known purchase costs cannot be replaced here.')}</p>
      <ReceiptForm requestId={crypto.randomUUID()} opening suppliers={[]} ingredients={ingredients.map(i => ({
        id: i.id, name: i.name, purchaseUnit: i.purchaseUnit, purchaseUnitInBase: i.purchaseUnitInBase,
      }))} />
    </main></>;
}
