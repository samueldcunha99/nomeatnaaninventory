import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { listIngredients } from '../../../src/db/ingredients.ts';
import { listSuppliers } from '../../../src/db/movements.ts';
import { ReceiptForm } from './receipt-form.tsx';

export default async function ReceiptPage() {
  const actor = await requirePermission('stock.record');
  const [ingredients, suppliers] = await Promise.all([
    listIngredients(actor, {}),
    listSuppliers(actor),
  ]);

  return (
    <>
      <header className="brandbar">
        <div className="brandbar__inner">
          <Link className="brandbar__name text-on-navy no-underline" href="/">
            NO MEAT NAAN
          </Link>
          <span className="text-sm opacity-85">Stock receipt</span>
        </div>
      </header>

      <main className="page">
      <h1>Stock receipt</h1>
      <p className="prose-note">
        Enter quantities in the unit you buy in, and what was actually paid for that line.
        The unit cost is worked out for you — check it against the delivery note before saving.
      </p>
      <ReceiptForm
        ingredients={ingredients.map((i) => ({
          id: i.id,
          name: i.name,
          purchaseUnit: i.purchaseUnit,
          purchaseUnitInBase: i.purchaseUnitInBase,
        }))}
        suppliers={suppliers}
      />
    </main>
    </>
  );
}
