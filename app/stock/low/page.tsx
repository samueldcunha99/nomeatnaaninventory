import { PageTutorial } from '../../ui/page-tutorial.tsx';
import { WorkspaceHeader } from "../../ui/workspace-header.tsx";
import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { hasPermission } from '../../../src/lib/auth.ts';
import { listLowStock } from '../../../src/db/history.ts';
import { StatusBadge } from '../../ui/status-badge.tsx';
import {

  formatINR,
  costPerPurchaseUnitPaise,
  milliBaseToPurchaseUnits,
} from '../../../src/lib/units.ts';
import { getTranslations } from '../../i18n/server.ts';

export default async function LowStockPage() {
  const actor = await requirePermission('ingredients.view');
  const t = await getTranslations();
  const rows = await listLowStock(actor);
  const canRecord = hasPermission(actor.role, 'stock.record');

  return (
    <>
      <WorkspaceHeader actor={actor} title={t("Low stock")} />

      <main className="page" id="main-content" tabIndex={-1}>
      <PageTutorial topic="lowStock" role={actor.role} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1>{t("Low stock")}</h1>
          {canRecord ? (
            <Link className="btn" href="/stock/receipt">{t(" Record a receipt ")}</Link>
          ) : null}
        </div>

        <p className="prose-note">{t(" At or below the reorder threshold, worst first. Severity is the shortfall as a share of the threshold — being 2 kg short of 3 kg is more urgent than 2 kg short of 50 kg. ")}</p>

        {rows.length === 0 ? (
          <p className="msg msg--ok">
            <span>
              <span className="msg__title">{t("Nothing to reorder. ")}</span>{t(" No ingredient is below its threshold. ")}</span>
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("Ingredient")}</th>
                  <th scope="col" className="num">{t(" On hand ")}</th>
                  <th scope="col" className="num">{t(" Threshold ")}</th>
                  <th scope="col" className="num">{t(" Short by ")}</th>
                  <th scope="col" className="num col-secondary">{t(" Avg cost ")}</th>
                  <th scope="col">{t("Status")}</th>
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
                          {t.quantity(r.qtyMilliBase, r.unitType)}
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
                        {/* Never bought, so never priced. A zero here would read as free. */}
                        {r.weightedAvgCostMillipaisePerBase === null ? (
                          <span className="muted">{t("Not yet priced")}</span>
                        ) : (
                          <>
                            {formatINR(
                              costPerPurchaseUnitPaise(
                                r.weightedAvgCostMillipaisePerBase,
                                r.purchaseUnitInBase,
                              ),
                            )}
                            <span className="block text-xs muted">{t("per ")}{r.purchaseUnit}</span>
                          </>
                        )}
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
