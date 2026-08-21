import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startOfDayIST, IST_OFFSET_MS } from './time.ts';

/** What Kolkata calls the wall clock at a given UTC instant. */
function istWallClock(d: Date): string {
  return d.toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
}

test('the day starts at 18:30 UTC the previous evening', () => {
  // 22 August 2026, 09:00 IST is 03:30 UTC. The Kolkata day began at 21 Aug 18:30 UTC.
  const start = startOfDayIST(new Date('2026-08-22T03:30:00Z'));
  assert.equal(start.toISOString(), '2026-08-21T18:30:00.000Z');
});

test('an evening in Kolkata still belongs to that Kolkata day', () => {
  // 23:59 IST is already tomorrow in UTC. Cutting the day in UTC would file the whole
  // evening under the next day - which is how a delivery lands on the wrong date.
  const lateEvening = new Date('2026-08-22T18:29:00Z'); // 23:59 IST on the 22nd
  assert.equal(startOfDayIST(lateEvening).toISOString(), '2026-08-21T18:30:00.000Z');

  const justAfterMidnight = new Date('2026-08-22T18:31:00Z'); // 00:01 IST on the 23rd
  assert.equal(startOfDayIST(justAfterMidnight).toISOString(), '2026-08-22T18:30:00.000Z');
});

test('the boundary is midnight in Kolkata, whatever the date', () => {
  for (const iso of ['2026-01-01T00:00:00Z', '2026-06-15T12:00:00Z', '2026-12-31T23:59:00Z']) {
    const start = startOfDayIST(new Date(iso));
    assert.match(istWallClock(start), /00:00:00$/, `${iso} did not land on Kolkata midnight`);
    // Never in the future, and never more than a day back.
    const now = new Date(iso).getTime();
    assert.ok(start.getTime() <= now);
    assert.ok(now - start.getTime() < 24 * 60 * 60 * 1000);
  }
});

test('the offset is the fixed one India actually keeps', () => {
  assert.equal(IST_OFFSET_MS, 19_800_000);
});
