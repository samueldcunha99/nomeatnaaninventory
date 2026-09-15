import { WorkspaceHeader } from "../../ui/workspace-header.tsx";
import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { createIngredientAction } from '../actions.ts';
import { IngredientForm } from '../ingredient-form.tsx';

export default async function NewIngredientPage() {
  const actor = await requirePermission('ingredients.manage');
  return (
    <>
      <WorkspaceHeader actor={actor} title="New ingredient" />

      <main className="page" id="main-content" tabIndex={-1}>
        <p>
          <Link href="/ingredients">← Ingredients</Link>
        </p>
        <h1>New ingredient</h1>
        <p className="prose-note">
          Stock and cost are not set here — they only ever move through the stock ledger.
        </p>
        <IngredientForm action={createIngredientAction} submitLabel="Create" />
      </main>
    </>
  );
}
