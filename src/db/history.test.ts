/**
 * Pure test for the receipt-group display ordering. No database: this is list arithmetic,
 * and the bug it guards against is invisible unless a group straddles a page boundary.
 *
 * The defect this was written for: reordering the fetched rows BEFORE slicing to the page
 * permutes across the boundary, so one line of a straddling receipt appears on two pages
 * and another vanishes from the ledger view entirely. On an append-only audit trail, a
 * movement you cannot see is the worst kind of wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderGroupLines } from './history.ts';
import type { MovementRow } from './history.ts';

/** Only the two fields the ordering looks at; the rest is irrelevant to it. */
const row = (seq: number, referenceId: string | null) =>
  ({ seq, referenceId }) as unknown as MovementRow;

test('lines of one receipt read in entry order, newest groups still first', () => {
  // Ledger arrives newest-first: 10, 9, then a 3-line receipt 8/7/6, then 5.
  const fetched = [row(10, null), row(9, null), row(8, 'R'), row(7, 'R'), row(6, 'R'), row(5, null)];

  assert.deepEqual(
    orderGroupLines(fetched).map((r) => r.seq),
    [10, 9, 6, 7, 8, 5],
    'ungrouped rows stay newest-first; the receipt reads in the order it was entered',
  );
});

test('rows without a reference id are left exactly where they are', () => {
  const fetched = [row(4, null), row(3, null), row(2, null)];
  assert.deepEqual(orderGroupLines(fetched).map((r) => r.seq), [4, 3, 2]);
});

test('two adjacent receipts are ordered independently, not merged', () => {
  const fetched = [row(9, 'A'), row(8, 'A'), row(7, 'B'), row(6, 'B')];
  assert.deepEqual(
    orderGroupLines(fetched).map((r) => r.seq),
    [8, 9, 6, 7],
    'each group sorts within itself; the later group still comes first',
  );
});

test('reordering never adds, drops or duplicates a row', () => {
  const fetched = [row(9, 'A'), row(8, 'A'), row(7, null), row(6, 'B'), row(5, 'B'), row(4, 'B')];
  const out = orderGroupLines(fetched);
  assert.equal(out.length, fetched.length);
  assert.deepEqual(
    [...out.map((r) => r.seq)].sort((a, b) => a - b),
    [...fetched.map((r) => r.seq)].sort((a, b) => a - b),
    'same multiset of rows, only the order differs',
  );
});

/**
 * The regression itself. Paginate a ledger where a receipt straddles the page boundary
 * and assert every row appears exactly once across all pages.
 */
test('a receipt straddling a page boundary loses no rows and repeats none', () => {
  const PAGE = 4;
  const ledger = [
    row(10, null),
    row(9, null),
    row(8, null),
    row(7, 'R'), // group R straddles the page-1 boundary
    row(6, 'R'),
    row(5, 'R'),
    row(4, null),
    row(3, null),
  ];

  // Mirrors listMovements: fetch PAGE+1 to detect a next page, then take the page.
  const pageOf = (n: number) => {
    const fetched = ledger.slice((n - 1) * PAGE, (n - 1) * PAGE + PAGE + 1);
    return orderGroupLines(fetched.slice(0, PAGE));
  };

  const seen = [1, 2].flatMap((n) => pageOf(n).map((r) => r.seq));

  assert.deepEqual(
    [...seen].sort((a, b) => b - a),
    ledger.map((r) => r.seq),
    'every movement appears exactly once across the pages',
  );
  assert.equal(new Set(seen).size, seen.length, 'no row appears on two pages');
  assert.deepEqual(pageOf(1).map((r) => r.seq), [10, 9, 8, 7], 'page 1 boundary decided by seq');
});
