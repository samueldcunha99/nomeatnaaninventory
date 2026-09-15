'use client';

import { useActionState, useRef, useState } from 'react';
import Link from 'next/link';
import { saveRecipeAction, type FormState } from './actions.ts';
import { IngredientCombobox } from '../ui/ingredient-combobox.tsx';
import { baseUnitLabel, type UnitType } from '../../src/lib/units.ts';

export type SourceOption = {
  id: string;
  name: string;
  /** What it is measured in, and therefore the unit this line has to be entered in. */
  unitType: UnitType;
  kind: 'ingredient' | 'recipe';
};

export type RecipeFormValues = {
  id?: string;
  name: string;
  yieldUnitType: UnitType;
  /** Decimal strings throughout - never a float. The action converts, once. */
  yieldQty: string;
  /** Whole minutes, or '' for a recipe nobody has timed. */
  batchMinutes: string;
  notes: string;
  lines: Array<{ sourceId: string; quantity: string; wastage: string }>;
};

/**
 * `sourceText` is what the operator typed; `sourceId` is the resolved match, or '' when
 * the text names nothing. Both are kept so the field can be typed into freely without
 * losing the resolution - only the id is ever submitted.
 */
type Row = { key: string; sourceId: string; sourceText: string; quantity: string; wastage: string };

const ALERT =
  'M10 1.7 19 18H1L10 1.7Zm0 5.3a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Zm0 8.2a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z';

/**
 * The recipe editor. Every save-time rule - cycles, depth, unit compatibility, quantities
 * above zero - lives behind `saveRecipe`, so this is a form over a function that already
 * refuses everything it should. Nothing here re-implements a check.
 *
 * The one thing the form itself has to get right is the UNIT. A quantity is in the unit
 * of whatever the line draws on, and that is not a choice to ask the operator to make
 * twice: pick "Butter" and the box reads grams, pick a volume sub-recipe and it reads
 * millilitres. The label is submitted alongside the quantity so the server can refuse a
 * save where the two have drifted apart.
 */
