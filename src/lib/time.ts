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
