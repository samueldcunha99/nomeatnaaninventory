import { PageTutorial } from '../../ui/page-tutorial.tsx';
import { WorkspaceHeader } from "../../ui/workspace-header.tsx";
import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { listIngredients } from '../../../src/db/ingredients.ts';
import { AdjustForm } from './adjust-form.tsx';
import { getTranslations } from '../../i18n/server.ts';

export default async function AdjustPage() {
  const actor = await requirePermission('stock.record');
  const t = await getTranslations();
  const ingredients = await listIngredients(actor, {});

  return (
    <>
      <WorkspaceHeader actor={actor} title={t("Adjustment / wastage")} />

      <main className="page" id="main-content" tabIndex={-1}>
      <PageTutorial topic="adjustment" role={actor.role} />
      <h1>{t("Adjustment or wastage")}</h1>
      <p className="prose-note">{t(" Corrections are new movements — nothing is edited or deleted. The running stock follows from the ledger. ")}</p>
      <AdjustForm
        ingredients={ingredients.map((i) => ({ id: i.id, name: i.name, purchaseUnit: i.purchaseUnit, purchaseUnitInBase: i.purchaseUnitInBase }))}
      />
    </main>
    </>
  );
}
