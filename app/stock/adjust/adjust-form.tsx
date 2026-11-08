'use client';

import { DraftForm } from '../../ui/draft-form.tsx';

import { useActionState, useState } from 'react';
import { recordCorrectionAction, type FormState } from '../actions.ts';
import { useTranslations } from '../../i18n/provider.tsx';

export type IngredientOption = { id: string; name: string; purchaseUnit: string; purchaseUnitInBase: number; unitType: 'weight' | 'volume' | 'count' };

const ADJUSTMENT_REASONS = [
  ['count_correction', 'Count correction'],
  ['theft', 'Theft'],
  ['other', 'Other'],
] as const;

const WASTAGE_REASONS = [
  ['spoilage', 'Spoilage'],
  ['expiry', 'Expiry'],
  ['burnt', 'Burnt'],
  ['dropped', 'Dropped'],
  ['trim', 'Trim'],
  ['other', 'Other'],
] as const;

export function AdjustForm({ ingredients }: { ingredients: IngredientOption[] }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState<FormState, FormData>(recordCorrectionAction, {
    error: null,
    ok: null,
  });
  const [kind, setKind] = useState<'adjustment' | 'wastage'>('adjustment');
  const [reason, setReason] = useState<string>('count_correction');
  const [ingredientId, setIngredientId] = useState('');

  const reasons = kind === 'wastage' ? WASTAGE_REASONS : ADJUSTMENT_REASONS;
  const chosen = ingredients.find((i) => i.id === ingredientId);
  const unit = chosen?.purchaseUnit ?? '';

  const switchKind = (next: 'adjustment' | 'wastage') => {
    setKind(next);
    setReason(next === 'wastage' ? 'spoilage' : 'count_correction');
  };

  return (
    <DraftForm result={state} action={formAction} className="max-w-xl">
      <input type="hidden" name="kind" value={kind} />
      {/* The pack this quantity is being typed in. Compared server-side, never used as a
          conversion factor - see staleUnit in ../actions.ts. */}
      {chosen ? <><input type="hidden" name="unitInBase" value={chosen.purchaseUnitInBase} />
        <input type="hidden" name="entryUnitType" value={chosen.unitType} /></> : null}

      {state.error ? (
        <div className="msg msg--error" role="alert">
          <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 1.7 19 18H1L10 1.7Zm0 5.3a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Zm0 8.2a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z" />
          </svg>
          <span>
            <span className="msg__title">{t("Not recorded. ")}</span>
            {t.message(state.error)}
          </span>
        </div>
      ) : null}

      {state.ok ? (
        <div className="msg msg--ok" role="status">
          <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M8 14.2 3.8 10l1.4-1.4L8 11.4l6.8-6.8L16.2 6 8 14.2Z" />
          </svg>
          <span>
            <span className="msg__title">{t("Saved. ")}</span>
            {t(state.ok)}
          </span>
        </div>
      ) : null}

      <fieldset className="field border-0 p-0 m-0 mb-4">
        <legend className="label">{t("What happened")}</legend>
        <div className="flex flex-wrap gap-2">
          {/*
           * Two big targets rather than small radios. This is the first decision on the
           * screen and it changes which reasons are valid, so it should be hard to
           * mis-tap during a rush.
           */}
          <label className={`radiocard ${kind === 'adjustment' ? 'radiocard--on' : ''}`}>
            <input
              type="radio"
              className="sr-only"
              checked={kind === 'adjustment'}
              onChange={() => switchKind('adjustment')}
            />
            <span className="font-semibold">{t("Adjustment")}</span>
            <span className="radiocard__hint">{t("The count was wrong")}</span>
          </label>

          <label className={`radiocard ${kind === 'wastage' ? 'radiocard--on' : ''}`}>
            <input
              type="radio"
              className="sr-only"
              checked={kind === 'wastage'}
              onChange={() => switchKind('wastage')}
            />
            <span className="font-semibold">{t("Wastage")}</span>
            <span className="radiocard__hint">{t("Stock was lost")}</span>
          </label>
        </div>
      </fieldset>

      <div className="field">
        <label className="label" htmlFor="ingredientId">{t(" Ingredient ")}</label>
        <select
          className="select"
          id="ingredientId"
          name="ingredientId"
          value={ingredientId}
          onChange={(e) => setIngredientId(e.target.value)}
          required
        >
          <option value="">—</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </div>

      {kind === 'adjustment' ? (
        <fieldset className="field border-0 p-0 m-0 mb-4">
          <legend className="label">{t("Direction")}</legend>
          <div className="flex flex-wrap gap-4">
            <label className="checkfield">
              <input type="radio" name="direction" value="remove" defaultChecked className="size-5" />{t(" Remove stock ")}</label>
            <label className="checkfield">
              <input type="radio" name="direction" value="add" className="size-5" />{t(" Add stock ")}</label>
          </div>
        </fieldset>
      ) : (
        // Wastage only ever removes stock, so offering the choice would be a trap.
        <input type="hidden" name="direction" value="remove" />
      )}

      <div className="field max-w-xs">
        <label className="label" htmlFor="quantity">{t(" Quantity ")}{unit ? <span className="font-normal muted">({unit})</span> : null}
        </label>
        <input className="input tabular-nums" id="quantity" name="quantity" inputMode="decimal" required />
      </div>

      <div className="field max-w-xs">
        <label className="label" htmlFor="reason">{t(" Reason ")}</label>
        <select
          className="select"
          id="reason"
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          {reasons.map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="label" htmlFor="note">{t(" Note")}{' '}
          {reason === 'other' ? (
            <span className="text-danger">{t("(required)")}</span>
          ) : (
            <span className="font-normal muted">{t("(optional)")}</span>
          )}
        </label>
        <input
          className="input"
          id="note"
          name="note"
          maxLength={500}
          required={reason === 'other'}
          aria-required={reason === 'other'}
        />
      </div>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? t("Saving…") : t("Record {0}", { "0": t(kind) })}
      </button>
    </DraftForm>
  );
}
