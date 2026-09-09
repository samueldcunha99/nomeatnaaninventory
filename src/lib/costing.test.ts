/**
 * The paper cases for the costing engine, P1-P19, written before the implementation and
 * verified independently of it.
 *
 * IF THE IMPLEMENTATION DISAGREES WITH A NUMBER HERE, THE IMPLEMENTATION IS WRONG.
 * These values were derived from the rules, not read off a run. Do not adjust one to make
 * a test pass - that is how an arithmetic bug becomes the specification. The same rule the
 * WAC cases T1-T12 have carried since Month 1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recipeRateMillipaisePerBase,
  costCatalogue,
  portionCostPaise,
  menuItemMargin,
  assertLineUnitCompatible,
  assertAcyclicWithinDepth,
  MissingCostError,
  RecipeCycleError,
  RecipeDepthError,
  UnitMismatchError,
  MAX_RECIPE_DEPTH,
  explainRecipe,
  batchOverheadPaise,
  type Recipe,
  type CostLookup,
  type OverheadRates,
} from './costing.ts';

/* --------------------------------------------------------------------------
 * Fixtures. Rates are millipaise per base unit, as stored on ingredient_stock.
 * Quantities are written in base units for readability and multiplied up, so a
 * reader can check a line against the paper case without counting zeroes.
 * ------------------------------------------------------------------------ */

const RATE = {
  maida: 4500n,
  butter: 50000n,
  castor: 5800n,
  milk: 6000n,
  salt: 2200n,
  cinnamon: 88000n,
  brown: 9500n,
} as const;

/** Base units -> milli_base. `g(2224.8)` is 2224800, exactly. */
const g = (base: number): bigint => BigInt(Math.round(base * 1000));

const lookup: CostLookup = (id) => {
  const rate = (RATE as Record<string, bigint>)[id];
  if (rate === undefined) throw new MissingCostError([{ ingredientId: id, name: id }]);
  return rate;
};

/**
 * Ingredients that exist but have never been purchased. They are ingredients, not
 * recipes — without this the builder would take an uncosted name for a sub-recipe id.
 */
const UNCOSTED = new Set(['cardamom', 'vanilla']);
const isIngredient = (source: string) => source in RATE || UNCOSTED.has(source);

type LineSpec = [source: string, qtyBase: number, wastage?: bigint];

/** Terse recipe builder: `r('dough', 4200, 'weight', [['maida', 2500], ...])`. */
function r(id: string, yieldBase: number, unit: Recipe['yieldUnitType'], lines: LineSpec[]): Recipe {
  return {
    id,
    name: id,
    yieldUnitType: unit,
    yieldQtyMilliBase: g(yieldBase),
    lines: lines.map(([source, qtyBase, wastageMillipercent = 0n]) => ({
      ingredientId: isIngredient(source) ? source : null,
      subRecipeId: isIngredient(source) ? null : source,
      quantityMilliBase: g(qtyBase),
      wastageMillipercent,
    })),
  };
}

const graph = (...recipes: Recipe[]) => new Map(recipes.map((x) => [x.id, x]));

/** The dough of P3, reused by P7, P8, P9, P14 and P15. */
const DOUGH = r('dough', 4200, 'weight', [
  ['maida', 2500],
  ['butter', 800],
  ['castor', 400],
  ['milk', 600],
  ['salt', 20],
]);

const rate = (id: string, gr: Map<string, Recipe>, l: CostLookup = lookup) =>
  recipeRateMillipaisePerBase(id, gr, l);

/* --------------------------------------------------------------------------
 * P1-P6 - one recipe, no nesting
 * ------------------------------------------------------------------------ */

test('P1 single ingredient, no wastage', () => {
  const gr = graph(r('plain', 1000, 'weight', [['maida', 1000]]));
  assert.equal(rate('plain', gr), 4500n);
});

