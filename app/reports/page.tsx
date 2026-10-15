import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { requirePermission } from '../../src/auth/server.ts';
import { db } from '../../src/db/client.ts';
import { recipes } from '../../src/db/schema.ts';
import { getDailyReport } from '../../src/db/daily-report.ts';
import { istDayStart, istToday, TIMEZONE } from '../../src/lib/time.ts';
import { formatINR, formatQty, integerToDecimal } from '../../src/lib/units.ts';
import { formatYieldVariance } from '../../src/lib/daily-report.ts';
import { WorkspaceHeader } from '../ui/workspace-header.tsx';

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ day?: string; recipeId?: string }> }) {
  const actor = await requirePermission('production.record');
  await requirePermission('recipes.view');
  const params = await searchParams;
  const day = params.day && istDayStart(params.day) ? params.day : istToday();
  const choices = await db.select({ id: recipes.id, name: recipes.name }).from(recipes).where(eq(recipes.tenantId, actor.tenantId)).orderBy(recipes.name);
  const recipeId = choices.some(r => r.id === params.recipeId) ? params.recipeId : undefined;
  const report = await getDailyReport(actor, day, recipeId);
  return <>
    <WorkspaceHeader actor={actor} title="Daily report" />
    <main className="page" id="main-content" tabIndex={-1}>
      <div className="page-heading"><h1>Daily report</h1><Link className="btn" href={{ pathname: '/production', query: { day } }}>Record production</Link></div>
      <p className="prose-note">Purchases, batches made and material usage for a selected date. Asia/Kolkata.</p>
      {params.day && !istDayStart(params.day) ? <p className="msg msg--error" role="alert">Choose a valid date. Showing today.</p> : null}
      {params.recipeId && !recipeId ? <p className="msg msg--error" role="alert">That recipe is unavailable. Showing all recipes.</p> : null}
      <form method="get" className="toolbar">
        <div className="field"><label className="label" htmlFor="day">Report date</label><input className="input" id="day" name="day" type="date" defaultValue={day} required /></div>
        <div className="field grow max-w-xs"><label className="label" htmlFor="recipeId">Recipe / item</label><select className="select w-full" id="recipeId" name="recipeId" defaultValue={recipeId ?? ''}>
          <option value="">All recipes</option>{choices.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        <button className="btn btn--secondary">Show report</button>
      </form>
      <p className="prose-note">The recipe filter applies to production and material usage. Purchases and extra wastage show the whole day.</p>

      <section className="form-section" aria-labelledby="purchases-heading"><h2 id="purchases-heading">Purchased ingredients</h2>
        <p className="prose-note">Receipts recorded on {day}. Total paid: <strong>{report.totalPaidPaise === null ? 'Incomplete cost data' : formatINR(report.totalPaidPaise)}</strong>.</p>
        {report.purchases.length ? <>
          <div className="table-wrap"><table className="table"><thead><tr><th>Ingredient</th><th className="num">Purchased</th><th className="num">Paid</th></tr></thead>
            <tbody>{report.purchases.map(p => <tr key={p.ingredientId}><td>{p.name}</td><td className="num">{formatQty(p.quantityMilliBase, p.unitType)}</td><td className="num">{p.paidPaise === null ? 'Unknown' : formatINR(p.paidPaise)}</td></tr>)}</tbody></table></div>
          <details className="mt-4"><summary>Receipt details and suppliers</summary><div className="table-wrap"><table className="table"><thead><tr><th>Time</th><th>Ingredient</th><th>Supplier</th><th className="num">Quantity</th><th className="num">Paid</th><th>Recorded by</th></tr></thead>
            <tbody>{report.purchaseDetails.map(p => <tr key={p.id}><td>{p.createdAt.toLocaleTimeString('en-IN', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' })}</td><td>{p.ingredientName}</td><td>{p.supplierName ?? 'Not specified'}</td>
              <td className="num">{formatQty(p.quantityMilliBase, p.unitType)}</td><td className="num">{p.totalCostPaise === null ? 'Unknown' : formatINR(p.totalCostPaise)}</td><td>{p.userName}</td></tr>)}</tbody></table></div></details>
        </> : <p className="prose-note">No purchases recorded for this date.</p>}
      </section>

      <section className="form-section mt-6" aria-labelledby="made-heading"><h2 id="made-heading">Items and batches made</h2>
        {report.production.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Recipe / item</th><th className="num">Batches</th><th className="num">Expected output</th><th className="num">Measured output</th><th className="num">Yield variance</th><th className="num">Recorded input cost</th></tr></thead>
          <tbody>{report.production.map(p => <tr key={`${p.recipeId}:${p.unitType}`}><td>{p.name}<span className="block muted text-xs">{p.runs} recorded {p.runs === 1 ? 'run' : 'runs'}</span></td>
            <td className="num">{integerToDecimal(p.batchesMilli, 1000n)}</td><td className="num">{formatQty(p.expectedMilliBase, p.unitType)}</td>
            <td className="num">{formatQty(p.actualMilliBase, p.unitType)}</td><td className="num">{formatYieldVariance(p.actualMilliBase, p.expectedMilliBase)}</td>
            <td className="num">{p.costPaise === null ? `Not costed (${p.uncostedRuns} runs)` : formatINR(p.costPaise)}</td></tr>)}</tbody></table></div> : <p className="prose-note">No production recorded for this date{recipeId ? ' and recipe' : ''}.</p>}
        <p className="prose-note">Output and costs are saved at production time. Different yield units remain separate. Input costs for prepared components and finished items are not added into one daily total.</p>
      </section>

      <section className="form-section mt-6" aria-labelledby="usage-heading"><h2 id="usage-heading">Materials used in production</h2>
        {report.usage.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Ingredient / component</th><th>Type</th><th className="num">Used</th></tr></thead>
          <tbody>{report.usage.map(u => <tr key={u.ingredientId}><td>{u.name}</td><td>{u.prepared ? 'Prepared component' : 'Ingredient'}</td><td className="num">{formatQty(u.quantityMilliBase, u.unitType)}</td></tr>)}</tbody></table></div> : <p className="prose-note">No production material usage recorded for this date{recipeId ? ' and recipe' : ''}.</p>}
        <p className="prose-note">Usage follows the day the batch was made, even if entered later. It uses recorded stock deductions, including recipe wastage. A prepared component is drawn from its own stock; its raw materials were used when that component was made.</p>
      </section>

      <section className="form-section mt-6" aria-labelledby="waste-heading"><h2 id="waste-heading">Extra wastage recorded</h2>
        {report.wastage.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Ingredient / component</th><th className="num">Discarded</th><th>Reason</th><th>Recorded by</th></tr></thead>
          <tbody>{report.wastage.map(w => <tr key={w.id}><td>{w.ingredientName}</td><td className="num">{formatQty(-w.quantityMilliBase, w.unitType)}</td><td>{w.reason}</td><td>{w.userName}</td></tr>)}</tbody></table></div> : <p className="prose-note">No separate wastage recorded for this date.</p>}
        <p className="prose-note">These are separate stock losses entered on {day}. A lower batch yield is already shown above and must not be deducted again.</p>
      </section>
      <details className="mt-6"><summary>Individual production records</summary>
        {report.runs.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Recipe</th><th className="num">Batches</th><th>Recorded at</th><th>Recorded by / notes</th></tr></thead>
          <tbody>{report.runs.map(r => <tr key={r.id}><td>{r.recipeName}</td><td className="num">{integerToDecimal(r.batchesMilli, 1000n)}</td>
            <td>{r.createdAt.toLocaleString('en-IN', { timeZone: TIMEZONE })}</td><td>{r.userName}{r.note ? <span className="block muted">{r.note}</span> : null}</td></tr>)}</tbody></table></div> : <p className="prose-note">No production records.</p>}
      </details>
    </main>
  </>;
}
