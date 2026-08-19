/**
 * Measures the ceiling rather than assuming it.
 *
 * recalculateStock() replays an ingredient's ENTIRE ledger on every movement insert.
 * At 150 orders/day, with a consumption movement per ingredient per order, a
 * high-frequency ingredient reaches five figures within a year - and every sale pays
 * for the whole replay. This test fails if that ever stops being cheap.
 *
 * SCOPE: this is the pure fold plus the row mapping the database path performs. It
 * does NOT include fetching 50,000 rows from Postgres, which is the larger cost and
 * needs a live database to measure. Treat the budget here as a floor, not a total.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayLedger, type Movement } from './stock.ts';

const LEDGER_SIZE = 50_000;

// Generous against a measured ~6ms: this guards against an algorithmic regression -
// an accidental O(n^2), a per-movement allocation - not against a slow CI box.
const BUDGET_MS = 150;

/** Shaped like the rows recalculateStock() reads back: numbers and nulls, not BigInt. */
function ledgerRows(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const isPurchase = i % 5 === 0;
    return {
      movementType: (isPurchase ? 'purchase' : 'consumption') as Movement['movementType'],
      quantityMilliBase: isPurchase ? 5_000_000 : -180_000,
      unitCostMillipaisePerBase: isPurchase ? 45_000 + (i % 97) : null,
    };
  });
}

test(`replaying ${LEDGER_SIZE} movements stays under ${BUDGET_MS}ms`, () => {
  const rows = ledgerRows(LEDGER_SIZE);

  const started = performance.now();
  const state = replayLedger(
    rows.map<Movement>((r) => ({
      movementType: r.movementType,
      quantityMilliBase: BigInt(r.quantityMilliBase),
      unitCostMillipaisePerBase:
        r.unitCostMillipaisePerBase == null ? null : BigInt(r.unitCostMillipaisePerBase),
    })),
  );
  const elapsed = performance.now() - started;

  assert.ok(state.weightedAvgCostMillipaisePerBase > 0n, 'sanity: the fold actually ran');
  assert.ok(
    elapsed < BUDGET_MS,
    `replay of ${LEDGER_SIZE} movements took ${elapsed.toFixed(1)}ms, over the ${BUDGET_MS}ms budget. ` +
      `If this is a real regression, fix it. If ledgers have simply grown, snapshotting is the ` +
      `documented upgrade path - see the ponytail comment in src/db/stock.ts.`,
  );
});

test('replay cost grows linearly, not quadratically', () => {
  // The failure this catches is a rewrite that re-scans history per movement. A
  // wall-clock budget alone would not notice until it was already painful.
  const time = (n: number) => {
    const rows = ledgerRows(n).map<Movement>((r) => ({
      movementType: r.movementType,
      quantityMilliBase: BigInt(r.quantityMilliBase),
      unitCostMillipaisePerBase:
        r.unitCostMillipaisePerBase == null ? null : BigInt(r.unitCostMillipaisePerBase),
    }));
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      replayLedger(rows);
      runs.push(performance.now() - t);
    }
    return runs.sort((a, b) => a - b)[2]; // median, to survive a noisy machine
  };

  const small = Math.max(time(10_000), 0.5); // floor: timer noise on a fast machine
  const large = time(80_000);
  assert.ok(
    large / small < 24,
    `8x the movements took ${(large / small).toFixed(1)}x the time - that is not linear`,
  );
});