test('P2 several ingredients, exact division', () => {
  const gr = graph(
    r('mix', 2000, 'weight', [
      ['maida', 1000],
      ['butter', 500],
      ['castor', 500],
    ]),
  );
  assert.equal(rate('mix', gr), 16200n);
});

test('P3 non-terminating quotient rounds half-up to 13622', () => {
  // Batch 57,214,000 millipaise / 4200 g = 13622.380952...
  assert.equal(rate('dough', graph(DOUGH)), 13622n);
});

test('P4 an exact .5 tie goes half-UP, not half-even', () => {
  // 50,036,000 / 8000 = 6254.5 exactly. Banker's rounding would give 6254.
  const gr = graph(
    r('tie', 8000, 'weight', [
      ['butter', 1000],
      ['maida', 8],
    ]),
  );
  const got = rate('tie', gr);
  assert.equal(got, 6255n);
  assert.notEqual(got, 6254n, 'half-even would give 6254 - the rounder must be half-up');
});

test('P5 wastage multiplies quantity and is applied exactly once', () => {
  const gr = graph(r('waste', 1000, 'weight', [['maida', 1000, 3000n]]));
  assert.equal(rate('waste', gr), 4635n);
  // 1.03 applied twice would be 4773 (4500 x 1.0609); applied to cost as well as
  // quantity, the same. One application, on quantity only.
  assert.notEqual(rate('waste', gr), 4773n);
});

test('P6 wastage on some lines only', () => {
  const gr = graph(
    r('partial', 2000, 'weight', [
      ['butter', 500],
      ['maida', 1000, 5000n],
      ['salt', 10],
    ]),
  );
  // 29,747,000 / 2000 = 14873.5 -> half-up
  assert.equal(rate('partial', gr), 14874n);
});

/* --------------------------------------------------------------------------
 * P7-P9 - nesting, and the rounded-rate rule
 * ------------------------------------------------------------------------ */

test('P7 a parent consumes the ROUNDED sub-recipe rate', () => {
  const roll = r('roll', 12, 'count', [
    ['dough', 2160],
    ['cinnamon', 60],
    ['brown', 240],
    ['butter', 120],
  ]);
  const got = rate('roll', graph(DOUGH, roll));
  assert.equal(got, 3581960n);
  // This is the assertion that proves the rule. Carrying the exact dough rate
  // (13622.380952...) instead of the stored 13622 gives 3,582,029. If this line
  // ever fails, someone has "fixed" the nested rounding - read AGENTS.md
  // "Nested rounding" before changing anything.
  assert.notEqual(got, 3582029n, 'exact-rational nesting - see AGENTS.md Nested rounding');
});

test('P8 wastage on a sub-recipe line, fractional intermediate not rounded early', () => {
  const roll = r('roll', 12, 'count', [
    ['dough', 2160, 3000n],
    ['cinnamon', 60],
    ['brown', 240],
    ['butter', 120],
  ]);
  // 2224.8 g x 13622 = 30,306,225.6 - a fraction that must survive into the batch
  // total untouched. Batch 43,866,225.6 / 12 = 3,655,518.8 -> 3,655,519.
  assert.equal(rate('roll', graph(DOUGH, roll)), 3655519n);
});

test('P9 two levels of nesting, wastage at both', () => {
  const cream = r('cream', 1000, 'volume', [
    ['milk', 900, 2000n],
    ['castor', 150],
  ]);
  const filled = r('filled', 2000, 'weight', [
    ['dough', 1500, 3000n],
    ['cream', 400],
  ]);
  const gr = graph(DOUGH, cream, filled);
  assert.equal(rate('cream', gr), 6378n);
  // 23,597,190 / 2000 = 11798.595 -> half-up
  assert.equal(rate('filled', gr), 11799n);
});

/* --------------------------------------------------------------------------
 * P10-P11 - the money boundary
 * ------------------------------------------------------------------------ */

