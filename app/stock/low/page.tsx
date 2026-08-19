import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { hasPermission } from '../../../src/lib/auth.ts';
import { listLowStock } from '../../../src/db/history.ts';
import { StatusBadge } from '../../ui/status-badge.tsx';
import {
  formatQty,
  formatINR,
  costPerPurchaseUnitPaise,
  milliBaseToPurchaseUnits,
} from '../../../src/lib/units.ts';

export default async function LowStockPage() {
  const actor = await requirePermission('ingredients.view');
  const rows = await listLowStock(actor);
  const canRecord = hasPermission(actor.role, 'stock.record');

  return (
    <>
      <header className="brandbar">
        <div className="brandbar__inner">
          <Link className="brandbar__name text-on-navy no-underline" href="/">
            NO MEAT NAAN
          </Link>
          <span className="text-sm opacity-85">Low stock</span>
        </div>
      </header>

      <main className="page">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1>Low stock</h1>
          {canRecord ? (
            <Link className="btn" href="/stock/receipt">
              Record a receipt
            </Link>
          ) : null}
        </div>

        <p className="prose-note">
          At or below the reorder threshold, worst first. Severity is the shortfall as a share
          of the threshold — being 2 kg short of 3 kg is more urgent than 2 kg short of 50 kg.
        </p>

        {rows.length === 0 ? (
          <p className="msg msg--ok">
            <span>
              <span className="msg__title">Nothing to reorder. </span>
              No ingredient is below its threshold.
            </span>
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Ingredient</th>
                  <th scope="col" className="num">
                    On hand
                  </th>
                  <th scope="col" className="num">
                    Threshold
                  </th>
                  <th scope="col" className="num">
                    Short by
                  </th>
                  <th scope="col" className="num col-secondary">
                    Avg cost
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const oversold = r.qtyMilliBase < 0;
                  const short = r.lowStockThresholdMilliBase - r.qtyMilliBase;
                  return (
                    <tr key={r.ingredientId}>
                      <th scope="row">
                        <Link
                          className="row-link"
                          href={{ pathname: '/stock/history', query: { ingredientId: r.ingredientId } }}
                        >
                          {r.name}
                        </Link>
                      </th>

                      <td className={`num whitespace-nowrap ${oversold ? 'text-danger font-semibold' : ''}`}>
                        {milliBaseToPurchaseUnits(r.qtyMilliBase, r.purchaseUnitInBase)} {r.purchaseUnit}
                        <span className="block text-xs muted tabular-nums">
                          {formatQty(r.qtyMilliBase, r.unitType)}
                        </span>
                      </td>

                      <td className="num whitespace-nowrap muted">
                        {milliBaseToPurchaseUnits(r.lowStockThresholdMilliBase, r.purchaseUnitInBase)}{' '}
                        {r.purchaseUnit}
                      </td>

                      <td className="num whitespace-nowrap font-semibold">
                        {milliBaseToPurchaseUnits(short, r.purchaseUnitInBase)} {r.purchaseUnit}
                      </td>

                      <td className="num col-secondary whitespace-nowrap">
                        {formatINR(
                          costPerPurchaseUnitPaise(r.weightedAvgCostMillipaisePerBase, r.purchaseUnitInBase),
                        )}
                        <span className="block text-xs muted">per {r.purchaseUnit}</span>
                      </td>

                      {/* Every row here is by definition an exception, so every row is badged. */}
                      <td>
                        <StatusBadge kind={oversold ? 'oversold' : 'low'} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
