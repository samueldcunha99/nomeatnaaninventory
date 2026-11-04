import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { requirePermission } from '../../src/auth/server.ts';
import { db } from '../../src/db/client.ts';
import { recipes } from '../../src/db/schema.ts';
import { getDailyReport } from '../../src/db/daily-report.ts';
import { istDayStart, istToday, TIMEZONE } from '../../src/lib/time.ts';
import { formatINR, integerToDecimal } from '../../src/lib/units.ts';
import { formatYieldVariance } from '../../src/lib/daily-report.ts';
import { WorkspaceHeader } from '../ui/workspace-header.tsx';
import { getTranslations } from '../i18n/server.ts';

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ day?: string; recipeId?: string }> }) {
  const actor = await requirePermission('production.record');
  const t = await getTranslations();
  await requirePermission('recipes.view');
  const params = await searchParams;
  const day = params.day && istDayStart(params.day) ? params.day : istToday();
  const choices = await db.select({ id: recipes.id, name: recipes.name }).from(recipes).where(eq(recipes.tenantId, actor.tenantId)).orderBy(recipes.name);
  const recipeId = choices.some(r => r.id === params.recipeId) ? params.recipeId : undefined;
  const report = await getDailyReport(actor, day, recipeId);
  return <>
    <WorkspaceHeader actor={actor} title={t("Daily report")} />
    <main className="page" id="main-content" tabIndex={-1}>
      <div className="page-heading"><h1>{t("Daily report")}</h1><Link className="btn" href={{ pathname: '/production', query: { day } }}>{t("Record production")}</Link></div>
      <p className="prose-note">{t("Purchases, batches made and material usage for a selected date. Asia/Kolkata.")}</p>
      {params.day && !istDayStart(params.day) ? <p className="msg msg--error" role="alert">{t("Choose a valid date. Showing today.")}</p> : null}
      {params.recipeId && !recipeId ? <p className="msg msg--error" role="alert">{t("That recipe is unavailable. Showing all recipes.")}</p> : null}
      <form method="get" className="toolbar">
        <div className="field"><label className="label" htmlFor="day">{t("Report date")}</label><input className="input" id="day" name="day" type="date" defaultValue={day} required /></div>
        <div className="field grow max-w-xs"><label className="label" htmlFor="recipeId">{t("Recipe / item")}</label><select className="select w-full" id="recipeId" name="recipeId" defaultValue={recipeId ?? ''}>
          <option value="">{t("All recipes")}</option>{choices.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        <button className="btn btn--secondary">{t("Show report")}</button>
      </form>
      <p className="prose-note">{t("The recipe filter applies to production and material usage. Purchases and extra wastage show the whole day.")}</p>

      <section className="form-section" aria-labelledby="purchases-heading"><h2 id="purchases-heading">{t("Purchased ingredients")}</h2>
        <p className="prose-note">{t("Receipts recorded on ")}{day}{t(". Total paid: ")}<strong>{report.totalPaidPaise === null ? t("Incomplete cost data") : formatINR(report.totalPaidPaise)}</strong>.</p>
        {report.purchases.length ? <>
          <div className="table-wrap"><table className="table"><thead><tr><th>{t("Ingredient")}</th><th className="num">{t("Purchased")}</th><th className="num">{t("Paid")}</th></tr></thead>
            <tbody>{report.purchases.map(p => <tr key={p.ingredientId}><td>{p.name}</td><td className="num">{t.quantity(p.quantityMilliBase, p.unitType)}</td><td className="num">{p.paidPaise === null ? t("Unknown") : formatINR(p.paidPaise)}</td></tr>)}</tbody></table></div>
          <details className="mt-4"><summary>{t("Receipt details and suppliers")}</summary><div className="table-wrap"><table className="table"><thead><tr><th>{t("Time")}</th><th>{t("Ingredient")}</th><th>{t("Supplier")}</th><th className="num">{t("Quantity")}</th><th className="num">{t("Paid")}</th><th>{t("Recorded by")}</th></tr></thead>
            <tbody>{report.purchaseDetails.map(p => <tr key={p.id}><td>{p.createdAt.toLocaleTimeString(t.intlLocale, { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' })}</td><td>{p.ingredientName}</td><td>{p.supplierName ?? t("Not specified")}</td>
              <td className="num">{t.quantity(p.quantityMilliBase, p.unitType)}</td><td className="num">{p.totalCostPaise === null ? t("Unknown") : formatINR(p.totalCostPaise)}</td><td>{p.userName}</td></tr>)}</tbody></table></div></details>
        </> : <p className="prose-note">{t("No purchases recorded for this date.")}</p>}
      </section>

      <section className="form-section mt-6" aria-labelledby="made-heading"><h2 id="made-heading">{t("Items and batches made")}</h2>
        {report.production.length ? <div className="table-wrap"><table className="table"><thead><tr><th>{t("Recipe / item")}</th><th className="num">{t("Batches")}</th><th className="num">{t("Expected output")}</th><th className="num">{t("Measured output")}</th><th className="num">{t("Yield variance")}</th><th className="num">{t("Recorded input cost")}</th></tr></thead>
          <tbody>{report.production.map(p => <tr key={`${p.recipeId}:${p.unitType}`}><td>{p.name}<span className="block muted text-xs">{p.runs}{t(" recorded ")}{p.runs === 1 ? t("run") : t("runs")}</span></td>
            <td className="num">{integerToDecimal(p.batchesMilli, 1000n)}</td><td className="num">{t.quantity(p.expectedMilliBase, p.unitType)}</td>
            <td className="num">{t.quantity(p.actualMilliBase, p.unitType)}</td><td className="num">{formatYieldVariance(p.actualMilliBase, p.expectedMilliBase)}</td>
            <td className="num">{p.costPaise === null ? t("Not costed ({0} runs)", { "0": p.uncostedRuns }) : formatINR(p.costPaise)}</td></tr>)}</tbody></table></div> : <p className="prose-note">{t("No production recorded for this date")}{recipeId ? t(" and recipe") : ''}.</p>}
        <p className="prose-note">{t("Output and costs are saved at production time. Different yield units remain separate. Input costs for prepared components and finished items are not added into one daily total.")}</p>
      </section>

      <section className="form-section mt-6" aria-labelledby="usage-heading"><h2 id="usage-heading">{t("Materials used in production")}</h2>
        {report.usage.length ? <div className="table-wrap"><table className="table"><thead><tr><th>{t("Ingredient / component")}</th><th>{t("Type")}</th><th className="num">{t("Used")}</th></tr></thead>
          <tbody>{report.usage.map(u => <tr key={u.ingredientId}><td>{u.name}</td><td>{u.prepared ? t("Prepared component") : t("Ingredient")}</td><td className="num">{t.quantity(u.quantityMilliBase, u.unitType)}</td></tr>)}</tbody></table></div> : <p className="prose-note">{t("No production material usage recorded for this date")}{recipeId ? t(" and recipe") : ''}.</p>}
        <p className="prose-note">{t("Usage follows the day the batch was made, even if entered later. It uses recorded stock deductions, including recipe wastage. A prepared component is drawn from its own stock; its raw materials were used when that component was made.")}</p>
      </section>

      <section className="form-section mt-6" aria-labelledby="waste-heading"><h2 id="waste-heading">{t("Extra wastage recorded")}</h2>
        {report.wastage.length ? <div className="table-wrap"><table className="table"><thead><tr><th>{t("Ingredient / component")}</th><th className="num">{t("Discarded")}</th><th>{t("Reason")}</th><th>{t("Recorded by")}</th></tr></thead>
          <tbody>{report.wastage.map(w => <tr key={w.id}><td>{w.ingredientName}</td><td className="num">{t.quantity(-w.quantityMilliBase, w.unitType)}</td><td>{w.reason ? t(w.reason) : ''}</td><td>{w.userName}</td></tr>)}</tbody></table></div> : <p className="prose-note">{t("No separate wastage recorded for this date.")}</p>}
        <p className="prose-note">{t("These are separate stock losses entered on ")}{day}{t(". A lower batch yield is already shown above and must not be deducted again.")}</p>
      </section>
      <details className="mt-6"><summary>{t("Individual production records")}</summary>
        {report.runs.length ? <div className="table-wrap"><table className="table"><thead><tr><th>{t("Recipe")}</th><th className="num">{t("Batches")}</th><th>{t("Recorded at")}</th><th>{t("Recorded by / notes")}</th></tr></thead>
          <tbody>{report.runs.map(r => <tr key={r.id}><td>{r.recipeName}</td><td className="num">{integerToDecimal(r.batchesMilli, 1000n)}</td>
            <td>{r.createdAt.toLocaleString(t.intlLocale, { timeZone: TIMEZONE })}</td><td>{r.userName}{r.note ? <span className="block muted">{r.note}</span> : null}</td></tr>)}</tbody></table></div> : <p className="prose-note">{t("No production records.")}</p>}
      </details>
    </main>
  </>;
}