test('P10 portion cost, margin and percentages', () => {
  const roll = r('roll', 12, 'count', [
    ['dough', 2160],
    ['cinnamon', 60],
    ['brown', 240],
    ['butter', 120],
  ]);
  const perUnit = rate('roll', graph(DOUGH, roll));
  // One unit. 3,581,960 millipaise = 3581.96 paise -> 3582 whole paise.
  const cost = portionCostPaise(perUnit, g(1));
  assert.equal(cost, 3582n);

  const m = menuItemMargin(cost, 35000n); // sells at Rs 350
  assert.equal(m.costPaise, 3582n);
  assert.equal(m.marginPaise, 31418n);
  assert.equal(m.foodCostPercent.toFixed(1), '10.2');
  assert.equal(m.marginPercent.toFixed(1), '89.8');
});

test('P11 a partial portion of a batch', () => {
  assert.equal(portionCostPaise(4000n, g(250)), 1000n);
});

/* --------------------------------------------------------------------------
 * P12-P13 - missing cost data is an error, never zero
 * ------------------------------------------------------------------------ */

test('P12 no purchase history throws and names the ingredient; a zero-cost purchase does not', () => {
  const gr = graph(r('mystery', 1000, 'weight', [['cardamom', 10]]));
  assert.throws(
    () => rate('mystery', gr),
    (e: unknown) => e instanceof MissingCostError && /cardamom/.test(e.message),
  );

  // A free sample or a write-off HAS a cost basis, and that basis is zero. Zero is a
  // fact here, not the absence of one, and it must cost through as 0.
  const freebie: CostLookup = (id) => (id === 'cardamom' ? 0n : lookup(id));
  assert.equal(rate('mystery', gr, freebie), 0n);
});

test('P13 the throw propagates from three levels down, naming the ingredient and the path', () => {
  const bottom = r('bottom', 1000, 'weight', [['vanilla', 10]]);
  const middle = r('middle', 1000, 'weight', [['bottom', 500]]);
  const top = r('top', 1000, 'weight', [['middle', 500]]);
  assert.throws(
    () => rate('top', graph(bottom, middle, top)),
    (e: unknown) => {
      assert.ok(e instanceof MissingCostError);
      assert.match(e.message, /vanilla/);
      // "Something costs nothing" is useless to an operator; the path is what lets
      // them go and fix it.
      assert.match(e.message, /top.*middle.*bottom/);
      return true;
    },
  );
});

test('P13b every uncosted ingredient is named, not just the first one found', () => {
  const gr = graph(
    r('several', 1000, 'weight', [
      ['cardamom', 10],
      ['maida', 100],
      ['vanilla', 5],
    ]),
  );
  assert.throws(
    () => rate('several', gr),
    (e: unknown) =>
      e instanceof MissingCostError && e.missing.length === 2 && /cardamom.*vanilla/s.test(e.message),
  );
});

/* --------------------------------------------------------------------------
 * P15-P16 - the seam, and re-runnability
 * ------------------------------------------------------------------------ */

test('P15 a what-if override recosts without writing anything', () => {
  const gr = graph(DOUGH);
  const whatIf: CostLookup = (id) => (id === 'butter' ? 60000n : lookup(id));

  assert.equal(rate('dough', gr, whatIf), 15527n); // 65,214,000 / 4200 = 15527.142857...
  // Nothing was written: the same graph and the real lookup still give the real answer.
  assert.equal(rate('dough', gr), 13622n);
});

test('P16 costing is deterministic, and the catalogue agrees with the individuals', () => {
  const roll = r('roll', 12, 'count', [
    ['dough', 2160],
    ['cinnamon', 60],
    ['brown', 240],
    ['butter', 120],
  ]);
  const cream = r('cream', 1000, 'volume', [
    ['milk', 900, 2000n],
    ['castor', 150],
  ]);
  const gr = graph(DOUGH, roll, cream);

  assert.equal(rate('roll', gr), rate('roll', gr));

  const all = costCatalogue(gr, lookup);
  for (const id of gr.keys()) assert.equal(all.get(id), rate(id, gr), `catalogue disagrees on ${id}`);
});

