'use client';

import { useActionState } from 'react';
import type { FormState } from './actions.ts';

export type FormValues = {
  id?: string;
  name: string;
  unitType: 'weight' | 'volume' | 'count';
  purchaseUnit: string;
  purchaseUnitInBase: number;
  /** in purchase units, as a decimal string - never a float */
  lowStockThreshold: string;
};

export function IngredientForm({
  action,
  initial,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  initial?: FormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form action={formAction} className="max-w-xl">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      {state.error ? (
        <div className="msg msg--error" role="alert">
          <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 1.7 19 18H1L10 1.7Zm0 5.3a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Zm0 8.2a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z" />
          </svg>
          <span>
            <span className="msg__title">Not saved. </span>
            {state.error}
          </span>
        </div>
      ) : null}

      <div className="field">
        <label className="label" htmlFor="name">
          Name
        </label>
        <input className="input" id="name" name="name" defaultValue={initial?.name} required maxLength={120} />
      </div>

      <div className="field max-w-xs">
        <label className="label" htmlFor="unitType">
          Measured in
        </label>
        <select className="select" id="unitType" name="unitType" defaultValue={initial?.unitType ?? 'weight'}>
          <option value="weight">Weight (grams)</option>
          <option value="volume">Volume (millilitres)</option>
          <option value="count">Count (units)</option>
        </select>
      </div>

      <div className="field max-w-xs">
        <label className="label" htmlFor="purchaseUnit">
          Purchase unit
        </label>
        <input
          className="input"
          id="purchaseUnit"
          name="purchaseUnit"
          defaultValue={initial?.purchaseUnit}
          placeholder="kg, litre, tray"
          required
        />
      </div>

      <div className="field max-w-xs">
        <label className="label" htmlFor="purchaseUnitInBase">
          Base units per purchase unit
        </label>
        <input
          className="input tabular-nums"
          id="purchaseUnitInBase"
          name="purchaseUnitInBase"
          type="number"
          min={1}
          step={1}
          defaultValue={initial?.purchaseUnitInBase ?? 1000}
          required
          aria-describedby="puib-hint"
        />
        <p id="puib-hint" className="prose-note mt-1">
          Buying in kg with grams as the base unit gives 1000. A tray of 30 eggs gives 30.
        </p>
      </div>

      <div className="field max-w-xs">
        <label className="label" htmlFor="lowStockThreshold">
          Low stock threshold
        </label>
        <input
          className="input tabular-nums"
          id="lowStockThreshold"
          name="lowStockThreshold"
          defaultValue={initial?.lowStockThreshold ?? '0'}
          inputMode="decimal"
          aria-describedby="threshold-hint"
        />
        <p id="threshold-hint" className="prose-note mt-1">
          In purchase units. The ingredient appears on the low stock list at or below this.
        </p>
      </div>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
