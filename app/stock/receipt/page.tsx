import { PageTutorial } from '../../ui/page-tutorial.tsx';
import { WorkspaceHeader } from "../../ui/workspace-header.tsx";
import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { listIngredients } from '../../../src/db/ingredients.ts';
import { listSuppliers } from '../../../src/db/movements.ts';
import { ReceiptForm } from './receipt-form.tsx';
import { getTranslations } from '../../i18n/server.ts';

export default async function ReceiptPage() {
  const actor = await requirePermission('stock.record');
  const t = await getTranslations();
  const [ingredients, suppliers] = await Promise.all([
    listIngredients(actor, {}),
    listSuppliers(actor),
  ]);

  return (
    <>
      <WorkspaceHeader actor={actor} title={t("Stock receipt")} />

      <main className="page" id="main-content" tabIndex={-1}>
      <PageTutorial topic="receipt" role={actor.role} />
      <h1>{t("Stock receipt")}</h1>
      <p className="prose-note">{t(" Enter quantities in the unit you buy in, and what was actually paid for that line. The unit cost is worked out for you — check it against the delivery note before saving. ")}</p>
      <ReceiptForm
        requestId={crypto.randomUUID()}
        ingredients={ingredients.map((i) => ({
          id: i.id,
          name: i.name,
          purchaseUnit: i.purchaseUnit,
          purchaseUnitInBase: i.purchaseUnitInBase,
        }))}
        suppliers={suppliers}
      />
    </main>
    </>
  );
}
