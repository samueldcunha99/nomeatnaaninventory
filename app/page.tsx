import { WorkspaceHeader } from "./ui/workspace-header.tsx";
import Link from 'next/link';
import { requireSession } from '../src/auth/server.ts';
import { hasPermission } from '../src/lib/auth.ts';
import { listLowStock, countDeliveriesSince } from '../src/db/history.ts';
import { listIngredients } from '../src/db/ingredients.ts';
import { listRecipes } from '../src/db/recipes.ts';
import { startOfDayIST } from '../src/lib/time.ts';
import { formatINR, formatQty, costPerPurchaseUnitPaise, milliBaseToPurchaseUnits } from '../src/lib/units.ts';
import { portionCostPaise } from '../src/lib/costing.ts';
import { StatusBadge } from './ui/status-badge.tsx';

/**
 * The home screen answers "what needs me right now", and only then offers a way out to
 * the other screens. It used to be a launcher wearing the word "Today".
 *
 * The rule it keeps: **when nothing is wrong, the page goes quiet.** No empty widgets, no
 * zero-state cards, one sentence saying so. A dashboard that looks the same busy and idle
 * teaches people to stop reading it, and this one is read at the start of every shift.
 *
 * Every figure comes from a function that already existed - listLowStock is the same
 * "worst first" ordering the low stock screen uses, and the recipes that cannot be costed
 * are the same MissingCostError the breakdown reports. Nothing here recomputes anything.
 */
