import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startOfDayIST, IST_OFFSET_MS, istDayStart, istDayAfter } from './time.ts';

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

test('a typed day becomes the Kolkata midnight before it, in UTC', () => {
  // 2026-09-26 00:00 IST is 2026-09-25 18:30 UTC. Five and a half hours is exactly the
  // error that puts an evening delivery on the wrong day.
  assert.equal(istDayStart('2026-09-26')?.toISOString(), '2026-09-25T18:30:00.000Z');
});

test('the upper bound is the next day, not the last millisecond of this one', () => {
  // Half-open on purpose. A Date can only reach .999 while a timestamptz carries
  // microseconds, so an inclusive bound drops a movement written at .9996 - a row
  // silently outside a range the operator believes covers it.
  assert.equal(istDayAfter('2026-09-26')?.toISOString(), '2026-09-26T18:30:00.000Z');
  const span = istDayAfter('2026-09-26')!.getTime() - istDayStart('2026-09-26')!.getTime();
  assert.equal(span, 24 * 60 * 60 * 1000);
});

test('an unparseable or absent date drops the filter instead of guessing', () => {
  for (const bad of ['', '   ', 'yesterday', '26-09-2026', '2026-13-45', undefined, null]) {
    assert.equal(istDayStart(bad as string | undefined), undefined, String(bad));
    assert.equal(istDayAfter(bad as string | undefined), undefined, String(bad));
  }
});
