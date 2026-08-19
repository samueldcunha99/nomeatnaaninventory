import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { listIngredients } from '../../../src/db/ingredients.ts';
import { AdjustForm } from './adjust-form.tsx';

export default async function AdjustPage() {
  const actor = await requirePermission('stock.record');
  const ingredients = await listIngredients(actor, {});

  return (
    <main>
      <p>
        <Link href="/">&larr; Home</Link>
      </p>
      <h1>Adjustment or wastage</h1>
      <p style={{ fontSize: 13, color: '#555' }}>
        Corrections are new movements — nothing is edited or deleted. The running stock
        follows from the ledger.
      </p>
      <AdjustForm
        ingredients={ingredients.map((i) => ({ id: i.id, name: i.name, purchaseUnit: i.purchaseUnit }))}
      />
    </main>
  );
}
