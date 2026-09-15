import { WorkspaceHeader } from "../../ui/workspace-header.tsx";
import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { listLineSources } from '../../../src/db/recipes.ts';
import { RecipeForm } from '../recipe-form.tsx';

export default async function NewRecipePage() {
  const actor = await requirePermission('recipes.manage');
  const sources = await listLineSources(actor);

  return (
    <>
      <WorkspaceHeader actor={actor} title="New recipe" />

      <main className="page" id="main-content" tabIndex={-1}>
        <p>
          <Link href="/recipes">← Recipes</Link>
        </p>
        <h1>New recipe</h1>
        <p className="prose-note">
          Build one batch using your saved ingredients and recipes. Add its usable yield
          and preparation time to calculate the cost.
        </p>

        {sources.length === 0 ? (
          <p className="prose-note">
            There are no ingredients yet, so there is nothing for a line to draw on.{' '}
            <Link href="/ingredients/new">Add an ingredient</Link> first.
          </p>
        ) : (
          <RecipeForm sources={sources} submitLabel="Create recipe" />
        )}
      </main>
    </>
  );
}