/* --------------------------------------------------------------------------
 * P17-P19 - save-time rejections. Not arithmetic; each is its own failure.
 * ------------------------------------------------------------------------ */

test('P17 a two-recipe cycle is rejected', () => {
  const a = r('a', 1000, 'weight', [['b', 100]]);
  const b = r('b', 1000, 'weight', [['a', 100]]);
  const gr = graph(a, b);
  assert.throws(() => assertAcyclicWithinDepth('a', gr), RecipeCycleError);
  // And costing refuses too rather than recursing forever, even if validation is skipped.
  assert.throws(() => rate('a', gr), RecipeCycleError);
});

test('P18 a longer cycle is rejected, and names the loop', () => {
  const a = r('a', 1000, 'weight', [['b', 100]]);
  const b = r('b', 1000, 'weight', [['c', 100]]);
  const c = r('c', 1000, 'weight', [['a', 100]]);
  assert.throws(
    () => assertAcyclicWithinDepth('a', graph(a, b, c)),
    (e: unknown) => e instanceof RecipeCycleError && /a.*b.*c.*a/s.test(e.message),
  );
});

test('P19a depth beyond the limit is rejected', () => {
  // A chain one level deeper than allowed.
  const chain: Recipe[] = [];
  const depth = MAX_RECIPE_DEPTH + 1;
  for (let i = 0; i <= depth; i++) {
    chain.push(
      i === depth
        ? r(`n${i}`, 1000, 'weight', [['maida', 100]])
        : r(`n${i}`, 1000, 'weight', [[`n${i + 1}`, 100]]),
    );
  }
  const gr = graph(...chain);
  assert.throws(() => assertAcyclicWithinDepth('n0', gr), RecipeDepthError);
  // One level shallower is fine.
  assert.doesNotThrow(() => assertAcyclicWithinDepth('n1', gr));
});

test('P19b a weight-yielding recipe consumed by a line expecting volume is rejected', () => {
  assert.throws(() => assertLineUnitCompatible('volume', 'weight', 'Dough'), UnitMismatchError);
  assert.doesNotThrow(() => assertLineUnitCompatible('weight', 'weight', 'Dough'));
});

/* --------------------------------------------------------------------------
 * The breakdown, and the cache that must not lie
 * ------------------------------------------------------------------------ */

test('P20 the breakdown itemises the same arithmetic, and its column adds up', () => {
  const roll = r('roll', 12, 'count', [
    ['dough', 2160],
    ['cinnamon', 60],
    ['brown', 240],
    ['butter', 120],
  ]);
  const gr = graph(DOUGH, roll);
  const x = explainRecipe('roll', gr, lookup);

  assert.equal(x.rateMillipaisePerBase, rate('roll', gr), 'breakdown and rate must agree');
  assert.equal(x.lines.length, 4);

  // 2160 g of dough at 13622 millipaise/g = 29,423,520 millipaise = 29,423.52 paise.
  const dough = x.lines[0];
  assert.equal(dough.kind, 'sub-recipe');
  assert.equal(dough.rateMillipaisePerBase, 13622n);
  assert.equal(dough.contributionPaise, 29424n);

  // The invariant the screen depends on: the rupee figures on the page add up to the
  // total on the page. Not "close to" - equal.
  assert.equal(
    x.lines.reduce((s, l) => s + l.contributionPaise, 0n),
    x.batchPaise,
  );

  // Sub-recipes carry their own composition for the expandable row, and it adds up too.
  assert.ok(dough.children);
  assert.equal(dough.children!.lines.length, 5);
  assert.equal(dough.children!.batchPaise, 57214n); // P3's batch, in whole paise
});

