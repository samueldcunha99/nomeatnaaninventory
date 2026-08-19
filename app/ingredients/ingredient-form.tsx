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

const row = { display: 'block', width: '100%', marginBottom: 12 } as const;

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
    <form action={formAction}>
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <label htmlFor="name">Name</label>
      <input id="name" name="name" defaultValue={initial?.name} required maxLength={120} style={row} />

      <label htmlFor="unitType">Measured in</label>
      <select id="unitType" name="unitType" defaultValue={initial?.unitType ?? 'weight'} style={row}>
        <option value="weight">Weight (grams)</option>
        <option value="volume">Volume (millilitres)</option>
        <option value="count">Count (units)</option>
      </select>

      <label htmlFor="purchaseUnit">Purchase unit</label>
      <input id="purchaseUnit" name="purchaseUnit" defaultValue={initial?.purchaseUnit} placeholder="kg, litre, tray" required style={row} />

      <label htmlFor="purchaseUnitInBase">Base units per purchase unit</label>
      <input id="purchaseUnitInBase" name="purchaseUnitInBase" type="number" min={1} step={1} defaultValue={initial?.purchaseUnitInBase ?? 1000} required style={row} />
      <p style={{ marginTop: -8, fontSize: 13, color: '#555' }}>
        Buying in kg with grams as the base unit gives 1000. A tray of 30 eggs gives 30.
      </p>

      <label htmlFor="lowStockThreshold">Low stock threshold (in purchase units)</label>
      <input id="lowStockThreshold" name="lowStockThreshold" defaultValue={initial?.lowStockThreshold ?? '0'} inputMode="decimal" style={row} />

      {state.error ? (
        <p role="alert" style={{ color: '#b00' }}>
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? 'Saving...' : submitLabel}
      </button>
    </form>
  );
}
