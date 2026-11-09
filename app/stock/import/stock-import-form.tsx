'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from '../../i18n/provider.tsx';
import { DraftForm } from '../../ui/draft-form.tsx';
import { previewStockImportAction, confirmStockImportAction, type PreviewState, type ImportState } from './actions.ts';
import { STOCK_IMPORT_TEMPLATE, stockImportAmounts, type StockImportMode } from '../../../src/lib/stock-import.ts';
import { formatINR } from '../../../src/lib/units.ts';

export function StockImportForm({ initialMode = 'opening' }: { initialMode?: StockImportMode }) {
  const t = useTranslations();
  const [state, previewAction, previewing] = useActionState<PreviewState, FormData>(previewStockImportAction, { error: null, issues: [] });
  const [saved, confirmAction, saving] = useActionState<ImportState, FormData>(confirmStockImportAction, { error: null });
  const [mode, setMode] = useState<StockImportMode>(initialMode);
  const [reference, setReference] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDirty(false); }, [state]);
  const preview = state.preview;
  const stockRows = preview?.rows.filter(row => row.quantity !== '') ?? [];
  const total = stockRows.reduce((sum, row) => sum + stockImportAmounts(row)!.totalCostPaise, 0n);
  const download = () => {
    const url = URL.createObjectURL(new Blob([STOCK_IMPORT_TEMPLATE], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'cafe-stock-template.csv'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="space-y-6">
    <p className="prose-note">{t('Upload up to 100 ingredients in a CSV UTF-8 file, maximum 256 KB. Excel can save this format.')}</p>
    <button type="button" className="btn btn--secondary" onClick={download}>{t('Download CSV template')}</button>
    <details className="card">
      <summary className="cursor-pointer font-semibold">{t('How to fill the file')}</summary>
      <p className="prose-note mt-3">{t('Keep the English column headings unchanged. Enter plain decimal numbers without currency symbols or thousands separators.')}</p>
      <dl className="mt-3 space-y-2">
        <div><dt><code>{'name / brand'}</code></dt><dd>{t('Ingredient name is required. Brand is optional; existing ingredient details are kept.')}</dd></div>
        <div><dt><code>{'unit_type'}</code></dt><dd>{t('Use weight for grams, volume for millilitres, or count for pieces.')}</dd></div>
        <div><dt><code>{'purchase_unit / purchase_unit_in_base'}</code></dt><dd>{t('For kg use 1000 grams; for L use 1000 millilitres; for a tray of 30 use count and 30.')}</dd></div>
        <div><dt><code>{'quantity / total_cost'}</code></dt><dd>{t('Quantity is in purchase units. Total cost is the full rupee value of that row, not the price per kg. Leave both blank to import names only. Zero cost means genuinely free stock.')}</dd></div>
        <div><dt><code>{'low_stock_threshold'}</code></dt><dd>{t('Optional reorder level in purchase units. It applies only to new ingredients; blank means zero.')}</dd></div>
      </dl>
    </details>
    <DraftForm action={previewAction} result={state} className="card space-y-4" onChange={() => setDirty(true)}>
      <div className="field"><label className="label" htmlFor="import-mode">{t('Import type')}</label>
        <select className="select" id="import-mode" name="mode" value={mode} onChange={e => setMode(e.target.value as StockImportMode)} disabled={saving || previewing}>
          <option value="opening">{t('Opening stock / valuation')}</option><option value="receipt">{t('New purchase / delivery')}</option>
        </select>
        <p className="prose-note">{mode === 'opening' ? t('Opening stock establishes starting value and is excluded from purchases. Previously valued stock cannot be replaced.') : t('A delivery adds to current stock and counts as a new purchase today.')}</p>
      </div>
      <div className="field"><label className="label" htmlFor="import-reference">{t('Delivery / import reference')}</label>
        <input className="input" id="import-reference" name="reference" maxLength={120} value={reference} onChange={e => setReference(e.target.value)} disabled={saving || previewing} />
        <p className="prose-note">{t('The same file, import type and reference are recorded once. For another identical delivery, use a different delivery reference.')}</p>
      </div>
      <div className="field"><label className="label" htmlFor="import-file">{t('CSV file')}</label>
        <input className="input" type="file" id="import-file" name="file" accept=".csv,text/csv" required disabled={saving || previewing} />
      </div>
      <button className="btn" disabled={saving || previewing}>{previewing ? t('Checking file…') : t('Preview import')}</button>
    </DraftForm>
    {state.error ? <div role="alert" className="msg msg--error"><p>{t.message(state.error)}</p>
      {state.issues.length ? <ul>{state.issues.map((issue, i) => <li key={i}>{t('File row {row}: {message}', { row: issue.row, message: t.message(issue.message) })}</li>)}</ul> : null}
      <p>{t('Nothing was saved.')}</p></div> : null}
    {preview && !dirty && !state.error ? <section className="card space-y-4" aria-label={t('Import preview')}>
      <h2>{t('Import preview')}</h2><p>{preview.filename}</p>
      <p>{t('{rows} ingredient rows; {stock} stock rows; total value {value}.', { rows: preview.rows.length, stock: stockRows.length, value: formatINR(total) })}</p>
      <div className="overflow-x-auto"><table className="table"><thead><tr>
        <th>{t('Ingredient')}</th><th>{t('Action')}</th><th>{t('Purchase unit')}</th><th>{t('Quantity')}</th><th>{t('Total value')}</th>
      </tr></thead><tbody>{preview.rows.map((row, i) => <tr key={i}>
        <td>{row.name}</td><td>{preview.expectedIds[i] ? t('Use existing ingredient') : t('Create ingredient')}</td>
        <td>{row.purchaseUnit}</td><td>{row.quantity || '—'}</td><td>{row.totalCost ? formatINR(stockImportAmounts(row)!.totalCostPaise) : t('Unknown')}</td>
      </tr>)}</tbody></table></div>
      <p className="msg msg--warn">{t('Review every quantity and value. Confirming saves the entire file together. Existing stock is added to, never overwritten by a delivery.')}</p>
      <form action={confirmAction}>
        <input type="hidden" name="previewId" value={preview.id} /><input type="hidden" name="csv" value={preview.csv} /><input type="hidden" name="mode" value={preview.mode} />
        <input type="hidden" name="reference" value={preview.reference} /><input type="hidden" name="expectedIds" value={JSON.stringify(preview.expectedIds)} />
        <button className="btn" disabled={saving || previewing}>{saving ? t('Importing…') : t('Confirm import')}</button>
      </form>
    </section> : null}
    {!dirty && !state.error && saved.error && (!preview || saved.previewId === preview.id) ? <div className="msg msg--error" role="alert">{t.message(saved.error)} <span>{t('Nothing was saved.')}</span></div> : null}
    {!dirty && !state.error && saved.result && (!preview || saved.previewId === preview.id) ? <div className="msg msg--ok" role="status"><p>{saved.result.replayed ? t('This file was already imported. Stock has not been added again.') :
      t('Import saved: {created} new ingredients and {stock} stock lines.', { created: saved.result.created, stock: saved.result.stockLines })}</p>
      <Link href="/ingredients">{t('View ingredients and stock')}</Link></div> : null}
  </div>;
}
