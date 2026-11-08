'use client';

import { DraftForm } from '../ui/draft-form.tsx';

import { useActionState } from 'react';
import { saveMenuItemAction, type FormState } from './actions.ts';
import { baseUnitLabel, type UnitType } from '../../src/lib/units.ts';
import { useTranslations } from '../i18n/provider.tsx';

export type MenuItemFormValues = {
  id?: string;
  name: string;
  /** Decimal strings - the action converts, once. */
  portionQty: string;
  sellingPrice: string;
  isActive: boolean;
  fulfillmentMode?: 'stocked' | 'made_to_order' | null;
};

const ALERT =
  'M10 1.7 19 18H1L10 1.7Zm0 5.3a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Zm0 8.2a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z';

/**
 * One menu item: what a portion of this recipe sells as, and for how much.
 *
 * The portion is measured in the recipe's OWN yield unit, so the label comes from the
 * recipe rather than from a choice - a batch yielding 12 rolls sells 1 unit at a time, a
 * batch yielding 5 litres of chai sells 250 ml at a time.
 */
export function MenuItemForm({
  recipeId,
  yieldUnitType,
  initial,
  submitLabel,
}: {
  recipeId: string;
  yieldUnitType: UnitType;
  initial?: MenuItemFormValues;
  submitLabel: string;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveMenuItemAction, {
    error: null,
  });

  const id = initial?.id ?? 'new';

  return (
    <DraftForm result={state} action={formAction} className="form-section">
      <input type="hidden" name="recipeId" value={recipeId} />
      <input type="hidden" name="entryUnitType" value={yieldUnitType} />
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      {state.error ? (
        <div className="msg msg--error" role="alert">
          <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d={ALERT} />
          </svg>
          <span>
            <span className="msg__title">{t("Not saved. ")}</span>
            {t.message(state.error)}
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start gap-4">
        <div className="field grow max-w-xs mb-0">
          <label className="label" htmlFor={`name-${id}`}>{t(" Menu item name ")}</label>
          <input
            className="input"
            id={`name-${id}`}
            name="name"
            defaultValue={initial?.name}
            required
            maxLength={120}
            placeholder={t("Cinnamon roll")}
          />
        </div>

        <div className="field mb-0">
          <label className="label" htmlFor={`portionQty-${id}`}>{t(" Quantity per serving ")}</label>
          <div className="flex items-center gap-2">
            <input
              className="input w-28 tabular-nums"
              id={`portionQty-${id}`}
              name="portionQty"
              defaultValue={initial?.portionQty}
              inputMode="decimal"
              required
            />
            <span className="text-sm font-medium text-ink whitespace-nowrap">
              {t(baseUnitLabel(yieldUnitType))}
            </span>
          </div>
        </div>

        <div className="field mb-0">
          <label className="label" htmlFor={`sellingPrice-${id}`}>{t(" Selling price (₹) ")}</label>
          <input
            className="input w-28 tabular-nums"
            id={`sellingPrice-${id}`}
            name="sellingPrice"
            defaultValue={initial?.sellingPrice}
            inputMode="decimal"
            required
          />
        </div>
      </div>

      <div className="field mt-4 max-w-xl">
        <label className="label" htmlFor={`fulfillmentMode-${id}`}>{t('Order stock policy')}</label>
        <select className="select" id={`fulfillmentMode-${id}`} name="fulfillmentMode" defaultValue={initial?.fulfillmentMode ?? ''}>
          <option value="">{t('Not configured for sales')}</option>
          <option value="stocked">{t('Prepared item: take from finished stock')}</option>
          <option value="made_to_order">{t('Made when ordered: take recipe materials')}</option>
        </select>
        <p className="prose-note">{t('Prepared items must be held in stock and produced first. Made-to-order items use materials when the order is recorded and cannot also be logged as manual production.')}</p>
      </div>

      <label className="checkfield mt-3">
        {/*
         * Off the menu today is not gone forever, which is why this is a flag and not a
         * delete. An unchecked box submits nothing at all; that is the whole encoding.
         */}
        <input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} />
        <span>{t("On the menu")}</span>
      </label>

      <p className="mt-3 mb-0">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? t("Saving…") : submitLabel}
        </button>
      </p>
    </DraftForm>
  );
}
