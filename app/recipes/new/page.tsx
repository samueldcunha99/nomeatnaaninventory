import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { listLineSources } from '../../../src/db/recipes.ts';
import { RecipeForm } from '../recipe-form.tsx';

export default async function NewRecipePage() {
  const actor = await requirePermission('recipes.manage');
  const sources = await listLineSources(actor);

  return (
    <>
      <header className="brandbar">
        <div className="brandbar__inner">
          <Link className="brandbar__name text-on-navy no-underline" href="/">
            NO MEAT NAAN
          </Link>
          <span className="text-sm opacity-85">New recipe</span>
        </div>
      </header>

      <main className="page">
        <p>
          <Link href="/recipes">← Recipes</Link>
        </p>
        <h1>New recipe</h1>
        <p className="prose-note">
          No prices are entered here. What a recipe costs comes from the stock ledger and
          moves on its own when a delivery is recorded.
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
