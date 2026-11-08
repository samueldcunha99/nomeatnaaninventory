import { PageTutorial } from '../../ui/page-tutorial.tsx';
import { WorkspaceHeader } from "../../ui/workspace-header.tsx";
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '../../../src/auth/server.ts';
import { getIngredient } from '../../../src/db/ingredients.ts';
import { updateIngredientAction } from '../actions.ts';
import { IngredientForm } from '../ingredient-form.tsx';
import { StatusBadge } from '../../ui/status-badge.tsx';
import {

  formatINR,
  costPerPurchaseUnitPaise,
  milliBaseToPurchaseUnits,
  baseUnitLabel,
  isLowStock,
} from '../../../src/lib/units.ts';
import { getTranslations } from '../../i18n/server.ts';

export default async function EditIngredientPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('ingredients.manage');
  const t = await getTranslations();
  const { id } = await params;
  const ingredient = await getIngredient(actor, id);
  if (!ingredient) notFound();

  const oversold = ingredient.qtyMilliBase < 0;
  const low = isLowStock(ingredient.qtyMilliBase, ingredient.lowStockThresholdMilliBase);

  return (
    <>
      <WorkspaceHeader actor={actor} title={t("Ingredient")} />

      <main className="page" id="main-content" tabIndex={-1}>
      <PageTutorial topic="ingredientEdit" role={actor.role} />
        <p>
          <Link href="/ingredients">{t("← Ingredients")}</Link>
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <h1>{ingredient.name}</h1>
          <StatusBadge kind={oversold ? 'oversold' : low ? 'low' : null} />
          {!ingredient.isActive ? <span className="badge badge--muted">{t("Inactive")}</span> : null}
        </div>

        {/*
         * Current position, read-only. Stock and cost move only through the ledger, and
         * saying so here is what stops someone looking for a field to type them into.
         */}
        <dl className="grid gap-4 sm:grid-cols-3 my-6 p-4 bg-surface border-2 border-mist rounded-md">
          <div>
            <dt className="text-sm uppercase tracking-wide muted">{t("On hand")}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${oversold ? 'text-danger' : ''}`}>
              {milliBaseToPurchaseUnits(ingredient.qtyMilliBase, ingredient.purchaseUnitInBase)}{' '}
              {ingredient.purchaseUnit}
              <span className="block text-sm font-normal muted">
                {t.quantity(ingredient.qtyMilliBase, ingredient.unitType)}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-sm uppercase tracking-wide muted">{t("Weighted avg cost")}</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {ingredient.weightedAvgCostMillipaisePerBase === null ? t('Unknown') : formatINR(
                costPerPurchaseUnitPaise(
                  ingredient.weightedAvgCostMillipaisePerBase,
                  ingredient.purchaseUnitInBase,
                ),
              )}
              <span className="block text-sm font-normal muted">{t("per ")}{ingredient.purchaseUnit}</span>
            </dd>
          </div>
          <div>
            <dt className="text-sm uppercase tracking-wide muted">{t("Bought by")}</dt>
            <dd className="text-lg font-semibold">
              {ingredient.purchaseUnit}
              <span className="block text-sm font-normal muted">
                = {ingredient.purchaseUnitInBase} {t(baseUnitLabel(ingredient.unitType))}
              </span>
            </dd>
          </div>
        </dl>

        <p className="prose-note">{t(" Stock and cost move only through the stock ledger, never by editing here.")}{' '}
          <Link href={{ pathname: '/stock/history', query: { ingredientId: ingredient.id } }}>{t(" See this ingredient’s movements ")}</Link>
          .
        </p>

        <h2 className="section-title mt-6">{t("Details")}</h2>
        <IngredientForm
          action={updateIngredientAction}
          submitLabel={t("Save changes")}
          initial={{
            id: ingredient.id,
            name: ingredient.name,
            brand: ingredient.brand ?? '',
            unitType: ingredient.unitType,
            purchaseUnit: ingredient.purchaseUnit,
            purchaseUnitInBase: ingredient.purchaseUnitInBase,
            lowStockThreshold: milliBaseToPurchaseUnits(
              ingredient.lowStockThresholdMilliBase,
              ingredient.purchaseUnitInBase,
            ),
          }}
        />
      </main>
    </>
  );
}
