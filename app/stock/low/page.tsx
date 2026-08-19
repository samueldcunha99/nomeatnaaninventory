import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { hasPermission } from '../../../src/lib/auth.ts';
import { listLowStock } from '../../../src/db/history.ts';
import { formatQty, formatINR, costPerPurchaseUnitPaise } from '../../../src/lib/units.ts';

const cell = { padding: '6px 10px', borderBottom: '1px solid #ddd', textAlign: 'left' } as const;
const num = { ...cell, textAlign: 'right' } as const;

export default async function LowStockPage() {
  const actor = await requirePermission('ingredients.view');
  const rows = await listLowStock(actor);
  const canRecord = hasPermission(actor.role, 'stock.record');

  return (
    <main>
      <p>
        <Link href="/">&larr; Home</Link>
      </p>
      <h1>Low stock</h1>
      <p style={{ fontSize: 13, color: '#555' }}>
        At or below the reorder threshold, worst first. Severity is the shortfall as a share
        of the threshold — being 2 kg short of 3 kg is more urgent than 2 kg short of 50 kg.
      </p>

      {rows.length === 0 ? (
        <p>Nothing is below its threshold.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={cell}>Ingredient</th>
              <th style={num}>On hand</th>
              <th style={num}>Threshold</th>
              <th style={num}>Short by</th>
              <th style={num}>Avg cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const oversold = r.qtyMilliBase < 0;
              return (
                <tr key={r.ingredientId}>
                  <td style={cell}>
                    <Link href={{ pathname: '/stock/history', query: { ingredientId: r.ingredientId } }}>{r.name}</Link>
                    {oversold ? (
                      <strong style={{ color: '#b00' }} title="Sold more than the system thinks was in stock">
                        {' '}
                        OVERSOLD
                      </strong>
                    ) : null}
                  </td>
                  <td style={{ ...num, color: oversold ? '#b00' : undefined }}>
                    {formatQty(r.qtyMilliBase, r.unitType)}
                  </td>
                  <td style={num}>{formatQty(r.lowStockThresholdMilliBase, r.unitType)}</td>
                  <td style={num}>
                    {formatQty(r.lowStockThresholdMilliBase - r.qtyMilliBase, r.unitType)}
                  </td>
                  <td style={num}>
                    {formatINR(
                      costPerPurchaseUnitPaise(r.weightedAvgCostMillipaisePerBase, r.purchaseUnitInBase),
                    )}
                    <span style={{ color: '#555' }}> / {r.purchaseUnit}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {canRecord ? (
        <p style={{ marginTop: 12 }}>
          <Link href="/stock/receipt">Record a receipt</Link>
        </p>
      ) : null}
    </main>
  );
}
