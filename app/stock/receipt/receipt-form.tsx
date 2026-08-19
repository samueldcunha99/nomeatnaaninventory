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

/**
 * The unit cost shown before saving uses the same helpers the server uses to store it,
 * so what the operator checks against the delivery note is what gets written.
 */
function preview(row: Row, ingredients: IngredientOption[]): string {
  const ing = ingredients.find((i) => i.id === row.ingredientId);
  if (!ing || !row.quantity.trim() || !row.totalCost.trim()) return '—';
  try {
    const qty = purchaseUnitsToMilliBase(row.quantity, ing.purchaseUnitInBase);
    if (qty <= 0n) return '—';
    const paise = rupeesToPaise(row.totalCost);
    const perBase = unitCostMillipaisePerBase(paise, qty);
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
      {state.error ? (
        <div className="msg msg--error" role="alert">
          <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 1.7 19 18H1L10 1.7Zm0 5.3a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Zm0 8.2a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z" />
          </svg>
          <span>
            <span className="msg__title">Receipt not saved. </span>
            {state.error} Nothing was written — the whole receipt is one transaction.
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

      <div className="field max-w-sm">
        <label className="label" htmlFor="supplierId">
          Supplier <span className="font-normal muted">(optional)</span>
        </label>
        <select className="select" id="supplierId" name="supplierId">
          <option value="">—</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Ingredient</th>
              <th scope="col">Quantity</th>
              <th scope="col">Total paid (₹)</th>
              <th scope="col" className="num">
                Works out at
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const ing = ingredients.find((x) => x.id === row.ingredientId);
              const cost = preview(row, ingredients);
              return (
                <tr key={i}>
                  <td>
                    <select
                      className="select min-w-40"
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

                  <td>
                    <div className="flex items-center gap-2">
                      <input
                        className="input w-24 tabular-nums"
                        name={`lines[${i}][quantity]`}
                        value={row.quantity}
                        onChange={(e) => set(i, { quantity: e.target.value })}
                        inputMode="decimal"
                        aria-label={`Quantity, line ${i + 1}`}
                      />
                      <span className="muted text-sm whitespace-nowrap">{ing?.purchaseUnit ?? ''}</span>
                    </div>
                  </td>

                  <td>
                    <input
                      className="input w-28 tabular-nums"
                      name={`lines[${i}][totalCost]`}
                      value={row.totalCost}
                      onChange={(e) => set(i, { totalCost: e.target.value })}
                      inputMode="decimal"
                      aria-label={`Total paid, line ${i + 1}`}
                    />
                  </td>

                  {/* The number to check against the delivery note, so it is emphasised. */}
                  <td
                    className={`num whitespace-nowrap font-semibold ${
                      cost === 'check entry' ? 'text-danger' : cost === '—' ? 'muted font-normal' : 'text-navy'
                    }`}
                    aria-live="polite"
                  >
                    {cost}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3">
        <button className="btn btn--secondary" type="button" onClick={() => setRows((rs) => [...rs, blank()])}>
          + Add line
        </button>
      </p>

      <div className="field max-w-xl">
        <label className="label" htmlFor="note">
          Note <span className="font-normal muted">(optional)</span>
        </label>
        <input className="input" id="note" name="note" maxLength={500} />
      </div>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Record receipt'}
      </button>
    </form>
  );
}
