import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { createIngredientAction } from '../actions.ts';
import { IngredientForm } from '../ingredient-form.tsx';

export default async function NewIngredientPage() {
  await requirePermission('ingredients.manage');
  return (
    <main style={{ maxWidth: 480 }}>
      <p>
        <Link href="/ingredients">&larr; Ingredients</Link>
      </p>
      <h1>New ingredient</h1>
      <IngredientForm action={createIngredientAction} submitLabel="Create" />
    </main>
  );
}
