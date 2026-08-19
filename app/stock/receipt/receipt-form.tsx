'use client';

import { useActionState, useState } from 'react';
import { recordReceiptAction, type FormState } from '../actions.ts';
import {
  unitCostMillipaisePerBase,
  purchaseUnitsToMilliBase,
  rupeesToPaise,
  costPerPurchaseUnitPaise,
  formatINR,
} from '../../../src/lib/units.ts';

export type IngredientOption = {
  id: string;
  name: string;
  purchaseUnit: string;
  purchaseUnitInBase: number;
};

type Row = { ingredientId: string; quantity: string; totalCost: string };

const blank = (): Row => ({ ingredientId: '', quantity: '', totalCost: '' });
const cell = { padding: '4px 6px', verticalAlign: 'top' } as const;

/**
 * The unit cost shown before saving uses the same helper the server uses to store it,
 * so what the operator checks is what gets written - not a separate approximation.
 */
function preview(row: Row, ingredients: IngredientOption[]): string {
  const ing = ingredients.find((i) => i.id === row.ingredientId);
  if (!ing || !row.quantity.trim() || !row.totalCost.trim()) return '—';
  try {
    const qty = purchaseUnitsToMilliBase(row.quantity, ing.purchaseUnitInBase);
    if (qty <= 0n) return '—';
    const paise = rupeesToPaise(row.totalCost);
    const perBase = unitCostMillipaisePerBase(paise, qty);
    // Shown per purchase unit, which is how anyone checking a delivery note thinks.
    return `${formatINR(costPerPurchaseUnitPaise(perBase, ing.purchaseUnitInBase))} / ${ing.purchaseUnit}`;
  } catch {
    return 'check entry';
  }
}

export function ReceiptForm({
  ingredients,
  suppliers,
}: {
  ingredients: IngredientOption[];
  suppliers: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(recordReceiptAction, {
    error: null,
    ok: null,
  });
  const [rows, setRows] = useState<Row[]>([blank(), blank(), blank()]);

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <form action={formAction}>
      <label htmlFor="supplierId">Supplier (optional)</label>
      <select id="supplierId" name="supplierId" style={{ display: 'block', marginBottom: 12 }}>
        <option value="">—</option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <table style={{ borderCollapse: 'collapse', marginBottom: 12 }}>
        <thead>
          <tr>
            <th style={cell}>Ingredient</th>
            <th style={cell}>Quantity</th>
            <th style={cell}>Total paid (₹)</th>
            <th style={cell}>Unit cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const ing = ingredients.find((x) => x.id === row.ingredientId);
            return (
              <tr key={i}>
                <td style={cell}>
                  <select
                    name={`lines[${i}][ingredientId]`}
                    value={row.ingredientId}
                    onChange={(e) => set(i, { ingredientId: e.target.value })}
                    aria-label={`Ingredient, line ${i + 1}`}
                  >
                    <option value="">—</option>
                    {ingredients.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={cell}>
                  <input
                    name={`lines[${i}][quantity]`}
                    value={row.quantity}
                    onChange={(e) => set(i, { quantity: e.target.value })}
                    inputMode="decimal"
                    size={8}
                    aria-label={`Quantity, line ${i + 1}`}
                  />{' '}
                  {ing?.purchaseUnit ?? ''}
                </td>
                <td style={cell}>
                  <input
                    name={`lines[${i}][totalCost]`}
                    value={row.totalCost}
                    onChange={(e) => set(i, { totalCost: e.target.value })}
                    inputMode="decimal"
                    size={10}
                    aria-label={`Total paid, line ${i + 1}`}
                  />
                </td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{preview(row, ingredients)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p>
        <button type="button" onClick={() => setRows((rs) => [...rs, blank()])}>
          + Add line
        </button>
      </p>

      <label htmlFor="note">Note (optional)</label>
      <input id="note" name="note" maxLength={500} style={{ display: 'block', width: '100%', marginBottom: 12 }} />

      {state.error ? (
        <p role="alert" style={{ color: '#b00' }}>
          {state.error} Nothing was saved — the whole receipt is one transaction.
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" style={{ color: '#070' }}>
          {state.ok}
        </p>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Record receipt'}
      </button>
    </form>
  );
}
