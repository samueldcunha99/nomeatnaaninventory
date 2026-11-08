import { PageTutorial } from '../../ui/page-tutorial.tsx';
import { WorkspaceHeader } from "../../ui/workspace-header.tsx";
import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { listMovements } from '../../../src/db/history.ts';
import { listIngredients } from '../../../src/db/ingredients.ts';
import { TIMEZONE, istDayStart, istDayAfter } from '../../../src/lib/time.ts';
import {

  formatINR,
  costPerPurchaseUnitPaise,
  milliBaseToPurchaseUnits,
} from '../../../src/lib/units.ts';
import { getTranslations } from '../../i18n/server.ts';

const TYPE_LABEL: Record<string, string> = {
  purchase: 'Receipt',
  adjustment: 'Adjustment',
  wastage: 'Wastage',
  // NOT 'Sale'. A consumption movement is stock leaving the store, and in a kitchen
  // that is overwhelmingly a batch being made rather than an item being sold. Calling
  // it a sale would misread the ledger for the manager whose job is logging production.
  consumption: 'Used',
  reversal: 'Reversal',
  production: 'Made',
};

/** Asia/Kolkata at the display boundary; stored UTC. */
const timeOptions: Intl.DateTimeFormatOptions = {
  timeZone: TIMEZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
};

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ ingredientId?: string; from?: string; to?: string; page?: string }>;
}) {
  const actor = await requirePermission('ingredients.view');
  const t = await getTranslations();
  const IST = new Intl.DateTimeFormat(t.intlLocale, timeOptions);
  const params = await searchParams;

  const [ingredients, result] = await Promise.all([
    listIngredients(actor, { activeOnly: false }),
    listMovements(actor, {
      ingredientId: params.ingredientId || undefined,
      from: istDayStart(params.from),
      // Exclusive, and the day AFTER the one typed, so the whole of it is included.
      to: istDayAfter(params.to),
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
      <WorkspaceHeader actor={actor} title={t("Movement history")} />

      <main className="page" id="main-content" tabIndex={-1}>
      <PageTutorial topic="history" role={actor.role} />
        <h1>{t("Movement history")}</h1>
        <p className="prose-note">{t(" Read-only. Corrections are new movements — nothing here is ever edited or deleted. Times shown in Asia/Kolkata. ")}</p>

        <form method="get" className="toolbar">
          <div className="field grow max-w-xs">
            <label className="label" htmlFor="ingredientId">{t(" Ingredient ")}</label>
            <select className="select" id="ingredientId" name="ingredientId" defaultValue={params.ingredientId ?? ''}>
              <option value="">{t("All ingredients")}</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.isActive ? '' : t(" (inactive)")}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="from">{t(" From ")}</label>
            <input className="input" id="from" name="from" type="date" defaultValue={params.from ?? ''} />
          </div>

          <div className="field">
            <label className="label" htmlFor="to">{t(" To ")}</label>
            <input className="input" id="to" name="to" type="date" defaultValue={params.to ?? ''} />
          </div>

          <button className="btn btn--secondary" type="submit">{t(" Apply ")}</button>
        </form>

        {!result.showBalance ? (
          <p className="prose-note">{t(" Choose a single ingredient to see a running balance — a balance across different ingredients would be adding grams to millilitres. ")}</p>
        ) : null}

        {result.rows.length === 0 ? (
          <p className="prose-note">{t("No movements match those filters.")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("When")}</th>
                  <th scope="col">{t("Type")}</th>
                  {!params.ingredientId ? <th scope="col">{t("Ingredient")}</th> : null}
                  <th scope="col" className="num">{t(" Quantity ")}</th>
                  {result.showBalance ? (
                    <th scope="col" className="num">{t(" Balance ")}</th>
                  ) : null}
                  <th scope="col" className="num col-secondary">{t(" Unit cost ")}</th>
                  <th scope="col" className="num col-secondary">{t(" Total paid ")}</th>
                  <th scope="col" className="col-secondary">{t(" Reason / note ")}</th>
                  <th scope="col" className="col-secondary">{t(" By ")}</th>
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
                        {t(r.referenceType === 'opening_stock' ? 'Opening stock / valuation' : TYPE_LABEL[r.movementType] ?? r.movementType)}
                        {grouped ? (
                          <span className="block text-xs muted" title={t("One receipt of {0} lines", { "0": lines })}>
                            {lines}{t("-line receipt ")}</span>
                        ) : null}
                      </td>

                      {!params.ingredientId ? <td>{r.ingredientName}</td> : null}

                      <td className={`num whitespace-nowrap ${out ? 'text-danger font-semibold' : ''}`}>
                        <span>
                          {r.quantityMilliBase > 0 ? '+' : ''}
                          {milliBaseToPurchaseUnits(r.quantityMilliBase, r.purchaseUnitInBase)} {r.purchaseUnit}
                        </span>
                        <span className="block text-xs muted tabular-nums">
                          {r.quantityMilliBase > 0 ? '+' : ''}
                          {t.quantity(r.quantityMilliBase, r.unitType)}
                        </span>
                      </td>

                      {result.showBalance ? (
                        <td
                          className={`num whitespace-nowrap ${r.balanceMilliBase < 0 ? 'text-danger font-semibold' : ''}`}
                        >
                          {milliBaseToPurchaseUnits(r.balanceMilliBase, r.purchaseUnitInBase)} {r.purchaseUnit}
                          <span className="block text-xs muted tabular-nums">
                            {t.quantity(r.balanceMilliBase, r.unitType)}
                          </span>
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
                        {r.reason ? <span className="capitalize">{t(r.reason)}</span> : null}
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
          <nav className="flex items-center gap-3 mt-4" aria-label={t("Pagination")}>
            {result.hasPreviousPage ? (
              <Link className="btn btn--secondary" href={pageHref(result.page - 1)}>{t(" ← Newer ")}</Link>
            ) : null}
            {result.hasNextPage ? (
              <Link className="btn btn--secondary" href={pageHref(result.page + 1)}>{t(" Older → ")}</Link>
            ) : null}
            <span className="muted text-sm">{t("Page ")}{result.page}</span>
          </nav>
        ) : null}
      </main>
    </>
  );
}
