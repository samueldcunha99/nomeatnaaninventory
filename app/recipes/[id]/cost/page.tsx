import { PageTutorial } from '../../../ui/page-tutorial.tsx';
import { WorkspaceHeader } from "../../../ui/workspace-header.tsx";
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '../../../../src/auth/server.ts';
import { hasPermission } from '../../../../src/lib/auth.ts';
import { getRecipeCostBreakdown, type Breakdown } from '../../../../src/db/recipes.ts';
import { portionCostPaise, menuItemMargin, type RecipeExplanation } from '../../../../src/lib/costing.ts';
import {
  formatINR,

  costPerPurchaseUnitPaise,
  unitCostMillipaisePerBase,
  millipercentToPercent,
  rupeesToPaise,
  type UnitType,
} from '../../../../src/lib/units.ts';
import { Glyph } from '../../../ui/status-badge.tsx';
import { getTranslations } from '../../../i18n/server.ts';

const ALERT = 'M10 1.7 19 18H1L10 1.7Zm0 5.3a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Zm0 8.2a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z';

/** Millipaise per base unit is nobody's idea of a price. Per kilo, per litre, or each. */
function perUnit(unitType: UnitType): { inBase: number; label: string } {
  if (unitType === 'count') return { inBase: 1, label: 'each' };
  return { inBase: 1000, label: unitType === 'volume' ? 'per litre' : 'per kg' };
}

