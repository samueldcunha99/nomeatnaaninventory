import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { listMovements } from '../../../src/db/history.ts';
import { listIngredients } from '../../../src/db/ingredients.ts';
import { formatQty, formatINR, costPerPurchaseUnitPaise } from '../../../src/lib/units.ts';

const cell = { padding: '6px 10px', borderBottom: '1px solid #ddd', textAlign: 'left' } as const;
const num = { ...cell, textAlign: 'right' } as const;

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
  let toggle = false;
  for (const row of result.rows) {
    if (!row.referenceId) continue;
    if (!groupShade.has(row.referenceId)) {
      groupShade.set(row.referenceId, toggle);
      toggle = !toggle;
    }
  }
  const groupSize = new Map<string, number>();
  for (const row of result.rows) {
    if (row.referenceId) groupSize.set(row.referenceId, (groupSize.get(row.referenceId) ?? 0) + 1);
  }

  return (
    <main>
      <p>
        <Link href="/">&larr; Home</Link>
      </p>
      <h1>Movement history</h1>
      <p style={{ fontSize: 13, color: '#555' }}>
        Read-only. Corrections are new movements — nothing here is ever edited or deleted.
        Times shown in Asia/Kolkata.
      </p>

      <form method="get" style={{ marginBottom: 16 }}>
        <label htmlFor="ingredientId">Ingredient</label>{' '}
        <select id="ingredientId" name="ingredientId" defaultValue={params.ingredientId ?? ''}>
          <option value="">All</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
              {i.isActive ? '' : ' (inactive)'}
            </option>
          ))}
        </select>{' '}
        <label htmlFor="from">From</label>{' '}
        <input id="from" name="from" type="date" defaultValue={params.from ?? ''} />{' '}
        <label htmlFor="to">To</label>{' '}
        <input id="to" name="to" type="date" defaultValue={params.to ?? ''} />{' '}
        <button type="submit">Apply</button>
      </form>

      {!result.showBalance ? (
        <p style={{ fontSize: 13, color: '#555' }}>
          Choose a single ingredient to see a running balance — a balance across different
          ingredients would be adding grams to millilitres.
        </p>
      ) : null}

      {result.rows.length === 0 ? (
        <p>No movements match those filters.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={cell}>When</th>
              <th style={cell}>Type</th>
              {!params.ingredientId ? <th style={cell}>Ingredient</th> : null}
              <th style={num}>Quantity</th>
              {result.showBalance ? <th style={num}>Balance</th> : null}
              <th style={num}>Unit cost</th>
              <th style={num}>Total paid</th>
              <th style={cell}>Reason / note</th>
              <th style={cell}>By</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => {
              const shaded = r.referenceId ? groupShade.get(r.referenceId) : false;
              const grouped = r.referenceId ? (groupSize.get(r.referenceId) ?? 0) > 1 : false;
              return (
                <tr key={r.id} style={shaded ? { background: '#f5f5f5' } : undefined}>
                  <td style={cell}>{IST.format(r.createdAt)}</td>
                  <td style={cell}>
                    {TYPE_LABEL[r.movementType] ?? r.movementType}
                    {grouped ? (
                      <span style={{ color: '#555' }} title={`Part of one receipt of ${groupSize.get(r.referenceId!)} lines`}>
                        {' '}
                        ⧉
                      </span>
                    ) : null}
                  </td>
                  {!params.ingredientId ? <td style={cell}>{r.ingredientName}</td> : null}
                  <td style={{ ...num, color: r.quantityMilliBase < 0 ? '#b00' : undefined }}>
                    {r.quantityMilliBase > 0 ? '+' : ''}
                    {formatQty(r.quantityMilliBase, r.unitType)}
                  </td>
                  {result.showBalance ? (
                    <td style={{ ...num, color: r.balanceMilliBase < 0 ? '#b00' : undefined }}>
                      {formatQty(r.balanceMilliBase, r.unitType)}
                    </td>
                  ) : null}
                  <td style={num}>
                    {r.unitCostMillipaisePerBase == null
                      ? '—'
                      : formatINR(costPerPurchaseUnitPaise(r.unitCostMillipaisePerBase, r.purchaseUnitInBase))}
                  </td>
                  <td style={num}>{r.totalCostPaise == null ? '—' : formatINR(r.totalCostPaise)}</td>
                  <td style={cell}>
                    {r.reason ? r.reason.replace(/_/g, ' ') : ''}
                    {r.reason && r.note ? ' — ' : ''}
                    {r.note ?? ''}
                    {!r.reason && !r.note ? '—' : ''}
                  </td>
                  <td style={cell}>
                    {r.userName ?? '—'}
                    {r.supplierName ? ` · ${r.supplierName}` : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: 12 }}>
        {result.hasPreviousPage ? <Link href={pageHref(result.page - 1)}>&larr; Newer</Link> : null}
        {result.hasPreviousPage && result.hasNextPage ? ' · ' : ''}
        {result.hasNextPage ? <Link href={pageHref(result.page + 1)}>Older &rarr;</Link> : null}
        {result.hasPreviousPage || result.hasNextPage ? (
          <span style={{ color: '#555' }}> (page {result.page})</span>
        ) : null}
      </p>
    </main>
  );
}
