/**
 * M1-M9: production runs, hand-computed BEFORE src/lib/production.ts existed. These
 * numbers are the specification; if the code disagrees, the code is wrong.
 *
 * The fixture is one dough and one roll, priced like the café's real sheet:
 *
 *   flour   Rs 42/kg   ->  4200 millipaise/g        salt   Rs 22/kg  ->  2200
 *   butter  Rs 500/kg  -> 50000                     yeast  Rs 800/kg -> 80000
 *   sugar   Rs 45/kg   ->  4500
 *
 *   Dough (stocked, yields 4.2 kg):  flour 2500 g, butter 500 g @ 3% wastage,
 *                                    sugar 300 g, salt 40 g, yeast 15 g @ 2.5%
 *   Rolls (made to order, 12):       dough 2160 g, sugar 200 g @ 5%, butter 100 g
 *
 * Money: an issued quantity (milli-base) times a rate (millipaise per base unit) is in
 * millionths of a paise, so a batch is summed exactly and divided by 1,000,000 ONCE.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  issuedMilliBase,
  planDraws,
  planProductionRun,
  NotStockedError,
  UncostedStockError,
} from './production.ts';
import { MissingCostError, MissingSubRecipeError, type CostLookup, type Recipe } from './costing.ts';

const RATES: Record<string, bigint> = {
  flour: 4200n,
  butter: 50000n,
  sugar: 4500n,
  salt: 2200n,
  yeast: 80000n,
};

/** Behaves as loadCostLookup does: a rate, or a MissingCostError naming the ingredient. */
function lookupFrom(rates: Record<string, bigint>): CostLookup {
  return (id) => {
    const rate = rates[id];
    if (rate === undefined) throw new MissingCostError([{ ingredientId: id, name: id }]);
    return rate;
  };
}

const ing = (id: string, q: bigint, w = 0n) => ({
  ingredientId: id,
  subRecipeId: null,
  quantityMilliBase: q,
  wastageMillipercent: w,
});
const sub = (id: string, q: bigint, w = 0n) => ({
  ingredientId: null,
  subRecipeId: id,
  quantityMilliBase: q,
  wastageMillipercent: w,
});

function fixture(opts: { doughStocked?: boolean } = {}): Map<string, Recipe> {
  const dough: Recipe = {
    id: 'dough',
    name: 'Dough',
    yieldUnitType: 'weight',
    yieldQtyMilliBase: 4_200_000n,
    stockIngredientId: opts.doughStocked === false ? null : 'dough-stock',
    lines: [
      ing('flour', 2_500_000n),
      ing('butter', 500_000n, 3000n),
      ing('sugar', 300_000n),
      ing('salt', 40_000n),
      ing('yeast', 15_000n, 2500n),
    ],
  };
  const rolls: Recipe = {
    id: 'rolls',
    name: 'Rolls',
    yieldUnitType: 'count',
    yieldQtyMilliBase: 12_000n,
    stockIngredientId: null,
    lines: [sub('dough', 2_160_000n), ing('sugar', 200_000n, 5000n), ing('butter', 100_000n)],
  };
  return new Map([
    ['dough', dough],
    ['rolls', rolls],
  ]);
}

test('M1 - one batch of dough: what it drew, what it cost, what went on the shelf', () => {
  const plan = planProductionRun('dough', fixture(), lookupFrom(RATES), 1000n, 4_100_000n);

  // issued = q x (100000 + w) / 100000 for one batch
  assert.deepEqual(
    plan.draws.map((d) => [d.ingredientId, d.issuedMilliBase]),
    [
      ['flour', 2_500_000n],
      ['butter', 515_000n], //   500 g x 1.03
      ['sugar', 300_000n],
      ['salt', 40_000n],
      ['yeast', 15_375n], //      15 g x 1.025
    ],
  );

  // 2500 x 4.2 + 515 x 50 + 300 x 4.5 + 40 x 2.2 + 15.375 x 80 paise
  //   = 10500 + 25750 + 1350 + 88 + 1230 = 38918 paise, exactly
  assert.equal(plan.batchCostPaise, 38_918n);
  assert.equal(plan.expectedYieldMilliBase, 4_200_000n);

  // The bowl gave 4.1 kg, not 4.2. The dough on the shelf carries the WHOLE cost of the
  // batch over what actually came out - 38,918,000,000 / 4,100,000 = 9492.195 -> 9492 -
  // through the same helper a delivery's unit cost goes through.
  assert.deepEqual(plan.output, {
    ingredientId: 'dough-stock',
    qtyMilliBase: 4_100_000n,
    unitCostMillipaisePerBase: 9_492n,
    totalCostPaise: 38_918n,
  });
  assert.deepEqual(plan.missing, []);
});

