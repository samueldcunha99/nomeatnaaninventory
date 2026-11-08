'use client';

import { DraftForm } from '../ui/draft-form.tsx';

import { useActionState } from 'react';
import { reverseProductionAction, type ProductionState } from './actions.ts';
import { useTranslations } from '../i18n/provider.tsx';

export function ReversalForm({ productionRunId, requestId, day }: { productionRunId: string; requestId: string; day: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState<ProductionState, FormData>(reverseProductionAction, { error: null });
  return <details><summary>{t('Correct this batch')}</summary><DraftForm result={state} action={action} className="mt-3">
    <input type="hidden" name="productionRunId" value={productionRunId} />
    <input type="hidden" name="requestId" value={requestId} />
    <input type="hidden" name="day" value={day} />
    <p className="prose-note">{t('Reversing restores its stock movements and keeps the original record. It is allowed only when no later stock activity touches the same ingredients.')}</p>
    <p className="prose-note">{t('Use this only to correct an incorrect entry, not a batch that was actually made and lost.')}</p>
    {state.error ? <p className="msg msg--error" role="alert">{t.message(state.error)}</p> : null}
    <label className="label" htmlFor={`reversal-${productionRunId}`}>{t('Correction reason')}</label>
    <textarea className="input" id={`reversal-${productionRunId}`} name="reason" required maxLength={1000} rows={2} />
    <button className="btn btn--secondary" type="submit" disabled={pending}>{t(pending ? 'Reversing…' : 'Reverse batch')}</button>
  </DraftForm></details>;
}