export function RecipeForm({
  sources,
  initial,
  submitLabel,
}: {
  sources: SourceOption[];
  initial?: RecipeFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveRecipeAction, {
    error: null,
  });

  // Keys are stable across a removal, so a row's combobox does not inherit the state of
  // the row that used to sit at its index.
  const nextKey = useRef(0);
  const blank = (): Row => ({
    key: `r${nextKey.current++}`,
    sourceId: '',
    sourceText: '',
    quantity: '',
    wastage: '',
  });

  const [rows, setRows] = useState<Row[]>(() =>
    initial && initial.lines.length > 0
      ? initial.lines.map((l) => ({
          ...blank(),
          sourceId: l.sourceId,
          sourceText: sources.find((s) => s.id === l.sourceId)?.name ?? '',
          quantity: l.quantity,
          wastage: l.wastage,
        }))
      : [blank(), blank(), blank()],
  );

  // The yield unit is state for the same reason a line's unit is derived: the label beside
  // the number has to say what the number means, and follow when it changes.
  const [yieldUnitType, setYieldUnitType] = useState<UnitType>(initial?.yieldUnitType ?? 'weight');

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  /*
   * A recipe and an ingredient can share a name, and the picker resolves an exact match to
   * whichever comes first - ingredients, since they are listed first. The row says which
   * one it resolved to, so a wrong guess is visible rather than silent.
   */
  const options = sources.map((s) => ({
    id: s.id,
    name: s.name,
    hint: s.kind === 'recipe' ? 'recipe' : undefined,
  }));

  return (
    <form action={formAction} className="recipe-editor">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      {state.error ? (
        <div className="msg msg--error" role="alert">
          <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d={ALERT} />
          </svg>
          <span>
            <span className="msg__title">Not saved. </span>
            {state.error}
          </span>
        </div>
      ) : null}

      <section className="form-section" aria-labelledby="batch-heading">
      <h2 id="batch-heading"><span className="form-section-number">01</span> Batch & yield</h2>
      <div className="field max-w-xl">
        <label className="label" htmlFor="name">
          Recipe name
        </label>
        <input
          className="input"
          id="name"
          name="name"
          defaultValue={initial?.name}
          required
          maxLength={120}
          placeholder="e.g. Double chocolate chunk cookies"
        />
      </div>

      <fieldset className="mb-4 border-0 p-0 m-0">
        <legend className="label">One batch yields</legend>
        <div className="flex flex-wrap items-start gap-3">
          <div className="field mb-0">
            <label className="sr-only" htmlFor="yieldQty">
              Batch yield quantity
            </label>
            <div className="flex items-center gap-2">
              <input
                className="input w-32 tabular-nums"
                id="yieldQty"
                name="yieldQty"
                defaultValue={initial?.yieldQty}
                inputMode="decimal"
                required
              />
              <span className="text-sm font-medium text-ink whitespace-nowrap">
                {baseUnitLabel(yieldUnitType)}
              </span>
            </div>
          </div>

          <div className="field mb-0">
            <label className="sr-only" htmlFor="yieldUnitType">
              Measured in
            </label>
            <select
              className="select w-44"
              id="yieldUnitType"
              name="yieldUnitType"
              value={yieldUnitType}
              onChange={(e) => setYieldUnitType(e.target.value as UnitType)}
            >
              <option value="weight">by weight (g)</option>
              <option value="volume">by volume (ml)</option>
              <option value="count">by count (units)</option>
            </select>
          </div>
        </div>
        <p className="prose-note mt-1">
          Enter the usable amount after preparation. For a batch of 85 cookies, choose
          count and enter 85. For a sauce, enter its finished weight or volume.
        </p>
      </fieldset>

      </section>
      <section className="form-section" aria-labelledby="ingredients-heading">
      <h2 id="ingredients-heading"><span className="form-section-number">02</span> Ingredients & components</h2>
      <p className="prose-note">
        Add everything used for the whole batch. You can include a saved recipe, such as
        garlic butter filling, or a packaging ingredient. Each quantity uses the unit shown.
      </p>

      <div className="table-wrap max-w-3xl">
        <table className="table">
          <thead>
            <tr>
              <th scope="col" className="w-64">
                Ingredient or recipe
              </th>
              <th scope="col" className="w-40">
                Quantity
              </th>
              <th scope="col" className="w-32">
                Wastage
              </th>
              <th scope="col" className="w-24">
                <span className="sr-only">Remove line</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const source = sources.find((s) => s.id === row.sourceId);
              return (
                <tr key={row.key}>
                  <td>
                    <span className="editor-step-label">Ingredient or recipe · {i + 1}</span>
                    <IngredientCombobox
                      fieldName={`lines[${i}][sourceId]`}
                      options={options}
                      value={row.sourceId}
                      text={row.sourceText}
                      onChange={({ id, text }) => set(i, { sourceId: id, sourceText: text })}
                      ariaLabel={`Ingredient or recipe, line ${i + 1}`}
                      noun="ingredient or recipe"
                    />
                    {/*
                     * Exception-only labelling, the same rule the status column keeps: an
                     * ingredient is the ordinary case and says nothing, a sub-recipe is
                     * worth pointing at.
                     */}
                    {source?.kind === 'recipe' ? (
                      <span className="block text-xs muted mt-1">
                        Sub-recipe, measured by {source.unitType}
                      </span>
                    ) : null}
                    <input type="hidden" name={`lines[${i}][sourceKind]`} value={source?.kind ?? ''} />
                    <input type="hidden" name={`lines[${i}][entryUnit]`} value={source?.unitType ?? ''} />
                  </td>

                  <td>
                    <span className="editor-step-label">Quantity</span>
                    <div className="flex items-center gap-2">
                      <input
                        className="input w-24 tabular-nums"
                        name={`lines[${i}][quantity]`}
                        value={row.quantity}
                        onChange={(e) => set(i, { quantity: e.target.value })}
                        inputMode="decimal"
                        aria-label={`Quantity, line ${i + 1}`}
                      />
                      {/* The unit follows the source. Nothing here is typed by hand. */}
                      <span className="text-sm font-medium text-ink whitespace-nowrap">
                        {source ? baseUnitLabel(source.unitType) : ''}
                      </span>
                    </div>
                  </td>

                  <td>
                    <span className="editor-step-label">Wastage</span>
                    <div className="flex items-center gap-2">
                      <input
                        className="input w-20 tabular-nums"
                        name={`lines[${i}][wastage]`}
                        value={row.wastage}
                        onChange={(e) => set(i, { wastage: e.target.value })}
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={`Wastage percent, line ${i + 1}`}
                      />
                      <span className="text-sm font-medium text-ink">%</span>
                    </div>
                  </td>

                  <td>
                    <button
                      className="btn-quiet row-action"
                      type="button"
                      onClick={() =>
                        setRows((rs) => (rs.length === 1 ? [blank()] : rs.filter((_, k) => k !== i)))
                      }
                    >
                      Remove
                      <span className="sr-only"> line {i + 1}</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3">
        <button className="btn btn--secondary" type="button" onClick={() => setRows((rs) => [...rs, blank()])}>
          + Add ingredient or recipe
        </button>
      </p>
      <p className="prose-note mb-0">Wastage adds extra ingredient usage. Leave it at 0 if there is none. Batch losses are already reflected in your usable yield.</p>
      </section>

      <section className="form-section" aria-labelledby="time-heading">
      <h2 id="time-heading"><span className="form-section-number">03</span> Time & method</h2>
      <div className="field max-w-xl">
        <label className="label" htmlFor="batchMinutes">Batch preparation time <span className="font-normal muted">(optional)</span></label>
        <div className="flex items-center gap-2">
          <input className="input w-28 tabular-nums" id="batchMinutes" name="batchMinutes" defaultValue={initial?.batchMinutes} inputMode="numeric" placeholder="90" aria-describedby="batch-hint" />
          <span className="text-sm font-medium text-ink">minutes</span>
        </div>
        <p id="batch-hint" className="prose-note mt-1">Start to finish, including proving and baking. This time and your hourly rates determine the batch’s labour and kitchen costs. Leave blank if you have not timed it yet.</p>
      </div>

      <div className="field max-w-xl">
        <label className="label" htmlFor="notes">
          Method notes <span className="font-normal muted">(optional)</span>
        </label>
        <textarea
          className="input"
          id="notes"
          name="notes"
          rows={3}
          maxLength={2000}
          defaultValue={initial?.notes}
        />
      </div>
      </section>
      <div className="save-bar">
      <p className="prose-note mb-0">Save your recipe, then review its cost and set serving prices.</p>
      <div className="flex gap-3 items-center"><Link className="btn btn--secondary" href={initial?.id ? `/recipes/${initial.id}/cost` : '/recipes'}>Cancel</Link><button className="btn" type="submit" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </button></div>
      </div>
    </form>
  );
}
