import { WorkspaceHeader } from "../../ui/workspace-header.tsx";
import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { loadOverheadRates } from '../../../src/db/recipes.ts';
import { paiseToRupees } from '../../../src/lib/units.ts';
import { RatesForm } from './rates-form.tsx';
import { getTranslations } from '../../i18n/server.ts';

/**
 * The two numbers that turn a food cost into a real cost.
 *
 * They are tenant-wide because a wage is not a property of a cinnamon roll, and charged
 * per hour of batch time because that is the honest allocator available before order
 * volumes exist: a three-hour dough batch consumes more wages and more oven gas than a
 * two-minute chai, and charging overhead in proportion to grocery cost would say the
 * opposite.
 */
export default async function CostingSettingsPage() {
  const actor = await requirePermission('recipes.manage');
  const t = await getTranslations();
  const rates = await loadOverheadRates(actor);

  return (
    <>
      <WorkspaceHeader actor={actor} title={t("Costing settings")} />

      <main className="page" id="main-content" tabIndex={-1}>
        <p>
          <Link href="/recipes">{t("← Recipes")}</Link>
        </p>
        <h1>{t("What an hour costs")}</h1>
        <p className="prose-note">{t(" Ingredients come from the stock ledger on their own. These two are the part the ledger cannot see: the time a batch takes, priced. Set them once and every recipe in the catalogue recosts itself. ")}</p>

        <RatesForm
          labour={rates?.labourPaisePerHour == null ? '' : paiseToRupees(rates.labourPaisePerHour)}
          kitchen={rates?.kitchenPaisePerHour == null ? '' : paiseToRupees(rates.kitchenPaisePerHour)}
        />

        <h2 className="section-title">{t("How it reaches a recipe")}</h2>
        <p className="prose-note">{t(" Each recipe records how long one batch takes. That time, at these rates, is added to the batch alongside the ingredients — so a sub-recipe carries its own labour upward: a roll using 2160 g of a 4200 g dough batch carries just over half of the time that dough took, without anyone entering it twice. ")}</p>
        <p className="prose-note">{t(" A recipe with no batch time is costed on ingredients alone and says so on its breakdown. Nothing is ever silently charged at zero. ")}</p>
      </main>
    </>
  );
}
