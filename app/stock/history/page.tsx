import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { listMovements } from '../../../src/db/history.ts';
import { listIngredients } from '../../../src/db/ingredients.ts';
import { formatQty, formatINR, costPerPurchaseUnitPaise } from '../../../src/lib/units.ts';

const TYPE_LABEL: Record<string, string> = {
  purchase: 'Receipt',
  adjustment: 'Adjustment',
  wastage: 'Wastage',
  consumption: 'Sale',
  reversal: 'Reversal',
};

/** Asia/Kolkata at the display boundary; stored UTC. */
const IST = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** A date typed into a form is a Kolkata calendar day, not a UTC instant. */
function istDayStart(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T00:00:00+05:30`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
function istDayEnd(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T23:59:59.999+05:30`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ ingredientId?: string; from?: string; to?: string; page?: string }>;
}) {
  const actor = await requirePermission('ingredients.view');
  const params = await searchParams;

  const [ingredients, result] = await Promise.all([
    listIngredients(actor, { activeOnly: false }),
    listMovements(actor, {
      ingredientId: params.ingredientId || undefined,
      from: istDayStart(params.from),
      to: istDayEnd(params.to),
      page: Number(params.page) || 1,
    }),
  ]);

  // An object href rather than a built string: typedRoutes rejects an arbitrary string,
  // and this keeps the query parameters structured instead of hand-concatenated.
  const pageHref = (page: number) => ({
    pathname: '/stock/history' as const,
    query: {
      ...(params.ingredientId ? { ingredientId: params.ingredientId } : {}),
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
      page: String(page),
    },
  });

  // Alternating shading per reference_id, so the lines of one receipt read as one event.
  const groupShade = new Map<string, boolean>();
  const groupSize = new Map<string, number>();
  let toggle = false;
  for (const row of result.rows) {
    if (!row.referenceId) continue;
    if (!groupShade.has(row.referenceId)) {
      groupShade.set(row.referenceId, toggle);
      toggle = !toggle;
    }
    groupSize.set(row.referenceId, (groupSize.get(row.referenceId) ?? 0) + 1);
  }

  return (
    <>
      <header className="brandbar">
        <div className="brandbar__inner">
          <Link className="brandbar__name text-on-navy no-underline" href="/">
            NO MEAT NAAN
          </Link>
          <span className="text-sm opacity-85">Movement history</span>
        </div>
      </header>

      <main className="page">
        <h1>Movement history</h1>
        <p className="prose-note">
          Read-only. Corrections are new movements — nothing here is ever edited or deleted.
          Times shown in Asia/Kolkata.
        </p>

        <form method="get" className="toolbar">
          <div className="field grow max-w-xs">
            <label className="label" htmlFor="ingredientId">
              Ingredient
            </label>
            <select className="select" id="ingredientId" name="ingredientId" defaultValue={params.ingredientId ?? ''}>
              <option value="">All ingredients</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.isActive ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="from">
              From
            </label>
            <input className="input" id="from" name="from" type="date" defaultValue={params.from ?? ''} />
          </div>

          <div className="field">
            <label className="label" htmlFor="to">
              To
            </label>
            <input className="input" id="to" name="to" type="date" defaultValue={params.to ?? ''} />
          </div>

          <button className="btn btn--secondary" type="submit">
            Apply
          </button>
        </form>

        {!result.showBalance ? (
          <p className="prose-note">
            Choose a single ingredient to see a running balance — a balance across different
            ingredients would be adding grams to millilitres.
          </p>
        ) : null}

        {result.rows.length === 0 ? (
          <p className="prose-note">No movements match those filters.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Type</th>
                  {!params.ingredientId ? <th scope="col">Ingredient</th> : null}
                  <th scope="col" className="num">
                    Quantity
                  </th>
                  {result.showBalance ? (
                    <th scope="col" className="num">
                      Balance
                    </th>
                  ) : null}
                  <th scope="col" className="num col-secondary">
                    Unit cost
                  </th>
                  <th scope="col" className="num col-secondary">
                    Total paid
                  </th>
                  <th scope="col" className="col-secondary">
                    Reason / note
                  </th>
                  <th scope="col" className="col-secondary">
                    By
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => {
                  const shaded = r.referenceId ? groupShade.get(r.referenceId) : false;
                  const lines = r.referenceId ? (groupSize.get(r.referenceId) ?? 0) : 0;
                  const grouped = lines > 1;
                  const out = r.quantityMilliBase < 0;
                  return (
                    <tr key={r.id} className={shaded ? 'bg-sky/20' : undefined}>
                      <th scope="row" className="text-sm font-normal whitespace-nowrap">
                        {IST.format(r.createdAt)}
                      </th>

                      <td className="whitespace-nowrap">
                        {TYPE_LABEL[r.movementType] ?? r.movementType}
                        {grouped ? (
                          <span className="block text-xs muted" title={`One receipt of ${lines} lines`}>
                            {lines}-line receipt
                          </span>
                        ) : null}
                      </td>

                      {!params.ingredientId ? <td>{r.ingredientName}</td> : null}

                      <td className={`num whitespace-nowrap ${out ? 'text-danger font-semibold' : ''}`}>
                        {r.quantityMilliBase > 0 ? '+' : ''}
                        {formatQty(r.quantityMilliBase, r.unitType)}
                      </td>

                      {result.showBalance ? (
                        <td
                          className={`num whitespace-nowrap ${r.balanceMilliBase < 0 ? 'text-danger font-semibold' : ''}`}
                        >
                          {formatQty(r.balanceMilliBase, r.unitType)}
                        </td>
                      ) : null}

                      <td className="num col-secondary whitespace-nowrap">
                        {r.unitCostMillipaisePerBase == null
                          ? '—'
                          : formatINR(costPerPurchaseUnitPaise(r.unitCostMillipaisePerBase, r.purchaseUnitInBase))}
                      </td>

                      <td className="num col-secondary whitespace-nowrap">
                        {r.totalCostPaise == null ? '—' : formatINR(r.totalCostPaise)}
                      </td>

                      <td className="col-secondary text-sm">
                        {r.reason ? <span className="capitalize">{r.reason.replace(/_/g, ' ')}</span> : null}
                        {r.reason && r.note ? ' — ' : ''}
                        {r.note ?? ''}
                        {!r.reason && !r.note ? '—' : ''}
                      </td>

                      <td className="col-secondary text-sm muted">
                        {r.userName ?? '—'}
                        {r.supplierName ? (
                          <span className="block text-xs">{r.supplierName}</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {result.hasPreviousPage || result.hasNextPage ? (
          <nav className="flex items-center gap-3 mt-4" aria-label="Pagination">
            {result.hasPreviousPage ? (
              <Link className="btn btn--secondary" href={pageHref(result.page - 1)}>
                ← Newer
              </Link>
            ) : null}
            {result.hasNextPage ? (
              <Link className="btn btn--secondary" href={pageHref(result.page + 1)}>
                Older →
              </Link>
            ) : null}
            <span className="muted text-sm">Page {result.page}</span>
          </nav>
        ) : null}
      </main>
    </>
  );
}