test('P21 wastage shows as an effective quantity without being rounded into the sum', () => {
  const gr = graph(r('waste', 1000, 'weight', [['maida', 1000, 3000n]]));
  const [only] = explainRecipe('waste', gr, lookup).lines;
  assert.equal(only.quantityMilliBase, g(1000));
  assert.equal(only.effectiveMilliBase, g(1030), '1000 g at 3% is issued as 1030 g');
  assert.equal(only.contributionPaise, 4635n);
});

test('P22 a rate computed over a missing ingredient is never cached', () => {
  // The poisoning case: cost a recipe with an uncosted ingredient, catch the error, then
  // cost its PARENT with the same cache. Without the guard the parent reads a cached rate
  // built on a 0n placeholder, finds nothing missing in its own walk, and returns a
  // confident wrong total instead of throwing.
  const bad = r('bad', 1000, 'weight', [['cardamom', 100]]);
  const parent = r('parent', 1000, 'weight', [['bad', 500]]);
  const gr = graph(bad, parent);
  const cache = new Map<string, bigint>();

  assert.throws(() => recipeRateMillipaisePerBase('bad', gr, lookup, cache), MissingCostError);
  assert.equal(cache.size, 0, 'nothing computed over a missing cost may be cached');
  assert.throws(
    () => recipeRateMillipaisePerBase('parent', gr, lookup, cache),
    (e: unknown) => e instanceof MissingCostError && /cardamom/.test(e.message),
  );
});

/* --------------------------------------------------------------------------
 * P23-P27 — time in the kitchen
 *
 * Rates are paise per hour: labour Rs 80/hr = 8000, kitchen Rs 30/hr = 3000.
 * ------------------------------------------------------------------------ */

const RATES: OverheadRates = { labourPaisePerHour: 8000n, kitchenPaisePerHour: 3000n };

/** The P3 dough, timed: two hours from bowl to proved. */
const TIMED_DOUGH: Recipe = { ...DOUGH, batchMinutes: 120 };

test('P23 an hourly rate becomes a batch cost, rounded once', () => {
  // 120 minutes at Rs 80/hr is exactly Rs 160, and at Rs 30/hr exactly Rs 60.
  const twoHours = batchOverheadPaise(120, RATES);
  assert.equal(twoHours.labourPaise, 16_000n);
  assert.equal(twoHours.kitchenPaise, 6_000n);
  assert.equal(twoHours.applied, true);

  // 10 minutes at Rs 80/hr is 1333.33 paise. Half-up, once, at the end of its own chain.
  const tenMinutes = batchOverheadPaise(10, RATES);
  assert.equal(tenMinutes.labourPaise, 1_333n);
  assert.equal(tenMinutes.kitchenPaise, 500n);
});

test('P24 null is not zero: an untimed batch, or no rates, carries no overhead', () => {
  // A recipe nobody has timed. Costing it at zero labour would be a silent discount.
  assert.equal(batchOverheadPaise(null, RATES).applied, false);
  assert.equal(batchOverheadPaise(undefined, RATES).applied, false);
  // Rates the tenant has never set.
  assert.equal(batchOverheadPaise(120, null).applied, false);
  assert.equal(batchOverheadPaise(120, null).labourPaise, 0n);

  // And the rate is the ingredients-only rate in both cases - P3's 13622 exactly.
  assert.equal(rate('dough', graph(DOUGH)), 13_622n);
  assert.equal(
    recipeRateMillipaisePerBase('dough', graph(DOUGH), lookup, new Map(), RATES),
    13_622n,
    'a recipe with no batch time must cost the same with rates as without',
  );
});

