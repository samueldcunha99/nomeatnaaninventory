import { WorkspaceHeader } from "../ui/workspace-header.tsx";
import Link from 'next/link';
import { requirePermission } from '../../src/auth/server.ts';
import { hasPermission } from '../../src/lib/auth.ts';
import { listRecipes } from '../../src/db/recipes.ts';
import { formatQty, formatINR, costPerPurchaseUnitPaise, type UnitType } from '../../src/lib/units.ts';
import { Glyph } from '../ui/status-badge.tsx';

/**
 * A recipe's cost is millipaise per base unit, which is not a figure anyone says out
 * loud. Weight and volume are shown per kilo or per litre; a count recipe is shown per
 * one. The conversion is the shared helper, so this screen adds no rounding of its own.
 */
function perUnit(unitType: UnitType): { inBase: number; label: string } {
  if (unitType === 'weight') return { inBase: 1000, label: 'per kg' };
  if (unitType === 'volume') return { inBase: 1000, label: 'per litre' };
  return { inBase: 1, label: 'each' };
}

const NESTED = 'M3 4h4v4H3V4Zm6 3h8v2H9V7Zm-6 5h4v4H3v-4Zm6 3h8v2H9v-2Z';

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const actor = await requirePermission('recipes.view');
  const { q } = await searchParams;
  const rows = await listRecipes(actor, { search: q });

  // Governs what is rendered, not what is allowed - every mutation re-checks.
  const canManage = hasPermission(actor.role, 'recipes.manage');

  return (
    <>
      <WorkspaceHeader actor={actor} title="Recipes" />

      <main className="page" id="main-content" tabIndex={-1}>
        <div className="page-heading">
          <h1>Recipes & costing</h1>
          {canManage ? (
            <span className="flex flex-wrap gap-2">
              <Link className="btn btn--secondary" href="/settings/costing">
                Hourly rates
              </Link>
              <Link className="btn" href="/recipes/new">
                + New recipe
              </Link>
            </span>
          ) : null}
        </div>
        <p className="prose-note">
          Open a recipe to see its cost breakdown, portions and margins. Ingredient costs
          update when you record a delivery at a new price.
        </p>

        <form method="get" className="toolbar">
          <div className="field grow max-w-xs">
            <label className="label" htmlFor="q">
              Search
            </label>
            <input className="input" id="q" name="q" defaultValue={q ?? ''} placeholder="Recipe name" />
          </div>
          <button className="btn btn--secondary" type="submit">
            Search
          </button>
          {q ? <Link className="btn-quiet" href="/recipes">Clear search</Link> : null}
        </form>

        {rows.length === 0 ? (
          <div className="empty-panel"><h2>{q ? `No recipes matching “${q}”` : 'Your first recipe starts here'}</h2><p className="prose-note">{q ? 'Try a shorter name or clear your search.' : 'Add the ingredients and usable yield for one batch, then set your serving size and selling price.'}</p>{canManage && !q ? <Link className="btn" href="/recipes/new">+ Create a recipe</Link> : null}</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Recipe</th>
                  <th scope="col" className="num">
                    Yield
                  </th>
                  <th scope="col" className="num">
                    Cost
                  </th>
                  <th scope="col" className="col-secondary">
                    Last updated
                  </th>
                  {canManage ? (
                    <th scope="col" className="w-24">
                      <span className="sr-only">Edit</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const unit = perUnit(r.yieldUnitType);
                  return (
                    <tr key={r.id}>
                      <th scope="row">
                        <Link className="row-link" href={`/recipes/${r.id}/cost`}>
                          {r.name}
                        </Link>
                        <span className="block text-xs muted font-normal">
                          {r.lineCount} {r.lineCount === 1 ? 'line' : 'lines'}
                          {/*
                           * A sub-recipe is not a different kind of row, it is a recipe
                           * something else draws on - so it is labelled where that fact
                           * lives, next to the count of what uses it. A badge as well
                           * would be two ways of saying one thing.
                           */}
                          {r.usedByCount > 0 ? (
                            <>
                              {' · '}
                              <span className="badge badge--muted">
                                <Glyph path={NESTED} /> Sub-recipe
                              </span>{' '}
                              used by {r.usedByCount}
                            </>
                          ) : null}
                        </span>
                      </th>

                      <td className="num whitespace-nowrap">
                        {formatQty(r.yieldQtyMilliBase, r.yieldUnitType)}
                      </td>

                      <td className="num whitespace-nowrap">
                        {r.cost.ok ? (
                          <>
                            {formatINR(
                              costPerPurchaseUnitPaise(r.cost.rateMillipaisePerBase, unit.inBase),
                            )}
                            <span className="block text-xs muted">{unit.label}</span>
                          </>
                        ) : (
                          /*
                           * Never a zero, and never a dash on its own. The badge says the
                           * cost is unknown rather than nil, and the breakdown behind the
                           * row name lists which ingredients and why.
                           */
                          <span className="badge badge--low">
                            <Glyph path="M10 1.7 19 18H1L10 1.7Zm-1 5.3v5h2v-5H9Zm0 7v2h2v-2H9Z" />
                            No cost yet
                          </span>
                        )}
                      </td>

                      <td className="col-secondary whitespace-nowrap muted text-sm">
                        {r.updatedAt.toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          timeZone: 'Asia/Kolkata',
                        })}
                      </td>

                      {/* Above the row-link overlay, or the breakdown swallows the click. */}
                      {canManage ? (
                        <td>
                          <Link className="btn-quiet row-action" href={`/recipes/${r.id}/edit`}>
                            Edit
                            <span className="sr-only"> {r.name}</span>
                          </Link>
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
