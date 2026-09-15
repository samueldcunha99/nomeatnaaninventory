'use client';

import { useActionState, useEffect, useState } from 'react';
import { recordReceiptAction, type FormState } from '../actions.ts';
import { IngredientCombobox } from '../../ui/ingredient-combobox.tsx';
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

/**
 * `ingredientText` is what the operator typed; `ingredientId` is the resolved match, or
 * '' when the text names nothing. Both are kept so the field can be typed into freely
 * without losing the resolution — only the id is ever submitted.
 */
type Row = { ingredientId: string; ingredientText: string; quantity: string; totalCost: string };

const blank = (): Row => ({ ingredientId: '', ingredientText: '', quantity: '', totalCost: '' });

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

  /*
   * A saved receipt leaves the lines on screen, the button re-enabled and no new-receipt
   * step, and recordReceipt mints a fresh reference every call - so a second click, or a
   * retry after a lost response, writes the delivery twice. The ledger is append-only, so
   * undoing that means a counter-movement rather than a delete. Clearing on success is
   * the cheap half of the fix.
   *
   * useActionState hands back a new state object per submission, so this fires on every
   * success, including two identical ones in a row.
   *
   * ponytail: no idempotency key. Two rapid clicks on the SAME render can still both land
   * before this runs. A submission token checked server-side is the real fix, and Month 3
   * needs one anyway for orders - do both there.
   */
  useEffect(() => {
    if (state.ok) setRows([blank(), blank(), blank()]);
  }, [state]);

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

      <div className="table-wrap max-w-3xl">
        <table className="table">
          <thead>
            <tr>
              <th scope="col" className="w-56">Ingredient</th>
              <th scope="col" className="w-40">Quantity</th>
              <th scope="col" className="w-36">Total paid (₹)</th>
              <th scope="col" className="num whitespace-nowrap">
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
                    <IngredientCombobox
                      fieldName={`lines[${i}][ingredientId]`}
                      options={ingredients}
                      value={row.ingredientId}
                      text={row.ingredientText}
                      onChange={({ id, text }) => set(i, { ingredientId: id, ingredientText: text })}
                      ariaLabel={`Ingredient, line ${i + 1}`}
                    />
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
                      <span className="text-sm font-medium text-ink whitespace-nowrap">
                        {ing?.purchaseUnit ?? ''}
                      </span>
                      {/*
                        The pack this row was PRICED against, as displayed. The server
                        never calculates with it - it compares it with the ingredient's
                        current pack and refuses the receipt if someone has changed the
                        definition since this page loaded. A tampered value can only
                        cause a refusal, never a wrong quantity.
                      */}
                      {ing ? (
                        <input
                          type="hidden"
                          name={`lines[${i}][unitInBase]`}
                          value={ing.purchaseUnitInBase}
                        />
                      ) : null}
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
