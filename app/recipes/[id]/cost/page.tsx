import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '../../../../src/auth/server.ts';
import { hasPermission } from '../../../../src/lib/auth.ts';
import { getRecipeCostBreakdown, type Breakdown } from '../../../../src/db/recipes.ts';
import { portionCostPaise, menuItemMargin, type RecipeExplanation } from '../../../../src/lib/costing.ts';
import {
  formatINR,
  formatQty,
  costPerPurchaseUnitPaise,
  unitCostMillipaisePerBase,
  millipercentToPercent,
  rupeesToPaise,
  type UnitType,
} from '../../../../src/lib/units.ts';
import { Glyph } from '../../../ui/status-badge.tsx';

const ALERT = 'M10 1.7 19 18H1L10 1.7Zm0 5.3a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Zm0 8.2a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z';

/** Millipaise per base unit is nobody's idea of a price. Per kilo, per litre, or each. */
function perUnit(unitType: UnitType): { inBase: number; label: string } {
  if (unitType === 'count') return { inBase: 1, label: 'each' };
  return { inBase: 1000, label: unitType === 'volume' ? 'per litre' : 'per kg' };
}

function Rate({ rate, unitType }: { rate: bigint; unitType: UnitType }) {
  const u = perUnit(unitType);
  return (
    <>
      {formatINR(costPerPurchaseUnitPaise(rate, u.inBase))}
      <span className="block text-xs muted">{u.label}</span>
    </>
  );
}

/**
 * One recipe's lines, biggest contributor first.
 *
 * Sorted by cost rather than by entry order because the question this screen answers is
 * "what is expensive here", and the answer should be the first row. Recipes carry no
 * stored line order to preserve.
 */
function Lines({
  explanation,
  sources,
  nested = false,
}: {
  explanation: RecipeExplanation;
  sources: Breakdown['sources'];
  nested?: boolean;
}) {
  const lines = [...explanation.lines].sort((a, b) =>
    a.contributionPaise === b.contributionPaise ? 0 : b.contributionPaise > a.contributionPaise ? 1 : -1,
  );
  const total = explanation.batchPaise;

  return (
    <table className={`table${nested ? ' table--nested' : ''}`}>
      <thead>
        <tr>
          <th scope="col">{nested ? 'Goes into ' + explanation.name : 'Ingredient'}</th>
          <th scope="col" className="num">
            Quantity
          </th>
          <th scope="col" className="num col-secondary">
            Rate
          </th>
          <th scope="col" className="num">
            Cost
          </th>
          <th scope="col" className="num w-32">
            Share
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, i) => {
          const source = sources[line.sourceId] ?? { name: line.sourceId, unitType: 'weight' as UnitType };
          // Integer percent of the batch, for the bar and the figure beside it.
          const share = total > 0n ? Number(line.contributionPaise) / Number(total) : 0;
          return [
            <tr key={line.sourceId + i}>
              <th scope="row">
                {source.name}
                {line.wastageMillipercent > 0n ? (
                  <span className="block text-xs muted font-normal">
                    {formatQty(line.quantityMilliBase, source.unitType)} plus{' '}
                    {millipercentToPercent(line.wastageMillipercent)}% wastage
                  </span>
                ) : null}
              </th>
              <td className="num whitespace-nowrap">
                {formatQty(line.effectiveMilliBase, source.unitType)}
              </td>
              <td className="num whitespace-nowrap col-secondary">
                <Rate rate={line.rateMillipaisePerBase} unitType={source.unitType} />
              </td>
              <td className="num whitespace-nowrap font-semibold">
                {formatINR(line.contributionPaise)}
              </td>
              <td className="num w-32">
                <span className="tabular-nums">{(share * 100).toFixed(1)}%</span>
                {/* Decoration on top of the figure, never instead of it. */}
                <span className="costbar mt-1" aria-hidden="true">
                  <span
                    className={`costbar__fill${i === 0 ? ' costbar__fill--top' : ''}`}
                    style={{ width: `${Math.max(share * 100, 1)}%` }}
                  />
                </span>
              </td>
            </tr>,

            // A <tr> cannot be wrapped in <details>, so the expansion is its own full
            // width row underneath. No client JavaScript is involved.
            line.children ? (
              <tr className="subrow" key={line.sourceId + i + '-sub'}>
                <td colSpan={5}>
                  <details className="subdetails">
                    <summary>
                      What makes up {source.name} — {formatINR(line.children.batchPaise)} per batch
                      of {formatQty(line.children.yieldQtyMilliBase, line.children.yieldUnitType)}
                    </summary>
                    <div className="subdetails__body">
                      <Lines explanation={line.children} sources={sources} nested />
                    </div>
                  </details>
                </td>
              </tr>
            ) : null,
          ];
        })}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" className="text-right">
            Batch total
          </th>
          <td />
          <td className="col-secondary" />
          <td className="num whitespace-nowrap font-bold text-navy">{formatINR(total)}</td>
          <td className="num tabular-nums">100.0%</td>
        </tr>
      </tfoot>
    </table>
  );
}

