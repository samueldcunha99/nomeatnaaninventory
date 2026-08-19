import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '../../../src/auth/server.ts';
import { getIngredient } from '../../../src/db/ingredients.ts';
import { updateIngredientAction } from '../actions.ts';
import { IngredientForm } from '../ingredient-form.tsx';
import { formatQty, formatINR, costPerPurchaseUnitPaise, milliBaseToPurchaseUnits } from '../../../src/lib/units.ts';

export default async function EditIngredientPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('ingredients.manage');
  const { id } = await params;
  const ingredient = await getIngredient(actor, id);
  if (!ingredient) notFound();

  return (
    <main style={{ maxWidth: 480 }}>
      <p>
        <Link href="/ingredients">&larr; Ingredients</Link>
      </p>
      <h1>{ingredient.name}</h1>
      <p>
        On hand <strong>{formatQty(ingredient.qtyMilliBase, ingredient.unitType)}</strong> at{' '}
        <strong>
          {formatINR(
            costPerPurchaseUnitPaise(
              ingredient.weightedAvgCostMillipaisePerBase,
              ingredient.purchaseUnitInBase,
            ),
          )}
        </strong>{' '}
        per {ingredient.purchaseUnit} (weighted average)
      </p>
      <p style={{ fontSize: 13, color: '#555' }}>
        Stock and cost move only through the stock ledger, never by editing here.
      </p>

      <IngredientForm
        action={updateIngredientAction}
        submitLabel="Save changes"
        initial={{
          id: ingredient.id,
          name: ingredient.name,
          unitType: ingredient.unitType,
          purchaseUnit: ingredient.purchaseUnit,
          purchaseUnitInBase: ingredient.purchaseUnitInBase,
          lowStockThreshold: milliBaseToPurchaseUnits(
            ingredient.lowStockThresholdMilliBase,
            ingredient.purchaseUnitInBase,
          ),
        }}
      />
    </main>
  );
}
