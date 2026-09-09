import Link from 'next/link';
import { requirePermission } from '../../../src/auth/server.ts';
import { loadOverheadRates } from '../../../src/db/recipes.ts';
import { paiseToRupees } from '../../../src/lib/units.ts';
import { RatesForm } from './rates-form.tsx';

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
  const rates = await loadOverheadRates(actor);

  return (
    <>
      <header className="brandbar">
        <div className="brandbar__inner">
          <Link className="brandbar__name text-on-navy no-underline" href="/">
            NO MEAT NAAN
          </Link>
          <span className="text-sm opacity-85">Costing settings</span>
        </div>
      </header>

      <main className="page">
        <p>
          <Link href="/recipes">← Recipes</Link>
        </p>
        <h1>What an hour costs</h1>
        <p className="prose-note">
          Ingredients come from the stock ledger on their own. These two are the part the
          ledger cannot see: the time a batch takes, priced. Set them once and every recipe
          in the catalogue recosts itself.
        </p>

        <RatesForm
          labour={rates?.labourPaisePerHour ? paiseToRupees(rates.labourPaisePerHour) : ''}
          kitchen={rates?.kitchenPaisePerHour ? paiseToRupees(rates.kitchenPaisePerHour) : ''}
        />

        <h2 className="section-title">How it reaches a recipe</h2>
        <p className="prose-note">
          Each recipe records how long one batch takes. That time, at these rates, is added
          to the batch alongside the ingredients — so a sub-recipe carries its own labour
          upward: a roll using 2160 g of a 4200 g dough batch carries just over half of the
          time that dough took, without anyone entering it twice.
        </p>
        <p className="prose-note">
          A recipe with no batch time is costed on ingredients alone and says so on its
          breakdown. Nothing is ever silently charged at zero.
        </p>
      </main>
    </>
  );
}
