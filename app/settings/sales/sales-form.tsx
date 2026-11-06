'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from '../../i18n/provider.tsx';
import { saveSalesSettingsAction } from './actions.ts';
import type { TaxMode } from '../../../src/lib/orders.ts';

export function SalesSettingsForm({ taxMode, rate }: { taxMode: TaxMode | null; rate: string }) {
  const t = useTranslations();
  const [mode, setMode] = useState(taxMode ?? '');
  const [state, action, pending] = useActionState(saveSalesSettingsAction, { error: null, ok: null });
  return <form action={action} className="form-section max-w-xl" noValidate>
    {state.error ? <p className="msg msg--error" role="alert">{t.message(state.error)}</p> : null}
    {state.ok ? <p className="msg msg--ok" role="status">{t(state.ok)}</p> : null}
    <div className="field"><label className="label" htmlFor="tax-mode">{t('Tax treatment')}</label>
      <select className="select" id="tax-mode" name="taxMode" value={mode} onChange={event => setMode(event.target.value)} disabled={pending} required>
        <option value="">{t('Choose tax treatment')}</option>
        <option value="none">{t('No tax — explicit 0%')}</option>
        <option value="exclusive">{t('Add tax to the menu prices')}</option>
        <option value="inclusive">{t('Menu prices already include tax')}</option>
      </select></div>
    <div className="field max-w-xs"><label className="label" htmlFor="tax-rate">{t('Tax rate, %')}</label>
      <input className="input" id="tax-rate" name="rate" defaultValue={rate} inputMode="decimal" maxLength={12}
        disabled={pending || mode === 'none'} required={mode !== 'none'} />
      <p className="prose-note">{t('Enter the rate that applies to your business. No rate is assumed. Choosing no tax explicitly stores zero.')}</p></div>
    <p className="prose-note">{t('Changes apply to new orders. Existing bills keep their original tax and price snapshots.')}</p>
    <button className="btn" type="submit" disabled={pending}>{pending ? t('Saving…') : t('Save sales settings')}</button>
  </form>;
}
