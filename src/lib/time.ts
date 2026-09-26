/**
 * The one place a day boundary is computed. Pure - no database, no framework.
 *
 * Timestamps are stored UTC and displayed Asia/Kolkata (AGENTS.md, non-negotiable 7), so
 * "today" is a question about Kolkata that has to be asked of a UTC column. Getting it
 * wrong by five and a half hours puts an evening delivery on the wrong day, which is the
 * kind of error nobody reports because the number still looks plausible.
 */

/**
 * Asia/Kolkata is UTC+5:30 all year. India has never observed daylight saving, so this is
 * a constant rather than something to look up - and writing it as a constant is what lets
 * this file stay pure and dependency-free.
 */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * The UTC instant at which the current Kolkata day began.
 *
 * Shift into IST, cut to midnight, shift back. `from: startOfDayIST()` on a query over a
 * timestamptz column is then exactly "since the cafe opened its day".
 */
export function startOfDayIST(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

/**
 * Today's date in Kolkata, as `YYYY-MM-DD` - the form a `date` column and a date input
 * both use, and one that sorts chronologically as plain text.
 *
 * Shift into IST and read the calendar date; never `toLocaleDateString`, whose format
 * belongs to the machine it runs on.
 */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The display timezone, in one place.
 *
 * It was written out as a string literal in three separate pages, each constructing its
 * own Intl formatter, plus the offset above - four copies of one fact. `tenants.timezone`
 * exists in the schema and is read by NOTHING, which made five. This is the one the code
 * actually uses; the column stays unread until the day a second outlet in another zone
 * makes it mean something, and src/db/schema.ts says so beside it.
 */
export const TIMEZONE = 'Asia/Kolkata';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `YYYY-MM-DD` typed into a filter is a Kolkata calendar day, not a UTC instant.
 * Returns the UTC instant that day began, or undefined for anything unparseable - a
 * filter the operator cannot see is better dropped than silently applied wrong.
 */
export function istDayStart(value: string | undefined | null): Date | undefined {
  if (!value || !YMD.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000+05:30`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // The Date constructor ROLLS OVER a day that does not exist: 2026-02-30 becomes
  // 2 March without complaint. So the day has to survive the round trip back to a date,
  // or it was never a date - and Postgres, which refuses it outright, agrees.
  return istToday(parsed) === value ? parsed : undefined;
}

/**
 * The UTC instant the NEXT Kolkata day begins - an exclusive upper bound.
 *
 * Deliberately not "23:59:59.999". A JavaScript Date carries milliseconds and a Postgres
 * `timestamptz` carries microseconds, so an inclusive bound built from a Date can only
 * ever reach .999 and a movement written at .9996 sits above it. On an append-only
 * ledger, a row that silently falls outside a date range the operator believes covers
 * it is precisely the quiet-wrong-number failure this codebase is built to avoid.
 * Half-open has no such gap at any precision.
 */
export function istDayAfter(value: string | undefined | null): Date | undefined {
  const start = istDayStart(value);
  return start ? new Date(start.getTime() + 24 * 60 * 60 * 1000) : undefined;
}