test('M2 - one and a half batches: a half rounds the MAGNITUDE up, and the sign comes after', () => {
  const plan = planProductionRun('dough', fixture(), lookupFrom(RATES), 1500n, 6_200_000n);

  // yeast: 15,000 x 1500 x 102,500 / 100,000,000 = 23,062.5 -> 23,063.
  //
  // This is the sign-safe quantity rounder AGENTS.md deferred to "when Month 3 writes
  // consumption movements". What gets rounded is the POSITIVE amount issued, with the
  // one rounding function this codebase has; the ledger gets its exact negative. The
  // alternative - rounding the signed -23,062.5 - has no single answer: JavaScript's
  // Math.round gives -23062 and Postgres round() gives -23063. A consumption and its
  // reversal then fail to cancel, depending on which one somebody happened to call.
  const yeast = plan.draws.find((d) => d.ingredientId === 'yeast')!;
  assert.equal(yeast.issuedMilliBase, 23_063n);

  assert.deepEqual(
    plan.draws.map((d) => d.issuedMilliBase),
    [3_750_000n, 772_500n, 450_000n, 60_000n, 23_063n],
  );

  // 15,750,000,000 + 38,625,000,000 + 2,025,000,000 + 132,000,000 + 1,845,040,000
  //   = 58,377,040,000 -> 58,377.04 paise -> 58,377. Rounded once, for the batch.
  // Note it prices the ROUNDED yeast: the cost is of what the ledger says left the store.
  assert.equal(plan.batchCostPaise, 58_377n);
  assert.equal(plan.expectedYieldMilliBase, 6_300_000n);
  // 58,377,000,000 / 6,200,000 = 9415.645 -> 9416
  assert.equal(plan.output?.unitCostMillipaisePerBase, 9_416n);
});

test('M3 - rolls draw on the dough in the fridge, not on flour', () => {
  // The dough's rate is whatever its batches ACTUALLY cost - here M1's 9492 - read from
  // its stock row like any other ingredient.
  const lookup = lookupFrom({ ...RATES, 'dough-stock': 9_492n });
  const plan = planProductionRun('rolls', fixture(), lookup, 1000n, 11_000n);

  assert.deepEqual(
    plan.draws.map((d) => [d.ingredientId, d.issuedMilliBase, d.source.kind]),
    [
      ['dough-stock', 2_160_000n, 'sub-recipe'], // leaves the store, never re-expanded
      ['sugar', 210_000n, 'ingredient'], //         200 g x 1.05
      ['butter', 100_000n, 'ingredient'],
    ],
  );
  assert.ok(!plan.draws.some((d) => d.ingredientId === 'flour'), 'flour was paid for when the dough was made');

  // 2160 x 9.492 + 210 x 4.5 + 100 x 50 = 20502.72 + 945 + 5000 = 26447.72 -> 26448
  assert.equal(plan.batchCostPaise, 26_448n);
  assert.equal(plan.expectedYieldMilliBase, 12_000n);
  // Made to order: a run records what came out, and puts nothing on a shelf.
  assert.equal(plan.output, null);
});

test('M4 - a burnt batch puts nothing on the shelf, and still costs what it used', () => {
  // Zero is a real yield. There is no quantity to value and nothing to divide by, so
  // there is no production movement at all - the ledger refuses a zero-quantity row -
  // but every input really was used, and the run carries the whole loss.
  const plan = planProductionRun('dough', fixture(), lookupFrom(RATES), 1000n, 0n);
  assert.equal(plan.output, null);
  assert.equal(plan.batchCostPaise, 38_918n);
  assert.equal(plan.draws.length, 5);
});

test('M5 - a made-to-order batch with an unpriced input records, costed at nothing KNOWN', () => {
  // The event is real even when its value is not. The stock still moves; the cost is
  // null, never a zero, and the missing input is named so somebody can fix it.
  const { butter: _unpriced, ...rest } = RATES;
  const lookup = lookupFrom({ ...rest, 'dough-stock': 9_492n });
  const plan = planProductionRun('rolls', fixture(), lookup, 1000n, 12_000n);

  assert.equal(plan.batchCostPaise, null);
  assert.deepEqual(plan.missing.map((m) => m.ingredientId), ['butter']);
  assert.equal(plan.draws.length, 3, 'the quantities still leave the store');
});

test('M6 - a stocked batch with unpriced inputs is refused, naming every one', () => {
  // Stock carries a value - the ledger refuses a valued inflow without one - and there
  // is no honest value for dough made partly from things nobody has priced. So this is
  // the one run that cannot be recorded until they are. The message names them all at
  // once, so the fix is one trip, not one per attempt.
  const { salt: _s, yeast: _y, ...rest } = RATES;
  assert.throws(
    () => planProductionRun('dough', fixture(), lookupFrom(rest), 1000n, 4_100_000n),
    (e: Error) => {
      assert.ok(e instanceof UncostedStockError, `got ${e.name}`);
      assert.deepEqual(e.missing.map((m) => m.ingredientId), ['salt', 'yeast']);
      assert.match(e.message, /Dough/);
      return true;
    },
  );
});

test('M7 - drawing on a sub-recipe that is not held in stock is refused by name', () => {
  // Nothing to draw on. Consuming nothing would understate every input; expanding it
  // into flour would double-count the day it IS logged. So: refuse, and say which.
  assert.throws(
    () => planDraws('rolls', fixture({ doughStocked: false }), 1000n),
    (e: Error) => e instanceof NotStockedError && /Dough/.test(e.message),
  );
});

