import { WorkspaceHeader } from "../../ui/workspace-header.tsx";
import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { listLineSources } from '../../../src/db/recipes.ts';
import { RecipeForm } from '../recipe-form.tsx';
import { getTranslations } from '../../i18n/server.ts';

export default async function NewRecipePage() {
  const actor = await requirePermission('recipes.manage');
  const t = await getTranslations();
  const sources = await listLineSources(actor);

  return (
    <>
      <WorkspaceHeader actor={actor} title={t("New recipe")} />

      <main className="page" id="main-content" tabIndex={-1}>
        <p>
          <Link href="/recipes">{t("← Recipes")}</Link>
        </p>
        <h1>{t("New recipe")}</h1>
        <p className="prose-note">{t(" Build one batch using your saved ingredients and recipes. Add its usable yield and preparation time to calculate the cost. ")}</p>

        {sources.length === 0 ? (
          <p className="prose-note">{t(" There are no ingredients yet, so there is nothing for a line to draw on.")}{' '}
            <Link href="/ingredients/new">{t("Add an ingredient")}</Link>{t(" first. ")}</p>
        ) : (
          <RecipeForm sources={sources} submitLabel={t("Create recipe")} />
        )}
      </main>
    </>
  );
}
