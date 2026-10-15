'use client';

import { useActionState, useMemo, useState } from 'react';
import { recordProductionAction, holdRecipeAction, type ProductionState } from './actions.ts';
import { productionGraph, type ProductionRecipeOption } from '../../src/lib/production-form.ts';
import { planDraws } from '../../src/lib/production.ts';
import { formatQty, parseDecimalToInteger, type UnitType } from '../../src/lib/units.ts';
import { baseRecipeUnit, changeRecipeQuantityUnit, RECIPE_UNITS, type RecipeQuantityUnit } from '../../src/lib/recipe-quantity.ts';

type Ingredient = { id: string; name: string; unitType: UnitType; qtyMilliBase: string };

export function ProductionForm({ recipes, ingredients, day, today, requestId, initialRecipeId = '' }: {
  recipes: ProductionRecipeOption[]; ingredients: Ingredient[]; day: string; today: string;
  requestId: string; initialRecipeId?: string;
}) {
  const [state, action, pending] = useActionState<ProductionState, FormData>(recordProductionAction, { error: null });
  const [holdState, holdAction, holding] = useActionState<ProductionState, FormData>(holdRecipeAction, { error: null });
  const [recipeId, setRecipeId] = useState(initialRecipeId);
  const [batches, setBatches] = useState('1');
  const selected = recipes.find(r => r.id === recipeId);
  const [actual, setActual] = useState('');
  const [unit, setUnit] = useState<RecipeQuantityUnit>(baseRecipeUnit(selected?.yieldUnitType ?? 'weight'));
  const [unitError, setUnitError] = useState<string | null>(null);
  const graph = useMemo(() => productionGraph(recipes), [recipes]);
  let preview: ReturnType<typeof planDraws> | undefined;
  let previewError: string | undefined;
  if (selected) {
    try {
      if (batches.length > 24) throw new RangeError('Batch count is too long.');
      preview = planDraws(selected.id, graph, parseDecimalToInteger(batches, 1000n));
    } catch (error) { previewError = error instanceof Error ? error.message : 'Review this recipe before recording it.'; }
  }

  return <>
    <form action={action} className="recipe-editor max-w-4xl">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="recipeUpdatedAt" value={selected?.updatedAt ?? ''} />
      <input type="hidden" name="yieldUnitType" value={selected?.yieldUnitType ?? ''} />
      {state.error ? <p className="msg msg--error" role="alert"><strong>Not recorded. </strong>{state.error}</p> : null}
      <section className="form-section" aria-labelledby="production-entry-heading">
        <h2 id="production-entry-heading">Record a batch</h2>
        <div className="flex flex-wrap gap-4">
          <div className="field"><label className="label" htmlFor="producedOn">Day made</label>
            <input className="input" type="date" id="producedOn" name="producedOn" defaultValue={day} max={today} required /></div>
          <div className="field grow"><label className="label" htmlFor="recipeId">Recipe / item made</label>
            <select className="select w-full" id="recipeId" name="recipeId" value={recipeId} required onChange={e => {
              setRecipeId(e.target.value); setActual(''); setUnitError(null);
              setUnit(baseRecipeUnit(recipes.find(r => r.id === e.target.value)?.yieldUnitType ?? 'weight'));
            }}>
              <option value="">Choose a recipe</option>
              {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></div>
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="field"><label className="label" htmlFor="batches">Batches made</label>
            <input className="input w-32" id="batches" name="batches" inputMode="decimal" maxLength={24}
              value={batches} onChange={e => setBatches(e.target.value)} required />
            <p className="prose-note">Use 0.5 for half a batch or 2 for two batches.</p></div>
          <div className="field"><label className="label" htmlFor="actualYield">Measured output</label>
            <div className="flex gap-2"><input className="input w-36" id="actualYield" name="actualYield" inputMode="decimal"
              value={actual} onChange={e => { setActual(e.target.value); setUnitError(null); }} maxLength={24} required />
              <select className="select w-40" name="actualUnit" aria-label="Measured output unit" value={unit} disabled={!selected}
                onChange={e => {
                  const next = e.target.value as RecipeQuantityUnit;
                  try { setActual(changeRecipeQuantityUnit(actual, unit, next)); setUnit(next); setUnitError(null); }
                  catch { setUnitError('Finish entering the output number before changing its unit.'); }
                }}>
                {RECIPE_UNITS.filter(u => !selected || u.unitType === selected.yieldUnitType).map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select></div>
            <p className="prose-note">Enter what actually came out. Zero records a fully lost batch.</p></div>
        </div>
        {unitError ? <p className="msg msg--error" role="alert">{unitError}</p> : null}
        {previewError ? <p className="msg msg--error"><strong>Review the recipe. </strong>{previewError}</p> : null}
        {preview ? <>
          <p className="prose-note"><strong>Expected output: {formatQty(preview.expectedYieldMilliBase, preview.recipe.yieldUnitType)}.</strong>{' '}
            {selected?.stockIngredientId ? 'Measured output will be added to stock.' : 'This item is recorded as made for immediate use or sale.'}</p>
          <h3>Materials this batch will use</h3>
          <div className="table-wrap"><table className="table"><thead><tr><th>Ingredient / component</th><th className="num">To use</th><th className="num">Currently in stock</th></tr></thead>
            <tbody>{preview.draws.map((draw, index) => {
              const ingredient = ingredients.find(i => i.id === draw.ingredientId);
              return <tr key={`${draw.ingredientId}:${index}`}><td>{ingredient?.name ?? draw.ingredientId}</td>
                <td className="num">{ingredient ? formatQty(draw.issuedMilliBase, ingredient.unitType) : 'Unavailable'}</td>
                <td className="num">{ingredient ? formatQty(BigInt(ingredient.qtyMilliBase), ingredient.unitType) : 'Unavailable'}</td></tr>;
            })}</tbody></table></div>
          <p className="prose-note">Usage follows the recipe and batch count, including its wastage allowance. Record extra discarded stock separately under Adjustments & waste.</p>
        </> : null}
        <div className="field"><label className="label" htmlFor="note">Batch notes (optional)</label>
          <textarea className="input" id="note" name="note" maxLength={2000} rows={2} /></div>
        <p className="prose-note">Recording deducts these materials from stock. Check the batch count and output before saving. Recorded runs cannot currently be edited or undone.</p>
        <button className="btn" type="submit" disabled={pending || holding || !preview || Boolean(unitError)}>{pending ? 'Recording…' : 'Record production'}</button>
      </section>
    </form>
    {selected && !selected.stockIngredientId ? <form action={holdAction} className="form-section max-w-4xl mt-4">
      <input type="hidden" name="recipeId" value={selected.id} />
      <h2>Keep this item in stock</h2>
      <p className="prose-note">Use this for dough, sauces or other items stored before use. Future batches will go into stock, and their ingredients need recorded purchase prices. Previously logged batches are not added. This setting cannot currently be reversed.</p>
      {holdState.error ? <p className="msg msg--error" role="alert">{holdState.error}</p> : null}
      <button className="btn btn--secondary" type="submit" disabled={holding || pending}>{holding ? 'Updating…' : `Hold ${selected.name} in stock`}</button>
    </form> : null}
  </>;
}