test('M8 - logging an unstocked recipe that other recipes draw on is refused', () => {
  // The other half of M7. Logging it would take the flour out of the store and put the
  // dough nowhere, so the rolls made from it could never be logged either.
  assert.throws(
    () => planDraws('dough', fixture({ doughStocked: false }), 1000n),
    (e: Error) => e instanceof NotStockedError && /Rolls/.test(e.message),
  );
});

test('M9 - an issued quantity rounds ONCE, not once per factor', () => {
  // 333 x 1.5 batches x 1.025 = 511.9875 -> 512.
  // Rounding after the batches first would give 499.5 -> 500, then 500 x 1.025 = 512.5
  // -> 513: a milligram conjured out of the order the factors were applied in.
  assert.equal(issuedMilliBase(333n, 2500n, 1500n), 512n);
});

test('a fractional expected yield rounds half-up, once', () => {
  // 1234.567 g a batch x 0.5 batches = 617.2835 g -> 617_283.5 milli -> 617_284
  const graph = new Map<string, Recipe>([
    ['odd', { id: 'odd', name: 'Odd', yieldUnitType: 'weight', yieldQtyMilliBase: 1_234_567n, lines: [ing('flour', 1_000n)] }],
  ]);
  assert.equal(planDraws('odd', graph, 500n).expectedYieldMilliBase, 617_284n);
});

test('a run is refused before it can write anything nonsensical', () => {
  const graph = fixture();
  assert.throws(() => planDraws('dough', graph, 0n), RangeError, 'no batches');
  assert.throws(() => planDraws('dough', graph, -1000n), RangeError, 'negative batches');
  assert.throws(
    () => planProductionRun('dough', graph, lookupFrom(RATES), 1000n, -1n),
    RangeError,
    'negative yield',
  );

  // A recipe with no lines would put dough on the shelf at a cost of nothing - a zero
  // conjured from the absence of data, the failure this codebase exists to prevent.
  const empty = new Map<string, Recipe>([
    ['air', { id: 'air', name: 'Air', yieldUnitType: 'weight', yieldQtyMilliBase: 1_000n, stockIngredientId: 'air-stock', lines: [] }],
  ]);
  assert.throws(() => planDraws('air', empty, 1000n), RangeError);

  // So small a batch that the expected yield rounds to nothing.
  const tiny = new Map<string, Recipe>([
    ['tiny', { id: 'tiny', name: 'Tiny', yieldUnitType: 'weight', yieldQtyMilliBase: 1n, lines: [ing('salt', 1n)] }],
  ]);
  assert.throws(() => planDraws('tiny', tiny, 1n), RangeError);
});

test('a line pointing at a deleted sub-recipe is refused by name, not skipped', () => {
  // Skipping it would under-draw and under-cost the batch. Same reasoning, and the same
  // error, as costing: src/lib/costing.ts, MissingSubRecipeError.
  const graph = fixture();
  graph.delete('dough');
  assert.throws(() => planDraws('rolls', graph, 1000n), MissingSubRecipeError);
});

test('M4b - a burnt STOCKED batch with an unpriced input still records', () => {
  // M6 refuses a stocked batch with unpriced inputs because the shelf needs a value.
  // A burnt one puts nothing on the shelf, so it needs no value, and refusing it would
  // stop the kitchen recording the loss it most needs to record. Only the ORDER of two
  // checks in planProductionRun makes this true - so it is pinned, not assumed.
  const { yeast: _y, ...rest } = RATES;
  const plan = planProductionRun('dough', fixture(), lookupFrom(rest), 1000n, 0n);
  assert.equal(plan.output, null);
  assert.equal(plan.batchCostPaise, null);
  assert.deepEqual(plan.missing.map((m) => m.ingredientId), ['yeast']);
});

test('M10 - a batch is costed on what the LEDGER says left the store, not the exact fraction', () => {
  // Contrived so the two readings differ by a whole paise; with real quantities they
  // differ by well under one, which is why M2 cannot tell them apart.
  //
  // Half a batch of 0.001 g issues 0.0005 g, which rounds to 1 milli-gram. At Rs 9000/kg
  // (900,000 millipaise/g), the store loses 1 x 900,000 / 1e6 = 0.9 paise -> 1 paise.
  // Pricing the exact 0.5 instead gives 0.45 paise -> 0: a batch whose recorded cost
  // disagrees with the movement it wrote, and a stocked item valued below its own draws.
  const graph = new Map<string, Recipe>([
    ['v', { id: 'v', name: 'Vanilla paste', yieldUnitType: 'weight', yieldQtyMilliBase: 10_000n, lines: [ing('vanilla', 1n)] }],
  ]);
  const plan = planProductionRun('v', graph, lookupFrom({ vanilla: 900_000n }), 500n, 5_000n);
  assert.equal(plan.draws[0].issuedMilliBase, 1n);
  assert.equal(plan.batchCostPaise, 1n);
});
