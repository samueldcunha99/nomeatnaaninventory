/**
 * T1-T11 from the hand-computed paper test cases. These numbers are the specification.
 * If the code disagrees, the code is wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMovement, replayLedger, EMPTY_STOCK, type Movement, type StockState } from './stock.ts';
import { unitCostMillipaisePerBase } from './units.ts';

const g = (grams: number) => BigInt(grams) * 1000n; // grams -> milli-base
const state = (qtyGrams: number, avg: number): StockState => ({
  qtyMilliBase: g(qtyGrams),
  weightedAvgCostMillipaisePerBase: BigInt(avg),
});
const buy = (grams: number, price: number): Movement => ({
  movementType: 'purchase',
  quantityMilliBase: g(grams),
  unitCostMillipaisePerBase: BigInt(price),
});
const out = (type: Movement['movementType'], grams: number): Movement => ({
  movementType: type,
  quantityMilliBase: g(grams),
});

function assertStock(actual: StockState, qtyGrams: number, avg: number, label: string) {
  assert.equal(actual.qtyMilliBase, g(qtyGrams), `${label}: qty`);
  assert.equal(actual.weightedAvgCostMillipaisePerBase, BigInt(avg), `${label}: avg`);
}

test('T1 - first purchase into empty stock uses the first-purchase rule', () => {
  // 5 kg butter for Rs 2,500 -> 250000 paise x 1000 / 5000 g
  assert.equal(unitCostMillipaisePerBase(250000n, g(5000)), 50000n);
  assertStock(applyMovement(EMPTY_STOCK, buy(5000, 50000)), 5000, 50000, 'T1');
});

test('T2 - second purchase, exact quotient', () => {
  assert.equal(unitCostMillipaisePerBase(165000n, g(3000)), 55000n); // Rs 1,650 / 3 kg
  // (5000x50000 + 3000x55000) / 8000 = 415,000,000 / 8000
  assertStock(applyMovement(state(5000, 50000), buy(3000, 55000)), 8000, 51875, 'T2');
});

test('T3 - non-terminating quotient rounds half-up once, at the end', () => {
  assert.equal(unitCostMillipaisePerBase(180000n, g(4000)), 45000n); // Rs 1,800 / 4 kg
  // 330,000,000 / 7000 = 47142.857...
  assertStock(applyMovement(state(3000, 50000), buy(4000, 45000)), 7000, 47143, 'T3');
});

test('T4 - an exact .5 tie rounds up, not to even', () => {
  assert.equal(unitCostMillipaisePerBase(45001n, g(1000)), 45001n); // Rs 450.01 / 1 kg
  // 95,001,000 / 2000 = 47500.5 exactly
  const result = applyMovement(state(1000, 50000), buy(1000, 45001));
  assertStock(result, 2000, 47501, 'T4');
  assert.notEqual(result.weightedAvgCostMillipaisePerBase, 47500n, 'banker\'s rounding would give 47500');
});

test('T5 - cheap ingredient precision canary', () => {
  // 25 kg salt for Rs 550 -> 2.2 paise per gram
  const cost = unitCostMillipaisePerBase(55000n, g(25000));
  assert.equal(cost, 2200n);
  assert.notEqual(cost, 2n, 'whole paise per gram would store 2 and lose 9% of the cost');
  assertStock(applyMovement(EMPTY_STOCK, buy(25000, 2200)), 25000, 2200, 'T5');
});

test('T6 - purchase at exactly zero stock ignores the stale average', () => {
  const emptied = applyMovement(state(8000, 51875), out('consumption', -8000));
  assertStock(emptied, 0, 51875, 'T6 after consumption');
  assertStock(applyMovement(emptied, buy(2000, 60000)), 2000, 60000, 'T6');
});

test('T7 - purchase at negative stock must not weight in the deficit', () => {
  const result = applyMovement(state(-500, 51875), buy(2000, 60000));
  assertStock(result, 1500, 60000, 'T7');
  // The naive formula: 94,062,500 / 1500 = 62708.33 - an average above every price paid.
  assert.notEqual(result.weightedAvgCostMillipaisePerBase, 62708n);
});

test('T8 - wastage between purchases does not move the average', () => {
  const afterWastage = applyMovement(state(5000, 50000), out('wastage', -200));
  assertStock(afterWastage, 4800, 50000, 'T8 after wastage');
  // 295,000,000 / 5800 = 50862.068...
  assertStock(applyMovement(afterWastage, buy(1000, 55000)), 5800, 50862, 'T8');
});

test('T9 - adjustment does not move the average', () => {
  assertStock(applyMovement(state(5800, 50862), out('adjustment', -150)), 5650, 50862, 'T9');
});

test('T10 - consumption and its reversal both leave the average alone', () => {
  const consumed = applyMovement(state(5650, 50862), out('consumption', -400));
  assertStock(consumed, 5250, 50862, 'T10 after consumption');
  assertStock(applyMovement(consumed, out('reversal', 400)), 5650, 50862, 'T10');
});

test('T11 - ledger replay equals the incrementally maintained state', () => {
  // T1-T10 do not chain (each states its own opening position), so this is the
  // invariant they are really testing: one ledger, both routes, same answer.
  const ledger: Movement[] = [
    buy(5000, 50000), // T1
    buy(3000, 55000), // T2 -> 8000 @ 51875
    out('wastage', -200), // -> 7800 @ 51875
    out('adjustment', -150), // -> 7650 @ 51875
    out('consumption', -400), // -> 7250 @ 51875
    out('reversal', 400), // -> 7650 @ 51875
    out('consumption', -9000), // -> -1350 @ 51875, oversold
    buy(2000, 60000), // old_qty < 0 -> avg is the incoming price
  ];

  // Hand-computed final position for this ledger.
  const replayed = replayLedger(ledger);
  assertStock(replayed, 650, 60000, 'T11 replay');

  // And the incremental route, applying one movement at a time as the cache does.
  let incremental = EMPTY_STOCK;
  for (const m of ledger) incremental = applyMovement(incremental, m);
  assert.deepEqual(replayed, incremental, 'T11: replay and incremental must agree exactly');
});

test('purchases must carry a cost, other movement types must not', () => {
  assert.throws(() => applyMovement(EMPTY_STOCK, { movementType: 'purchase', quantityMilliBase: g(1) }));
  assert.throws(() =>
    applyMovement(EMPTY_STOCK, {
      movementType: 'consumption',
      quantityMilliBase: g(-1),
      unitCostMillipaisePerBase: 5n,
    }),
  );
});
