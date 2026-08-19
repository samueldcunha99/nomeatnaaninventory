import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { listIngredients } from '../../../src/db/ingredients.ts';
import { AdjustForm } from './adjust-form.tsx';

export default async function AdjustPage() {
  const actor = await requirePermission('stock.record');
  const ingredients = await listIngredients(actor, {});

  return (
    <>
      <header className="brandbar">
        <div className="brandbar__inner">
          <Link className="brandbar__name text-on-navy no-underline" href="/">
            NO MEAT NAAN
          </Link>
          <span className="text-sm opacity-85">Adjustment / wastage</span>
        </div>
      </header>

      <main className="page">
      <h1>Adjustment or wastage</h1>
      <p className="prose-note">
        Corrections are new movements — nothing is edited or deleted. The running stock
        follows from the ledger.
      </p>
      <AdjustForm
        ingredients={ingredients.map((i) => ({ id: i.id, name: i.name, purchaseUnit: i.purchaseUnit }))}
      />
    </main>
    </>
  );
}