test('P25 a timed batch carries its labour into its own rate', () => {
  /*
   * P3's dough is Rs 572.14 of ingredients over 4200 g. Two hours adds Rs 160 of labour
   * and Rs 60 of kitchen, so the batch is Rs 792.14 and the rate is
   *   79214 paise / 4200 g = 18.860476 paise/g -> 18860 millipaise/g, half-up.
   */
  const g2 = graph(TIMED_DOUGH);
  assert.equal(recipeRateMillipaisePerBase('dough', g2, lookup, new Map(), RATES), 18_860n);

  const ex = explainRecipe('dough', g2, lookup, RATES);
  assert.equal(ex.batchPaise, 57_214n, 'the ingredient total must not move');
  assert.equal(ex.overhead.labourPaise, 16_000n);
  assert.equal(ex.overhead.kitchenPaise, 6_000n);
  assert.equal(ex.totalBatchPaise, 79_214n);
  assert.equal(ex.batchMinutes, 120);
});

test('P26 a sub-recipe carries its labour upward, in proportion to what is used', () => {
  /*
   * THE POINT OF DOING THIS INSIDE THE RATE. The roll uses 2160 g of a 4200 g dough
   * batch, which is 51.428...% of it, so it must carry that share of the dough's Rs 220
   * of time: Rs 113.14. Anything that added overhead after the division would strand the
   * dough's two hours at the bottom of the tree and cost the roll as though the dough
   * made itself.
   */
  const ROLL: Recipe = {
    ...r('roll', 12, 'count', [
      ['dough', 2160],
      ['cinnamon', 60],
      ['brown', 240],
      ['butter', 120],
    ]),
    batchMinutes: 30,
  };
  const g2 = graph(TIMED_DOUGH, ROLL);

  const withTime = explainRecipe('roll', g2, lookup, RATES);
  const doughLine = withTime.lines.find((l) => l.sourceId === 'dough')!;
  assert.equal(doughLine.contributionPaise, 40_738n);

  const withoutTime = explainRecipe('roll', graph(DOUGH, { ...ROLL, batchMinutes: null }), lookup);
  const plainLine = withoutTime.lines.find((l) => l.sourceId === 'dough')!;
  assert.equal(plainLine.contributionPaise, 29_424n);

  // 2160/4200 of Rs 220 is Rs 113.14, to the paise.
  assert.equal(doughLine.contributionPaise - plainLine.contributionPaise, 11_314n);

  // The roll's own half hour: Rs 40 of labour, Rs 15 of kitchen.
  assert.equal(withTime.overhead.labourPaise, 4_000n);
  assert.equal(withTime.overhead.kitchenPaise, 1_500n);
  assert.equal(withTime.batchPaise, 54_298n);
  assert.equal(withTime.totalBatchPaise, 59_798n);
});

test('P27 the total is what a portion is measured against', () => {
  const ROLL: Recipe = {
    ...r('roll', 12, 'count', [
      ['dough', 2160],
      ['cinnamon', 60],
      ['brown', 240],
      ['butter', 120],
    ]),
    batchMinutes: 30,
  };
  const g2 = graph(TIMED_DOUGH, ROLL);
  const rateWithTime = recipeRateMillipaisePerBase('roll', g2, lookup, new Map(), RATES);

  // One roll of a batch of twelve: 4983133 millipaise per unit x 1 unit -> Rs 49.83.
  const perRoll = portionCostPaise(rateWithTime, g(1));
  assert.equal(perRoll, 4_983n);

  // Sold at Rs 350, the margin is what is left after the flour AND the baker.
  const m = menuItemMargin(perRoll, 35_000n);
  assert.equal(m.marginPaise, 30_017n);

  /*
   * Against Rs 35.82 when only the ingredients are counted - P7's 3581960 millipaise per
   * roll, to the paise. The difference, Rs 14.01, is the baker and the oven, and it is
   * 28% of what the roll actually costs. Costing without it is not a rounding error.
   */
  const ingredientsOnly = portionCostPaise(
    recipeRateMillipaisePerBase('roll', graph(DOUGH, { ...ROLL, batchMinutes: null }), lookup),
    g(1),
  );
  assert.equal(ingredientsOnly, 3_582n);
  assert.equal(perRoll - ingredientsOnly, 1_401n);
});
