import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '../../../../src/auth/server.ts';
import { getRecipeForEdit, listLineSources } from '../../../../src/db/recipes.ts';
import { RecipeForm } from '../../recipe-form.tsx';
import { milliBaseToBaseUnits, millipercentToPercent } from '../../../../src/lib/units.ts';

export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('recipes.manage');
  const { id } = await params;

  const [recipe, sources] = await Promise.all([
    getRecipeForEdit(actor, id),
    listLineSources(actor, id),
  ]);
  if (!recipe) notFound();

  return (
    <>
      <header className="brandbar">
        <div className="brandbar__inner">
          <Link className="brandbar__name text-on-navy no-underline" href="/">
            NO MEAT NAAN
          </Link>
          <span className="text-sm opacity-85">Edit recipe</span>
        </div>
      </header>

      <main className="page">
        <p>
          <Link href={`/recipes/${recipe.id}/cost`}>← {recipe.name}</Link>
        </p>
        <h1>Edit {recipe.name}</h1>
        <p className="prose-note">
          Saving replaces the whole line list. The lines that were here are kept as history,
          not deleted, and every cost figure is recalculated from the ledger on the next
          screen.
        </p>

        <RecipeForm
          sources={sources}
          submitLabel="Save changes"
          initial={{
            id: recipe.id,
            name: recipe.name,
            yieldUnitType: recipe.yieldUnitType,
            // Exact round trip: what is stored comes back into the box unchanged.
            yieldQty: milliBaseToBaseUnits(recipe.yieldQtyMilliBase),
            notes: recipe.notes ?? '',
            lines: recipe.lines.map((l) => ({
              sourceId: l.sourceId,
              quantity: milliBaseToBaseUnits(l.quantityMilliBase),
              // No wastage is a blank box, not a nought to clear before typing.
              wastage:
                l.wastageMillipercent === 0n ? '' : millipercentToPercent(l.wastageMillipercent),
            })),
          }}
        />
      </main>
    </>
  );
}