export default async function HomePage() {
  const user = await requireSession();
  const canView = hasPermission(user.role, 'ingredients.view');
  const canRecord = hasPermission(user.role, 'stock.record');
  const canCost = hasPermission(user.role, 'recipes.view');

  const [low, ingredients, deliveries] = canView
    ? await Promise.all([
        listLowStock(user),
        listIngredients(user),
        countDeliveriesSince(user, startOfDayIST()),
      ])
    : [[], [], 0];

  // Costed here rather than counted in SQL: "cannot be costed" means an ingredient in the
  // tree has no purchase history, which only the costing walk knows.
  const recipes = canCost ? await listRecipes(user) : [];
  const uncosted = recipes.filter((r) => !r.cost.ok);

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Kolkata',
  });

  /*
   * What the shelf is worth: quantity times the weighted average, per ingredient, through
   * the same rounding the rest of the app uses. portionCostPaise refuses a negative
   * quantity - deliberately, since rounding a signed quantity is a Month 3 problem - so an
   * oversold ingredient is valued by magnitude and subtracted, which is what it means.
   */
  const shelfValuePaise = ingredients.reduce((total, i) => {
    const rate = BigInt(i.weightedAvgCostMillipaisePerBase);
    const qty = BigInt(i.qtyMilliBase);
    return qty < 0n ? total - portionCostPaise(rate, -qty) : total + portionCostPaise(rate, qty);
  }, 0n);

  const nothingTracked = canView && ingredients.length === 0;
  const needsYou = low.length > 0 || uncosted.length > 0;

  return (
    <>
      <WorkspaceHeader actor={user} title="Overview" />

      <main className="page" id="main-content" tabIndex={-1}>
        {canCost ? (
          <section className="costing-hero">
            <div>
              <p className="eyebrow">No Meat Naan · {today}</p>
              <h1>Know what every serving costs.</h1>
              <p>Bring your ingredients, batch yields and selling prices together.<br className="hidden lg:block" /> See the cost behind every item on your menu.</p>
            </div>
            <div className="hero-actions">
              {hasPermission(user.role, 'recipes.manage') ? <Link className="btn" href="/recipes/new">+ Create a recipe</Link> : null}
              <Link className="btn btn--secondary" href="/recipes">View all recipes</Link>
            </div>
          </section>
        ) : <div className="page-heading"><h1>Today</h1><p className="muted">{today}</p></div>}

        {canCost && recipes.length > 0 ? (
          <section className="mb-8" aria-labelledby="recent-recipes">
            <div className="section-heading"><h2 id="recent-recipes">Your recipes</h2><Link href="/recipes">View all {recipes.length} →</Link></div>
            <div className="recipe-grid">
              {[...recipes].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 3).map((recipe) => (
                <Link className="recipe-card" key={recipe.id} href={`/recipes/${recipe.id}/cost`}>
                  <span className="eyebrow">{recipe.usedByCount > 0 ? 'Sub-recipe' : 'Recipe'}</span>
                  <h3>{recipe.name}</h3>
                  <p>{recipe.lineCount} ingredients & components · Yields {formatQty(recipe.yieldQtyMilliBase, recipe.yieldUnitType)}</p>
                  <div className="recipe-card__footer">
                    <span>{recipe.cost.ok ? <><strong>{formatINR(costPerPurchaseUnitPaise(recipe.cost.rateMillipaisePerBase, recipe.yieldUnitType === 'count' ? 1 : 1000))}</strong><small> / {recipe.yieldUnitType === 'count' ? 'unit' : recipe.yieldUnitType === 'weight' ? 'kg' : 'litre'}</small></> : <span className="badge badge--low">Missing ingredient costs</span>}</span>
                    <span aria-label="View breakdown">↗</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {canView ? (
          <ul className="statgrid">
            <li>
              <Link
                className={`stat stat--link h-full${low.length > 0 ? ' stat--bad' : ''}`}
                href="/stock/low"
              >
                <span className="stat__label">Need reordering</span>
                <span className="stat__value text-4xl">{low.length}</span>
                <span className="stat__hint">
                  {low.length === 0
                    ? `all ${ingredients.length} above threshold`
                    : `of ${ingredients.length} ingredients`}
                </span>
              </Link>
            </li>

            <li>
              <Link className="stat stat--link h-full" href="/stock/history">
                <span className="stat__label">Deliveries today</span>
                <span className="stat__value text-4xl">{deliveries}</span>
                <span className="stat__hint">
                  {deliveries === 0 ? 'none recorded yet' : 'recorded since midnight'}
                </span>
              </Link>
            </li>

            <li>
              {/*
               * The COUNT leads, not the money. The rupee figure is only as true as the
               * quantities behind it, and those are nominal until someone counts the
               * shelf - so it sits in the hint, with the reason it might be wrong next to
               * it. A confident headline figure derived from placeholder quantities is
               * precisely the kind of number this system exists not to print.
               */}
              <Link className="stat stat--link h-full" href="/ingredients">
                <span className="stat__label">Ingredients</span>
                <span className="stat__value text-4xl">{ingredients.length}</span>
                <span className="stat__hint">
                  {formatINR(shelfValuePaise)} at recorded quantities
                </span>
              </Link>
            </li>

            {canCost ? (
              <li>
                <Link
                  className={`stat stat--link h-full${uncosted.length > 0 ? ' stat--bad' : ''}`}
                  href="/recipes"
                >
                  <span className="stat__label">Cannot be costed</span>
                  <span className="stat__value text-4xl">{uncosted.length}</span>
                  <span className="stat__hint">
                    {uncosted.length === 0
                      ? `all ${recipes.length} have ingredient costs`
                      : 'missing a purchase price'}
                  </span>
                </Link>
              </li>
            ) : null}
          </ul>
        ) : null}

        {/* ---- What needs someone, or the sentence that says nothing does ---- */}
        {canView && !nothingTracked ? (
          needsYou ? (
            <>
              <h2 className="section-title">Needs you</h2>

              {low.length > 0 ? (
                <>
                  <ul className="alertlist">
                    {low.slice(0, 4).map((row) => (
                      <li className="alertrow" key={row.ingredientId}>
                        <StatusBadge kind={row.qtyMilliBase < 0 ? 'oversold' : 'low'} />
                        <span className="alertrow__name">{row.name}</span>
                        <span className="alertrow__fact">
                          {milliBaseToPurchaseUnits(row.qtyMilliBase, row.purchaseUnitInBase)}{' '}
                          {row.purchaseUnit} on hand ·{' '}
                          {/*
                           * At the threshold exactly is the common case - a threshold is
                           * usually set to what a full shelf holds - and "1 kg on hand,
                           * reorder at 1 kg" reads like a rendering fault rather than a
                           * fact. Say where the line is instead of repeating the number.
                           */}
                          {row.qtyMilliBase === row.lowStockThresholdMilliBase
                            ? 'at the reorder point'
                            : `reorder at ${milliBaseToPurchaseUnits(
                                row.lowStockThresholdMilliBase,
                                row.purchaseUnitInBase,
                              )} ${row.purchaseUnit}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="prose-note mb-6">
                    <Link href="/stock/low">
                      {low.length > 4 ? `See all ${low.length} low` : 'See the low stock screen'} →
                    </Link>
                  </p>
                </>
              ) : null}

              {uncosted.length > 0 ? (
                <>
                  <ul className="alertlist">
                    {uncosted.slice(0, 4).map((recipe) => (
                      <li className="alertrow" key={recipe.id}>
                        <StatusBadge kind="low" />
                        <span className="alertrow__name">{recipe.name}</span>
                        <span className="alertrow__fact">
                          {/* Named, because "1 recipe has no cost" sends someone hunting
                              and "Saffron strands has no purchase history" does not. */}
                          {!recipe.cost.ok
                            ? recipe.cost.missing.map((m) => m.name).join(', ') +
                              ` ${recipe.cost.missing.length === 1 ? 'has' : 'have'} no purchase history`
                            : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="prose-note mb-6">
                    <Link href="/stock/receipt">Record what arrived</Link> and the cost appears
                    on its own.
                  </p>
                </>
              ) : null}
            </>
          ) : (
            <p className="msg msg--ok">
              <span>
                <span className="msg__title">Nothing needs you. </span>
                All {ingredients.length} ingredients are above their reorder threshold
                {canCost && recipes.length > 0 ? ', and every recipe can be costed' : ''}.
              </span>
            </p>
          )
        ) : null}

        {nothingTracked ? (
          <p className="msg msg--warn">
            <span>
              <span className="msg__title">Nothing is being tracked yet. </span>
              <Link href="/ingredients/new">Add the first ingredient</Link>, then record what
              arrived. Stock and cost follow from the ledger on their own.
            </span>
          </p>
        ) : null}

        {/* ---- The catalogue, reachable without a detour ---------------------- */}
        {canView && !nothingTracked ? (
          <>
            <h2 className="section-title">What you stock</h2>
            {/*
             * A plain GET straight at the ingredients screen. Ninety-six ingredients is
             * more than anyone scrolls: typing three letters of "cardamom" here is the
             * shortest path to it, and it works with JavaScript off because it is a form
             * and not a client-side filter.
             */}
            <form method="get" action="/ingredients" className="toolbar">
              <div className="field grow max-w-md mb-0">
                <label className="label" htmlFor="find">
                  Find an ingredient
                </label>
                <input
                  className="input"
                  id="find"
                  name="q"
                  placeholder="cardamom, butter, pizza box"
                  autoComplete="off"
                />
              </div>
              <button className="btn" type="submit">
                Search
              </button>
              <Link className="btn btn--secondary" href="/ingredients">
                All {ingredients.length}
              </Link>
            </form>
          </>
        ) : null}

        {/* ---- The two things people come here to do -------------------------- */}
        {canRecord ? (
          <>
            <h2 className="section-title">Record</h2>
            <ul className="navgrid">
              <li>
                <Link className="navcard navcard--write" href="/stock/receipt">
                  Stock receipt
                  <span className="navcard__hint">Enter a delivery that has arrived</span>
                </Link>
              </li>
              <li>
                <Link className="navcard navcard--write" href="/stock/adjust">
                  Adjustment / wastage
                  <span className="navcard__hint">Correct a count, or record what was lost</span>
                </Link>
              </li>
            </ul>
          </>
        ) : null}

        {canView || canCost ? (
          <>
            <h2 className="section-title">Everything else</h2>
            <ul className="navrow">
              {canView ? (
                <>
                  <li>
                    <Link className="navchip" href="/stock/history">
                      Movement history
                    </Link>
                  </li>
                  <li>
                    <Link className="navchip" href="/stock/low">
                      Low stock
                    </Link>
                  </li>
                </>
              ) : null}
              {canCost ? (
                <li>
                  <Link className="navchip" href="/recipes">
                    Recipes
                  </Link>
                </li>
              ) : null}
            </ul>
          </>
        ) : null}

        {!canView && !canRecord && !canCost ? (
          <p className="prose-note">
            There is nothing here for your role yet. Ask the owner if you were expecting a
            screen.
          </p>
        ) : null}
      </main>
    </>
  );
}
