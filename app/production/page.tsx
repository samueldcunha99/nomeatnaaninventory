import Link from 'next/link';
import { requirePermission } from '../../src/auth/server.ts';
import { loadRecipeGraph } from '../../src/db/recipes.ts';
import { listIngredients } from '../../src/db/ingredients.ts';
import { listProductionRuns } from '../../src/db/daily-report.ts';
import { istDayStart, istToday } from '../../src/lib/time.ts';
import { formatQty, integerToDecimal } from '../../src/lib/units.ts';
import { ProductionForm } from './production-form.tsx';
import { WorkspaceHeader } from '../ui/workspace-header.tsx';

export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ day?: string; recipeId?: string; recorded?: string }> }) {
  const actor = await requirePermission('production.record');
  const params = await searchParams;
  const day = params.day && istDayStart(params.day) ? params.day : istToday();
  const [graph, ingredients, runs] = await Promise.all([loadRecipeGraph(actor), listIngredients(actor, { activeOnly: false }), listProductionRuns(actor, day)]);
  const options = [...graph.values()].map(r => ({ id: r.id, name: r.name, yieldUnitType: r.yieldUnitType,
    yieldQtyMilliBase: String(r.yieldQtyMilliBase), stockIngredientId: r.stockIngredientId ?? null,
    updatedAt: r.updatedAt.toISOString(), lines: r.lines.map(l => ({ ...l,
      quantityMilliBase: String(l.quantityMilliBase), wastageMillipercent: String(l.wastageMillipercent) })) }));
  return <>
    <WorkspaceHeader actor={actor} title="Daily production" />
    <main className="page" id="main-content" tabIndex={-1}>
      <div className="page-heading"><h1>Daily production</h1><Link className="btn btn--secondary" href={{ pathname: '/reports', query: { day } }}>View daily report</Link></div>
      <p className="prose-note">Record batches made, their measured yield and the materials used. Dates follow Asia/Kolkata.</p>
      {params.day && !istDayStart(params.day) ? <p className="msg msg--error" role="alert">Choose a valid date. Showing today.</p> : null}
      {runs.some(r => r.id === params.recorded) ? <p className="msg" role="status"><strong>Production recorded.</strong> Material usage and the daily report have been updated.</p> : null}
      <form method="get" className="toolbar"><div className="field"><label className="label" htmlFor="day">View production date</label>
        <input className="input" id="day" name="day" type="date" defaultValue={day} required /></div><button className="btn btn--secondary">Show day</button></form>
      {options.length ? <ProductionForm key={`${day}:${params.recorded ?? ''}:${params.recipeId ?? ''}`} recipes={options}
        ingredients={ingredients.map(i => ({ id: i.id, name: i.name, unitType: i.unitType, qtyMilliBase: String(i.qtyMilliBase) }))}
        day={day} today={istToday()} requestId={crypto.randomUUID()}
        initialRecipeId={options.some(r => r.id === params.recipeId) ? params.recipeId : undefined} />
        : <p className="prose-note">Create a recipe with its ingredients and batch yield before recording production. <Link href="/recipes/new">Create a recipe</Link>.</p>}
      <h2 className="mt-8">Recorded batches for {day}</h2>
      {runs.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Recipe</th><th className="num">Batches</th><th className="num">Expected</th><th className="num">Made</th><th>Recorded by / notes</th></tr></thead>
        <tbody>{runs.map(r => <tr key={r.id}><td>{r.recipeName}</td><td className="num">{integerToDecimal(r.batchesMilli, 1000n)}</td>
          <td className="num">{formatQty(r.expectedYieldMilliBase, r.yieldUnitType)}</td><td className="num">{formatQty(r.actualYieldMilliBase, r.yieldUnitType)}</td>
          <td>{r.userName}{r.note ? <span className="block muted">{r.note}</span> : null}</td></tr>)}</tbody></table></div> : <p className="prose-note">No batches recorded for this date.</p>}
    </main>
  </>;
}
