import { WorkspaceHeader } from "../../../ui/workspace-header.tsx";
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
      <WorkspaceHeader actor={actor} title="Edit recipe" />

      <main className="page" id="main-content" tabIndex={-1}>
        <p>
          <Link href={`/recipes/${recipe.id}/cost`}>← {recipe.name}</Link>
        </p>
        <h1>Edit {recipe.name}</h1>
        <p className="prose-note">
          Update the ingredients, usable batch yield and preparation time. Save to review
          the revised cost breakdown.
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
            batchMinutes: recipe.batchMinutes === null ? '' : String(recipe.batchMinutes),
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
