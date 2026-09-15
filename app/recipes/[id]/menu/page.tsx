import { WorkspaceHeader } from "../../../ui/workspace-header.tsx";
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '../../../../src/auth/server.ts';
import { getRecipeForEdit, listMenuItems } from '../../../../src/db/recipes.ts';
import { MenuItemForm } from '../../menu-item-form.tsx';
import { formatQty, milliBaseToBaseUnits, paiseToRupees } from '../../../../src/lib/units.ts';

/**
 * Every menu item for one recipe, each its own form, plus a blank one to add another.
 *
 * One screen rather than a new-and-edit pair: a recipe has one or two menu items, and
 * seeing them together is how someone notices that the half portion is priced at more
 * than half. The margin for each is on the cost breakdown, one link away.
 */
export default async function MenuItemsPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('recipes.manage');
  const { id } = await params;

  const [recipe, items] = await Promise.all([getRecipeForEdit(actor, id), listMenuItems(actor, id)]);
  if (!recipe) notFound();

  return (
    <>
      <WorkspaceHeader actor={actor} title="Menu items" />

      <main className="page" id="main-content" tabIndex={-1}>
        <p>
          <Link href={`/recipes/${recipe.id}/cost`}>← {recipe.name}</Link>
        </p>
        <h1>Portions & selling prices</h1>
        <p className="prose-note">
          {recipe.name} yields {formatQty(recipe.yieldQtyMilliBase, recipe.yieldUnitType)} per batch.
          Set how much goes into one serving and what the customer pays. You can add different sizes or packs.
        </p>

        {items.length === 0 ? (
          <p className="msg msg--info">Add a serving below to see its cost and margin on the recipe breakdown.</p>
        ) : (
          items.map((item) => (
            <section key={item.id}>
              <h2 className="section-title">
                {item.name}
                {!item.isActive ? <span className="badge badge--muted ml-2">Off menu</span> : null}
              </h2>
              <MenuItemForm
                recipeId={recipe.id}
                yieldUnitType={recipe.yieldUnitType}
                submitLabel="Save changes"
                initial={{
                  id: item.id,
                  name: item.name,
                  portionQty: milliBaseToBaseUnits(item.portionQtyMilliBase),
                  // Paise back to rupees, exactly — the same round trip a quantity makes.
                  sellingPrice: paiseToRupees(item.sellingPricePaise),
                  isActive: item.isActive,
                }}
              />
            </section>
          ))
        )}

        <h2 className="section-title mt-8">{items.length ? 'Add another serving or pack' : 'Add your first menu item'}</h2>
        <MenuItemForm
          recipeId={recipe.id}
          yieldUnitType={recipe.yieldUnitType}
          submitLabel="Add to the menu"
        />

        <p className="prose-note mt-4">
          Prices here are what the customer pays. What each one earns is on the{' '}
          <Link href={`/recipes/${recipe.id}/cost`}>cost breakdown</Link>, next to what it
          costs to make.
        </p>
      </main>
    </>
  );
}
