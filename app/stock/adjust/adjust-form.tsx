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

const row = { display: 'block', marginBottom: 12 } as const;

export function AdjustForm({ ingredients }: { ingredients: IngredientOption[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(recordCorrectionAction, {
    error: null,
    ok: null,
  });
  const [kind, setKind] = useState<'adjustment' | 'wastage'>('adjustment');
  const [reason, setReason] = useState<string>('count_correction');
  const [ingredientId, setIngredientId] = useState('');

  // Wastage only ever removes stock, so the direction choice would be a trap.
  const reasons = kind === 'wastage' ? WASTAGE_REASONS : ADJUSTMENT_REASONS;
  const unit = ingredients.find((i) => i.id === ingredientId)?.purchaseUnit ?? '';

  const switchKind = (next: 'adjustment' | 'wastage') => {
    setKind(next);
    setReason(next === 'wastage' ? 'spoilage' : 'count_correction');
  };

  return (
    <form action={formAction}>
      <input type="hidden" name="kind" value={kind} />

      <fieldset style={{ marginBottom: 12 }}>
        <legend>What happened</legend>
        <label style={{ marginRight: 16 }}>
          <input type="radio" checked={kind === 'adjustment'} onChange={() => switchKind('adjustment')} /> Adjustment
          — the count was wrong
        </label>
        <label>
          <input type="radio" checked={kind === 'wastage'} onChange={() => switchKind('wastage')} /> Wastage — stock
          was lost
        </label>
      </fieldset>

      <label htmlFor="ingredientId">Ingredient</label>
      <select
        id="ingredientId"
        name="ingredientId"
        value={ingredientId}
        onChange={(e) => setIngredientId(e.target.value)}
        required
        style={row}
      >
        <option value="">—</option>
        {ingredients.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </select>

      {kind === 'adjustment' ? (
        <fieldset style={{ marginBottom: 12 }}>
          <legend>Direction</legend>
          <label style={{ marginRight: 16 }}>
            <input type="radio" name="direction" value="remove" defaultChecked /> Remove stock
          </label>
          <label>
            <input type="radio" name="direction" value="add" /> Add stock
          </label>
        </fieldset>
      ) : (
        <input type="hidden" name="direction" value="remove" />
      )}

      <label htmlFor="quantity">Quantity {unit ? `(${unit})` : ''}</label>
      <input id="quantity" name="quantity" inputMode="decimal" required style={row} />

      <label htmlFor="reason">Reason</label>
      <select id="reason" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} style={row}>
        {reasons.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <label htmlFor="note">Note {reason === 'other' ? '(required)' : '(optional)'}</label>
      <input id="note" name="note" maxLength={500} required={reason === 'other'} style={row} />

      {state.error ? (
        <p role="alert" style={{ color: '#b00' }}>
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" style={{ color: '#070' }}>
          {state.ok}
        </p>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Record'}
      </button>
    </form>
  );
}
