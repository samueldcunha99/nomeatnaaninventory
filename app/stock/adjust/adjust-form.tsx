'use client';

import { useActionState, useState } from 'react';
import { recordCorrectionAction, type FormState } from '../actions.ts';

export type IngredientOption = { id: string; name: string; purchaseUnit: string };

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
  const [state, formAction, pending] = useActionState<FormState, FormData>(recordCorrectionAction, {
    error: null,
    ok: null,
  });
  const [kind, setKind] = useState<'adjustment' | 'wastage'>('adjustment');
  const [reason, setReason] = useState<string>('count_correction');
  const [ingredientId, setIngredientId] = useState('');

  const reasons = kind === 'wastage' ? WASTAGE_REASONS : ADJUSTMENT_REASONS;
  const unit = ingredients.find((i) => i.id === ingredientId)?.purchaseUnit ?? '';

  const switchKind = (next: 'adjustment' | 'wastage') => {
    setKind(next);
    setReason(next === 'wastage' ? 'spoilage' : 'count_correction');
  };

  return (
    <form action={formAction} className="max-w-xl">
      <input type="hidden" name="kind" value={kind} />

      {state.error ? (
        <div className="msg msg--error" role="alert">
          <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 1.7 19 18H1L10 1.7Zm0 5.3a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Zm0 8.2a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z" />
          </svg>
          <span>
            <span className="msg__title">Not recorded. </span>
            {state.error}
          </span>
        </div>
      ) : null}

      {state.ok ? (
        <div className="msg msg--ok" role="status">
          <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M8 14.2 3.8 10l1.4-1.4L8 11.4l6.8-6.8L16.2 6 8 14.2Z" />
          </svg>
          <span>
            <span className="msg__title">Saved. </span>
            {state.ok}
          </span>
        </div>
      ) : null}

      <fieldset className="field border-0 p-0 m-0 mb-4">
        <legend className="label">What happened</legend>
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
            <span className="font-semibold">Adjustment</span>
            <span className="radiocard__hint">The count was wrong</span>
          </label>

          <label className={`radiocard ${kind === 'wastage' ? 'radiocard--on' : ''}`}>
            <input
              type="radio"
              className="sr-only"
              checked={kind === 'wastage'}
              onChange={() => switchKind('wastage')}
            />
            <span className="font-semibold">Wastage</span>
            <span className="radiocard__hint">Stock was lost</span>
          </label>
        </div>
      </fieldset>

      <div className="field">
        <label className="label" htmlFor="ingredientId">
          Ingredient
        </label>
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
          <legend className="label">Direction</legend>
          <div className="flex flex-wrap gap-4">
            <label className="checkfield">
              <input type="radio" name="direction" value="remove" defaultChecked className="size-5" />
              Remove stock
            </label>
            <label className="checkfield">
              <input type="radio" name="direction" value="add" className="size-5" />
              Add stock
            </label>
          </div>
        </fieldset>
      ) : (
        // Wastage only ever removes stock, so offering the choice would be a trap.
        <input type="hidden" name="direction" value="remove" />
      )}

      <div className="field max-w-xs">
        <label className="label" htmlFor="quantity">
          Quantity {unit ? <span className="font-normal muted">({unit})</span> : null}
        </label>
        <input className="input tabular-nums" id="quantity" name="quantity" inputMode="decimal" required />
      </div>

      <div className="field max-w-xs">
        <label className="label" htmlFor="reason">
          Reason
        </label>
        <select
          className="select"
          id="reason"
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          {reasons.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="label" htmlFor="note">
          Note{' '}
          {reason === 'other' ? (
            <span className="text-danger">(required)</span>
          ) : (
            <span className="font-normal muted">(optional)</span>
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
        {pending ? 'Saving…' : `Record ${kind}`}
      </button>
    </form>
  );
}