async function Rate({ rate, unitType }: { rate: bigint; unitType: UnitType }) {
  const t = await getTranslations();
  const u = perUnit(unitType);
  return (
    <>
      {formatINR(costPerPurchaseUnitPaise(rate, u.inBase))}
      <span className="block text-xs muted">{t(u.label)}</span>
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
async function Lines({
  explanation,
  sources,
  nested = false,
}: {
  explanation: RecipeExplanation;
  sources: Breakdown['sources'];
  nested?: boolean;
}) {
  const t = await getTranslations();
  const lines = [...explanation.lines].sort((a, b) =>
    a.contributionPaise === b.contributionPaise ? 0 : b.contributionPaise > a.contributionPaise ? 1 : -1,
  );
  const total = explanation.batchPaise;

  return (
    <table className={`table${nested ? ' table--nested' : ''}`}>
      <thead>
        <tr>
          <th scope="col">{nested ? t('Goes into {0}', { '0': explanation.name }) : t("Ingredient")}</th>
          <th scope="col" className="num">{t(" Quantity ")}</th>
          <th scope="col" className="num col-secondary">{t(" Rate ")}</th>
          <th scope="col" className="num">{t(" Cost ")}</th>
          <th scope="col" className="num w-32">{t(" Share ")}</th>
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
                    {t.quantity(line.quantityMilliBase, source.unitType)}{t(" plus")}{' '}
                    {millipercentToPercent(line.wastageMillipercent)}{t("% wastage ")}</span>
                ) : null}
              </th>
              <td className="num whitespace-nowrap">
                {t.quantity(line.effectiveMilliBase, source.unitType)}
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
                    <summary>{t(" What makes up ")}{source.name} — {formatINR(line.children.batchPaise)}{t(" per batch of ")}{t.quantity(line.children.yieldQtyMilliBase, line.children.yieldUnitType)}
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
            {explanation.overhead.applied ? t("Ingredients") : t("Batch total")}
          </th>
          <td />
          <td className="col-secondary" />
          <td className="num whitespace-nowrap font-bold text-navy">{formatINR(total)}</td>
          <td className="num tabular-nums">100.0%</td>
        </tr>

        {/*
         * The time in the kitchen, added where the arithmetic adds it. Shown only when
         * there is time to charge: a row reading "Labour Rs 0.00" would state something
         * false about an untimed recipe.
         */}
        {explanation.overhead.applied ? (
          <>
            <tr>
              <th scope="row" className="text-right font-normal">{t(" Labour ")}<span className="block text-xs muted">{explanation.batchMinutes}{t(" min")}</span>
              </th>
              <td />
              <td className="col-secondary" />
              <td className="num whitespace-nowrap">
                {formatINR(explanation.overhead.labourPaise)}
              </td>
              <td />
            </tr>
            <tr>
              <th scope="row" className="text-right font-normal">{t(" Kitchen ")}<span className="block text-xs muted">{t("gas, power, rent")}</span>
              </th>
              <td />
              <td className="col-secondary" />
              <td className="num whitespace-nowrap">
                {formatINR(explanation.overhead.kitchenPaise)}
              </td>
              <td />
            </tr>
            <tr>
              <th scope="row" className="text-right">{t(" Batch total ")}</th>
              <td />
              <td className="col-secondary" />
              <td className="num whitespace-nowrap font-bold text-navy">
                {formatINR(explanation.totalBatchPaise)}
              </td>
              <td />
            </tr>
          </>
        ) : null}
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
  const t = await getTranslations();
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
      <WorkspaceHeader actor={actor} title={t("Cost breakdown")} />

      <main className="page" id="main-content" tabIndex={-1}>
      <PageTutorial topic="recipeCost" role={actor.role} />
        <p>
          <Link href="/recipes">{t("← Recipes")}</Link>
        </p>
        <h1>{view.recipe.name}</h1>
        <p className="prose-note">{t(" One batch yields ")}{t.quantity(view.recipe.yieldQtyMilliBase, view.recipe.yieldUnitType)}{t(". Ingredient costs use the weighted average of your recorded purchases. ")}</p>

        {canManage ? (
          <p className="flex flex-wrap gap-3">
            <Link className="btn btn--secondary" href={`/recipes/${id}/edit`}>{t(" Edit recipe ")}</Link>
            <Link className="btn btn--secondary" href={`/recipes/${id}/menu`}>{t(" Portions & selling prices ")}</Link>
          </p>
        ) : null}

        {whatIf ? (
          <div className="msg msg--warn" role="status">
            <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d={ALERT} />
            </svg>
            <span>
              <span className="msg__title">{t("What-if — nothing is saved. ")}</span>{t(" Every figure below assumes ")}{whatIf.ingredientName}{t(". The ledger is untouched and no price has been changed.")}{' '}
              <Link href={`/recipes/${id}/cost`}>{t("Back to actual costs")}</Link>
            </span>
          </div>
        ) : null}

        {whatIfError ? (
          <div className="msg msg--error" role="alert">
            <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d={ALERT} />
            </svg>
            <span>
              <span className="msg__title">{t("What-if not applied. ")}</span>
              {t.message(whatIfError)}
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
              <span className="msg__title">{t(" This cannot be costed yet.")}{' '}
              </span>
              {view.missing.length} {view.missing.length === 1 ? t("ingredient has") : t("ingredients have")}{' '}{t(' no complete recorded cost:')}{' '}
              {view.missing.map((m, i) => (
                <span key={m.ingredientId + ':' + i}>
                  {i > 0 ? ', ' : ''}
                  <strong>{m.name}</strong>
                  {m.path?.length ? <span className="muted">{t(" (in ")}{m.path.join(' → ')})</span> : null}
                </span>
              ))}
              . <Link href="/stock/receipt">{t('Review purchase prices')}</Link>{t(' and resolve unknown opening stock values before costing again. ')}</span>
          </div>
        ) : null}

        {view.explanation && view.explanation.lines.length === 0 ? (
          <div className="msg msg--warn" role="status">
            <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d={ALERT} />
            </svg>
            <span>
              <span className="msg__title">{t("This recipe has no lines. ")}</span>{t(" An empty recipe costs nothing because it contains nothing — not because it is free. Add its ingredients and the cost follows. ")}</span>
          </div>
        ) : null}

        {view.explanation && view.explanation.lines.length > 0 ? (
          <>
            {!view.explanation.overheadComplete ? (
              <div className="msg msg--warn" role="status">
                <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d={ALERT} /></svg>
                <div>
                  <strong>{t('Cost incomplete.')}</strong>
                  {!view.rates || view.rates.labourPaisePerHour == null || view.rates.kitchenPaisePerHour == null ? (
                    <p className="prose-note">{t('Both hourly rates are required before labour and kitchen overhead can be included. Blank rates remain unknown.')} {' '}
                      {canManage ? <Link href="/settings/costing">{t('Set them')}</Link> : t('Ask the owner to set them')}</p>
                  ) : null}
                  {view.explanation.untimedRecipes.length ? <>
                    <p className="prose-note">{t('Batch preparation time is missing for:')}</p>
                    <ul>{view.explanation.untimedRecipes.map(recipe => <li key={recipe.recipeId}>
                      {canManage ? <Link href={`/recipes/${recipe.recipeId}/edit`}>{recipe.name}</Link> : recipe.name}
                    </li>)}</ul>
                  </> : null}
                  <p className="prose-note">{t('The amounts below include known costs only. Margins are provisional until the missing rates and preparation times are entered.')}</p>
                </div>
              </div>
            ) : null}
            <ul className="statgrid">
              <li className="stat">
                <span className="stat__label">{view.explanation.overheadComplete ? t('Calculated batch cost') : t('Known batch cost')}</span>
                <span className="stat__value">
                  {formatINR(view.explanation.totalBatchPaise)}
                </span>
                <span className="stat__hint">{t(" per ")}{t.quantity(view.recipe.yieldQtyMilliBase, view.recipe.yieldUnitType)}
                </span>
              </li>
              <li className="stat">
                <span className="stat__label">{view.explanation.overheadComplete ? t('Unit cost') : t('Known unit cost')}</span>
                <span className="stat__value">
                  {formatINR(
                    costPerPurchaseUnitPaise(view.explanation.rateMillipaisePerBase, unit.inBase),
                  )}
                </span>
                <span className="stat__hint">{t(unit.label)}</span>
              </li>
            </ul>

            <h2 className="section-title">{t("What it is made of")}</h2>
            <div className="table-wrap">
              <Lines explanation={view.explanation} sources={view.sources} />
            </div>
            <p className="prose-note mt-2">{t(" The cost column adds up to the batch total exactly. A sub-recipe contributes at its own rounded rate, which is what keeps these figures consistent with the ones inside it. ")}</p>

            {/* ---- What it sells for ------------------------------------- */}
            {view.menuItems.length > 0 ? (
              <>
                <h2 className="section-title mt-8">{t("On the menu")}</h2>
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
                        <span className="text-sm font-normal muted">{t(" — one portion is")}{' '}
                          {t.quantity(item.portionQtyMilliBase, view.recipe.yieldUnitType)}
                        </span>
                        {!item.isActive ? <span className="badge badge--muted ml-2">{t("Off menu")}</span> : null}
                        {canManage ? (
                          <>
                            {' '}
                            <Link className="btn-quiet" href={`/recipes/${id}/menu`}>{t(" Edit ")}<span className="sr-only"> {item.name}</span>
                            </Link>
                          </>
                        ) : null}
                      </h3>
                      <ul className="statgrid">
                        <li className="stat">
                          <span className="stat__label">{view.explanation!.overheadComplete ? t('Portion cost') : t('Known portion cost')}</span>
                          <span className="stat__value">{formatINR(m.costPaise)}</span>
                        </li>
                        <li className="stat">
                          <span className="stat__label">{t("Selling price")}</span>
                          <span className="stat__value">{formatINR(item.sellingPricePaise)}</span>
                        </li>
                        <li className={`stat ${belowCost ? 'stat--bad' : 'stat--headline'}`}>
                          <span className="stat__label">
                            {belowCost
                              ? (view.explanation!.overheadComplete ? t('Loss per portion') : t('Minimum loss per portion'))
                              : (view.explanation!.overheadComplete ? t('Gross margin') : t('Provisional margin'))}
                          </span>
                          <span className="stat__value">
                            {formatINR(belowCost ? -m.marginPaise : m.marginPaise)}
                          </span>
                          <span className="stat__hint">
                            {belowCost ? (
                              <>
                                <Glyph path={ALERT} />{t(" Sold below what it costs to make ")}</>
                            ) : Number.isFinite(m.marginPercent) ? (
                              t('{0}% of the price', { '0': m.marginPercent.toFixed(1) })
                            ) : (
                              t('No price set')
                            )}
                          </span>
                        </li>
                        <li className="stat">
                          <span className="stat__label">
                            {view.explanation!.overheadComplete ? t('Total cost') : t('Known cost')}
                          </span>
                          <span className="stat__value">
                            {Number.isFinite(m.foodCostPercent) ? `${m.foodCostPercent.toFixed(1)}%` : '—'}
                          </span>
                          <span className="stat__hint">
                            {Number.isFinite(m.foodCostPercent) ? t("of the selling price") : t("price is zero")}
                          </span>
                        </li>
                      </ul>
                    </section>
                  );
                })}
              </>
            ) : (
              <p className="prose-note mt-6">{t(" Nothing on the menu sells this yet, so there is no price to compare against. ")}{canManage ? (
                  <>
                    {' '}
                    <Link href={`/recipes/${id}/menu`}>{t("Put it on the menu")}</Link>{t(" and the margin appears here. ")}</>
                ) : null}
              </p>
            )}
          </>
        ) : null}

        {/* ---- The what-if control -------------------------------------- */}
        {view.ingredientsUsed.length > 0 ? (
          <>
            <h2 className="section-title mt-8">{t("Try a different price")}</h2>
            <p className="prose-note">{t(" See what happens to this cost if an ingredient’s price changes. This only looks — it writes nothing, and the real cost still comes from the ledger. ")}</p>
            <form method="get" className="toolbar">
              <div className="field grow max-w-xs">
                <label className="label" htmlFor="wi">{t(" Ingredient ")}</label>
                <select className="select" id="wi" name="wi" defaultValue={wi ?? ''}>
                  {view.ingredientsUsed.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {x.rateMillipaisePerBase === null
                        ? t(" (no price yet)")
                        : t(" (now {0} per {1})", { "0": formatINR(
                            costPerPurchaseUnitPaise(x.rateMillipaisePerBase, x.purchaseUnitInBase),
                          ), "1": x.purchaseUnit })}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field max-w-40">
                <label className="label" htmlFor="wp">{t(" New price ₹ ")}</label>
                <input
                  className="input"
                  id="wp"
                  name="wp"
                  inputMode="decimal"
                  defaultValue={wp ?? ''}
                  placeholder="620"
                />
              </div>
              <button className="btn" type="submit">{t(" Show me ")}</button>
              {whatIf ? (
                <Link className="btn btn--secondary" href={`/recipes/${id}/cost`}>{t(" Actual costs ")}</Link>
              ) : null}
            </form>
          </>
        ) : null}
      </main>
    </>
  );
}
