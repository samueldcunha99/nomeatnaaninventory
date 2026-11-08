import { PageTutorial } from '../../ui/page-tutorial.tsx';
import { WorkspaceHeader } from "../../ui/workspace-header.tsx";
import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { createIngredientAction } from '../actions.ts';
import { IngredientForm } from '../ingredient-form.tsx';
import { getTranslations } from '../../i18n/server.ts';

export default async function NewIngredientPage() {
  const actor = await requirePermission('ingredients.manage');
  const t = await getTranslations();
  return (
    <>
      <WorkspaceHeader actor={actor} title={t("New ingredient")} />

      <main className="page" id="main-content" tabIndex={-1}>
      <PageTutorial topic="ingredientNew" role={actor.role} />
        <p>
          <Link href="/ingredients">{t("← Ingredients")}</Link>
        </p>
        <h1>{t("New ingredient")}</h1>
        <p className="prose-note">{t(" Stock and cost are not set here — they only ever move through the stock ledger. ")}</p>
        <IngredientForm action={createIngredientAction} submitLabel={t("Create")} />
      </main>
    </>
  );
}
