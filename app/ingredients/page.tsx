import Link from 'next/link';
import { requirePermission } from '../../src/auth/server.ts';
import { hasPermission } from '../../src/lib/auth.ts';
import { listIngredients } from '../../src/db/ingredients.ts';
import { setActiveAction } from './actions.ts';
import { formatQty, formatINR, costPerPurchaseUnitPaise, isLowStock } from '../../src/lib/units.ts';

const cell = { padding: '6px 10px', borderBottom: '1px solid #ddd', textAlign: 'left' } as const;
const num = { ...cell, textAlign: 'right' } as const;

export default async function IngredientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; all?: string }>;
}) {
  const actor = await requirePermission('ingredients.view');
  const { q, all } = await searchParams;
  const activeOnly = all !== '1';
  const rows = await listIngredients(actor, { search: q, activeOnly });

  // Governs what is rendered, not what is allowed - every mutation re-checks.
  const canManage = hasPermission(actor.role, 'ingredients.manage');

  return (
    <main>
      <p>
        <Link href="/">&larr; Home</Link>
      </p>
      <h1>Ingredients</h1>

      <form method="get" style={{ marginBottom: 16 }}>
        <input name="q" defaultValue={q ?? ''} placeholder="Search by name" aria-label="Search by name" />
        <label style={{ marginLeft: 12 }}>
          <input type="checkbox" name="all" value="1" defaultChecked={!activeOnly} /> Include inactive
        </label>
        <button type="submit" style={{ marginLeft: 8 }}>
          Apply
        </button>
      </form>

      {canManage ? (
        <p>
          <Link href="/ingredients/new">+ New ingredient</Link>
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p>No ingredients{q ? ` matching "${q}"` : ''}.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={cell}>Name</th>
              <th style={cell}>Purchase unit</th>
              <th style={num}>On hand</th>
              <th style={num}>Avg cost</th>
              <th style={cell}>Status</th>
              {canManage ? <th style={cell}>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const low = isLowStock(r.qtyMilliBase, r.lowStockThresholdMilliBase);
              return (
                <tr key={r.id}>
                  <td style={cell}>
                    {canManage ? <Link href={`/ingredients/${r.id}`}>{r.name}</Link> : r.name}
                  </td>
                  <td style={cell}>
                    {r.purchaseUnit} ({r.purchaseUnitInBase})
                  </td>
                  <td style={num}>
                    {formatQty(r.qtyMilliBase, r.unitType)}
                    {low ? (
                      <span style={{ color: '#b00', marginLeft: 6 }} title="At or below the low stock threshold">
                        LOW
                      </span>
                    ) : null}
                  </td>
                  <td style={num}>
                    {formatINR(costPerPurchaseUnitPaise(r.weightedAvgCostMillipaisePerBase, r.purchaseUnitInBase))}
                    <span style={{ color: '#555' }}> / {r.purchaseUnit}</span>
                  </td>
                  <td style={cell}>{r.isActive ? 'Active' : 'Inactive'}</td>
                  {canManage ? (
                    <td style={cell}>
                      <form action={setActiveAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="isActive" value={r.isActive ? 'false' : 'true'} />
                        <button type="submit">{r.isActive ? 'Deactivate' : 'Reactivate'}</button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
