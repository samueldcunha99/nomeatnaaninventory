import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { createIngredientAction } from '../actions.ts';
import { IngredientForm } from '../ingredient-form.tsx';

export default async function NewIngredientPage() {
  await requirePermission('ingredients.manage');
  return (
    <>
      <header className="brandbar">
        <div className="brandbar__inner">
          <Link className="brandbar__name text-on-navy no-underline" href="/">
            NO MEAT NAAN
          </Link>
          <span className="text-sm opacity-85">New ingredient</span>
        </div>
      </header>

      <main className="page">
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
