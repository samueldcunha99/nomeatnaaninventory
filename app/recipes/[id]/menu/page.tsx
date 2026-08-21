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
      <header className="brandbar">
        <div className="brandbar__inner">
          <Link className="brandbar__name text-on-navy no-underline" href="/">
            NO MEAT NAAN
          </Link>
          <span className="text-sm opacity-85">Menu items</span>
        </div>
      </header>

      <main className="page">
        <p>
          <Link href={`/recipes/${recipe.id}/cost`}>← {recipe.name}</Link>
        </p>
        <h1>What {recipe.name} sells as</h1>
        <p className="prose-note">
          One batch yields {formatQty(recipe.yieldQtyMilliBase, recipe.yieldUnitType)}. A portion
          is how much of that batch one sale takes, so the cost of a portion follows the
          ledger without anyone retyping it.
        </p>

        {items.length === 0 ? (
          <p className="prose-note">Nothing sells this yet.</p>
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

        <h2 className="section-title mt-8">Add another</h2>
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