export default async function CostBreakdownPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ wi?: string; wp?: string }>;
}) {
  const actor = await requirePermission('recipes.view');
  const { id } = await params;
  const { wi, wp } = await searchParams;

  const base = await getRecipeCostBreakdown(actor, id);
  if (!base) notFound();

  // Governs what is rendered, not what is allowed - both editors re-check.
  const canManage = hasPermission(actor.role, 'recipes.manage');

  // The what-if. A hypothetical rate is built exactly the way a real receipt would build
  // one - same helper, same rounding - and passed as an override. NOTHING IS WRITTEN;
  // there is no write path in this file or the one it calls.
  let whatIf: { ingredientName: string; rupees: string } | null = null;
  let whatIfError: string | null = null;
  let view = base;

  if (wi && wp) {
    const ingredient = base.ingredientsUsed.find((x) => x.id === wi);
    if (!ingredient) {
      whatIfError = 'That ingredient is not used in this recipe.';
    } else {
      try {
        const rate = unitCostMillipaisePerBase(
          rupeesToPaise(wp),
          BigInt(ingredient.purchaseUnitInBase) * 1000n,
        );
        // A second read rather than a second arithmetic path: the override changes the
        // lookup, and everything downstream is the same function it always was.
        view = (await getRecipeCostBreakdown(actor, id, new Map([[wi, rate]])))!;
        whatIf = { ingredientName: `${ingredient.name} at ₹${wp} per ${ingredient.purchaseUnit}`, rupees: wp };
      } catch {
        whatIfError = `“${wp}” is not a price. Enter rupees, like 620 or 620.50.`;
      }
    }
  }

  const unit = perUnit(view.recipe.yieldUnitType);

  return (
    <>
      <header className="brandbar">
        <div className="brandbar__inner">
          <Link className="brandbar__name text-on-navy no-underline" href="/">
            NO MEAT NAAN
          </Link>
          <span className="text-sm opacity-85">Cost breakdown</span>
        </div>
      </header>

      <main className="page">
        <p>
          <Link href="/recipes">← Recipes</Link>
        </p>
        <h1>{view.recipe.name}</h1>
        <p className="prose-note">
          One batch yields {formatQty(view.recipe.yieldQtyMilliBase, view.recipe.yieldUnitType)}.
          Costs come from the weighted average of what was actually paid, over the stock
          ledger.
        </p>

        {canManage ? (
          <p className="flex flex-wrap gap-3">
            <Link className="btn btn--secondary" href={`/recipes/${id}/edit`}>
              Edit recipe
            </Link>
            <Link className="btn btn--secondary" href={`/recipes/${id}/menu`}>
              Menu items
            </Link>
          </p>
        ) : null}

        {whatIf ? (
          <div className="msg msg--warn" role="status">
            <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d={ALERT} />
            </svg>
            <span>
              <span className="msg__title">What-if — nothing is saved. </span>
              Every figure below assumes {whatIf.ingredientName}. The ledger is untouched
              and no price has been changed.{' '}
              <Link href={`/recipes/${id}/cost`}>Back to actual costs</Link>
            </span>
          </div>
        ) : null}

        {whatIfError ? (
          <div className="msg msg--error" role="alert">
            <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d={ALERT} />
            </svg>
            <span>
              <span className="msg__title">What-if not applied. </span>
              {whatIfError}
            </span>
          </div>
        ) : null}

        {view.missing ? (
          /*
           * Never a stack trace and never a zero. The operator gets the names and a way
           * to fix each one, because a list of names is actionable and a wrong total is
           * not.
           */
          <div className="msg msg--error" role="alert">
            <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d={ALERT} />
            </svg>
            <span>
              <span className="msg__title">
                This cannot be costed yet.{' '}
              </span>
              {view.missing.length} {view.missing.length === 1 ? 'ingredient has' : 'ingredients have'}{' '}
              no purchase history, so there is no price to work from:{' '}
              {view.missing.map((m, i) => (
                <span key={m.ingredientId}>
                  {i > 0 ? ', ' : ''}
                  <strong>{m.name}</strong>
                  {m.path?.length ? <span className="muted"> (in {m.path.join(' → ')})</span> : null}
                </span>
              ))}
              . <Link href="/stock/receipt">Record a delivery</Link> for each and the cost
              appears on its own.
            </span>
          </div>
        ) : null}

        {view.explanation && view.explanation.lines.length === 0 ? (
          <div className="msg msg--warn" role="status">
            <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d={ALERT} />
            </svg>
            <span>
              <span className="msg__title">This recipe has no lines. </span>
              An empty recipe costs nothing because it contains nothing — not because it is
              free. Add its ingredients and the cost follows.
            </span>
          </div>
        ) : null}

        {view.explanation && view.explanation.lines.length > 0 ? (
          <>
            <ul className="statgrid">
              <li className="stat">
                <span className="stat__label">Batch cost</span>
                <span className="stat__value">{formatINR(view.explanation.batchPaise)}</span>
                <span className="stat__hint">
                  per {formatQty(view.recipe.yieldQtyMilliBase, view.recipe.yieldUnitType)}
                </span>
              </li>
              <li className="stat">
                <span className="stat__label">Unit cost</span>
                <span className="stat__value">
                  {formatINR(
                    costPerPurchaseUnitPaise(view.explanation.rateMillipaisePerBase, unit.inBase),
                  )}
                </span>
                <span className="stat__hint">{unit.label}</span>
              </li>
            </ul>

            <h2 className="section-title">What it is made of</h2>
            <div className="table-wrap">
              <Lines explanation={view.explanation} sources={view.sources} />
            </div>
            <p className="prose-note mt-2">
              The cost column adds up to the batch total exactly. A sub-recipe contributes
              at its own rounded rate, which is what keeps these figures consistent with
              the ones inside it.
            </p>

            {/* ---- What it sells for ------------------------------------- */}
            {view.menuItems.length > 0 ? (
              <>
                <h2 className="section-title mt-8">On the menu</h2>
                {view.menuItems.map((item) => {
                  const cost = portionCostPaise(
                    view.explanation!.rateMillipaisePerBase,
                    item.portionQtyMilliBase,
                  );
                  const m = menuItemMargin(cost, item.sellingPricePaise);
                  const belowCost = m.marginPaise < 0n;
                  return (
                    <section key={item.id} className="mb-6">
                      <h3 className="mb-2">
                        {item.name}{' '}
                        <span className="text-sm font-normal muted">
                          — one portion is{' '}
                          {formatQty(item.portionQtyMilliBase, view.recipe.yieldUnitType)}
                        </span>
                        {!item.isActive ? <span className="badge badge--muted ml-2">Off menu</span> : null}
                        {canManage ? (
                          <>
                            {' '}
                            <Link className="btn-quiet" href={`/recipes/${id}/menu`}>
                              Edit
                              <span className="sr-only"> {item.name}</span>
                            </Link>
                          </>
                        ) : null}
                      </h3>
                      <ul className="statgrid">
                        <li className="stat">
                          <span className="stat__label">Portion cost</span>
                          <span className="stat__value">{formatINR(m.costPaise)}</span>
                        </li>
                        <li className="stat">
                          <span className="stat__label">Selling price</span>
                          <span className="stat__value">{formatINR(item.sellingPricePaise)}</span>
                        </li>
                        <li className={`stat ${belowCost ? 'stat--bad' : 'stat--headline'}`}>
                          <span className="stat__label">
                            {belowCost ? 'Loss per portion' : 'Gross margin'}
                          </span>
                          <span className="stat__value">
                            {formatINR(belowCost ? -m.marginPaise : m.marginPaise)}
                          </span>
                          <span className="stat__hint">
                            {belowCost ? (
                              <>
                                <Glyph path={ALERT} /> Sold below what it costs to make
                              </>
                            ) : Number.isFinite(m.marginPercent) ? (
                              `${m.marginPercent.toFixed(1)}% of the price`
                            ) : (
                              'No price set'
                            )}
                          </span>
                        </li>
                        <li className="stat">
                          <span className="stat__label">Food cost</span>
                          <span className="stat__value">
                            {Number.isFinite(m.foodCostPercent) ? `${m.foodCostPercent.toFixed(1)}%` : '—'}
                          </span>
                          <span className="stat__hint">
                            {Number.isFinite(m.foodCostPercent) ? 'of the selling price' : 'price is zero'}
                          </span>
                        </li>
                      </ul>
                    </section>
                  );
                })}
              </>
            ) : (
              <p className="prose-note mt-6">
                Nothing on the menu sells this yet, so there is no price to compare against.
                {canManage ? (
                  <>
                    {' '}
                    <Link href={`/recipes/${id}/menu`}>Put it on the menu</Link> and the margin
                    appears here.
                  </>
                ) : null}
              </p>
            )}
          </>
        ) : null}

        {/* ---- The what-if control -------------------------------------- */}
        {view.ingredientsUsed.length > 0 ? (
          <>
            <h2 className="section-title mt-8">Try a different price</h2>
            <p className="prose-note">
              See what happens to this cost if an ingredient’s price changes. This only
              looks — it writes nothing, and the real cost still comes from the ledger.
            </p>
            <form method="get" className="toolbar">
              <div className="field grow max-w-xs">
                <label className="label" htmlFor="wi">
                  Ingredient
                </label>
                <select className="select" id="wi" name="wi" defaultValue={wi ?? ''}>
                  {view.ingredientsUsed.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {x.rateMillipaisePerBase === null
                        ? ' (no price yet)'
                        : ` (now ${formatINR(
                            costPerPurchaseUnitPaise(x.rateMillipaisePerBase, x.purchaseUnitInBase),
                          )} per ${x.purchaseUnit})`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field max-w-40">
                <label className="label" htmlFor="wp">
                  New price ₹
                </label>
                <input
                  className="input"
                  id="wp"
                  name="wp"
                  inputMode="decimal"
                  defaultValue={wp ?? ''}
                  placeholder="620"
                />
              </div>
              <button className="btn" type="submit">
                Show me
              </button>
              {whatIf ? (
                <Link className="btn btn--secondary" href={`/recipes/${id}/cost`}>
                  Actual costs
                </Link>
              ) : null}
            </form>
          </>
        ) : null}
      </main>
    </>
  );
}
