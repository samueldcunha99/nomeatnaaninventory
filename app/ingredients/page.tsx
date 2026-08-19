import Link from 'next/link';
import { requirePermission } from '../../src/auth/server.ts';
import { hasPermission } from '../../src/lib/auth.ts';
import { listIngredients } from '../../src/db/ingredients.ts';
import { setActiveAction } from './actions.ts';
import {
  formatQty,
  formatINR,
  costPerPurchaseUnitPaise,
  milliBaseToPurchaseUnits,
  isLowStock,
  baseUnitLabel,
} from '../../src/lib/units.ts';

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
    <>
      <header className="brandbar">
        <div className="brandbar__inner">
          <Link className="brandbar__name text-on-navy no-underline" href="/">
            NO MEAT NAAN
          </Link>
          <span className="text-sm opacity-85">Ingredients</span>
        </div>
      </header>

      <main className="page">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1>Ingredients</h1>
          {canManage ? (
            <Link className="btn" href="/ingredients/new">
              + New ingredient
            </Link>
          ) : null}
        </div>

        <form method="get" className="toolbar">
          <div className="field grow max-w-xs">
            <label className="label" htmlFor="q">
              Search
            </label>
            <input className="input" id="q" name="q" defaultValue={q ?? ''} placeholder="Ingredient name" />
          </div>

          <label className="checkfield">
            <input type="checkbox" name="all" value="1" defaultChecked={!activeOnly} className="size-5" />
            Include inactive
          </label>

          <button className="btn btn--secondary" type="submit">
            Apply
          </button>
        </form>

        {rows.length === 0 ? (
          <p className="prose-note">
            No ingredients{q ? ` matching “${q}”` : ''}.
            {activeOnly ? ' Tick “include inactive” to widen the search.' : ''}
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
                    Avg cost
                  </th>
                  <th scope="col" className="col-secondary">
                    Bought by
                  </th>
                  <th scope="col">Status</th>
                  {canManage ? (
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const low = isLowStock(r.qtyMilliBase, r.lowStockThresholdMilliBase);
                  const oversold = r.qtyMilliBase < 0;
                  return (
                    <tr key={r.id}>
                      <th scope="row" className="px-3 font-semibold text-left">
                        {canManage ? (
                          <Link href={`/ingredients/${r.id}`}>{r.name}</Link>
                        ) : (
                          r.name
                        )}
                      </th>

                      {/*
                       * Purchase units lead - nobody thinks in 20,000 grams. The base-unit
                       * figure stays as a subordinate line because recipes are written in
                       * it. Both come from the shared helpers; no conversion happens here.
                       */}
                      <td className="num">
                        <span className={oversold ? 'text-danger font-semibold' : ''}>
                          {milliBaseToPurchaseUnits(r.qtyMilliBase, r.purchaseUnitInBase)} {r.purchaseUnit}
                        </span>
                        <span className="block text-xs muted tabular-nums">
                          {formatQty(r.qtyMilliBase, r.unitType)}
                        </span>
                      </td>

                      <td className="num">
                        {formatINR(
                          costPerPurchaseUnitPaise(r.weightedAvgCostMillipaisePerBase, r.purchaseUnitInBase),
                        )}
                        <span className="block text-xs muted">per {r.purchaseUnit}</span>
                      </td>

                      <td className="col-secondary muted text-sm">
                        {r.purchaseUnit} = {r.purchaseUnitInBase} {baseUnitLabel(r.unitType)}
                      </td>

                      <td>
                        <div className="flex flex-wrap items-center gap-1">
                          {oversold ? (
                            <span className="badge badge--out">
                              <Glyph kind="alert" /> Oversold
                            </span>
                          ) : low ? (
                            <span className="badge badge--low">
                              <Glyph kind="alert" /> Low
                            </span>
                          ) : (
                            <span className="badge badge--ok">
                              <Glyph kind="check" /> In stock
                            </span>
                          )}
                          {!r.isActive ? <span className="badge badge--muted">Inactive</span> : null}
                        </div>
                      </td>

                      {canManage ? (
                        <td>
                          <form action={setActiveAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="isActive" value={r.isActive ? 'false' : 'true'} />
                            <button className="btn btn--secondary text-sm px-3" type="submit">
                              {r.isActive ? 'Deactivate' : 'Reactivate'}
                              <span className="sr-only"> {r.name}</span>
                            </button>
                          </form>
                        </td>
                      ) : null}
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

/**
 * Badges must never rely on colour alone, so each carries a glyph as well as a word.
 * Inline SVG rather than an icon pack - two shapes do not justify a dependency.
 */
function Glyph({ kind }: { kind: 'alert' | 'check' }) {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="flex-none">
      {kind === 'alert' ? (
        <path d="M10 1.7 19 18H1L10 1.7Zm0 5.3a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Zm0 8.2a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z" />
      ) : (
        <path d="M8 14.2 3.8 10l1.4-1.4L8 11.4l6.8-6.8L16.2 6 8 14.2Z" />
      )}
    </svg>
  );
}
