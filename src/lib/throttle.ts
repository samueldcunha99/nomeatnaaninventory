/**
 * Failed-login throttling.
 *
 * Nothing limited password guessing before this: every attempt ran a full Argon2 verify,
 * so the login form was both a way to guess the owner's password and a way to make the
 * server do expensive work on demand. The generic error message and the dummy hash in
 * src/db/auth.ts stop an attacker learning WHO works here; they do nothing about how many
 * times they may ask.
 *
 * Two counters, because they fail differently:
 *
 *   - by email, so one account cannot be ground down from many addresses;
 *   - by source address, so one address cannot work through a list of accounts.
 *
 * Either one tripping is a refusal. Only FAILURES are recorded - a successful login
 * clears the account's count, so a member of staff who mistypes twice and then gets it
 * right is never held up.
 *
 * ponytail: the counters live in this process's memory, which is right for one app
 * container and wrong for two. They reset on deploy, which is operator-initiated and not
 * something an attacker can provoke. When a second container appears, move `attempts` to
 * a small table keyed the same way - the pure functions below are already the whole
 * decision and would not change.
 */

/** Long enough to make guessing pointless, short enough that a locked-out manager waits once. */
export const WINDOW_MS = 15 * 60_000;
/** Generous for typos, meaningless for a dictionary. */
export const MAX_PER_ACCOUNT = 8;
/** Higher: a whole cafe can share one address, and they all get their typos too. */
export const MAX_PER_SOURCE = 30;

/** Failures still inside the window, newest last. Pure, so it is the part under test. */
export function withinWindow(times: number[], now: number, windowMs = WINDOW_MS): number[] {
  return times.filter((t) => now - t < windowMs);
}

/**
 * Milliseconds until the next attempt is allowed, or 0 when one is allowed now.
 *
 * The wait runs from the OLDEST failure in the window, so the block lifts gradually as
 * attempts age out rather than all at once - and a blocked attacker who keeps hammering
 * never extends their own block, because blocked attempts are not recorded.
 */
export function retryAfterMs(times: number[], now: number, max: number, windowMs = WINDOW_MS): number {
  const recent = withinWindow(times, now, windowMs);
  if (recent.length < max) return 0;
  return Math.max(0, recent[0] + windowMs - now);
}

const attempts = new Map<string, number[]>();

/** Keys are namespaced so an email that looks like an IP cannot share a bucket with one. */
const accountKey = (email: string) => `a:${email.trim().toLowerCase()}`;
const sourceKey = (ip: string) => `s:${ip}`;

/**
 * Whether this attempt may proceed, and for how long it may not.
 *
 * Called BEFORE the password is verified, so a blocked attempt costs no Argon2 work -
 * which is half the point.
 */
export function checkLoginAllowed(
  email: string,
  ip: string | null,
  now = Date.now(),
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const waits = [
    retryAfterMs(attempts.get(accountKey(email)) ?? [], now, MAX_PER_ACCOUNT),
    ip ? retryAfterMs(attempts.get(sourceKey(ip)) ?? [], now, MAX_PER_SOURCE) : 0,
  ];
  const wait = Math.max(...waits);
  return wait > 0 ? { allowed: false, retryAfterMs: wait } : { allowed: true };
}

/** Record one failure against both counters. */
export function recordLoginFailure(email: string, ip: string | null, now = Date.now()): void {
  for (const key of [accountKey(email), ...(ip ? [sourceKey(ip)] : [])]) {
    const kept = withinWindow(attempts.get(key) ?? [], now);
    kept.push(now);
    attempts.set(key, kept);
  }
}

/**
 * Forget an account's failures. The source counter is deliberately NOT cleared: one
 * correct password out of a long run of wrong ones is exactly what a successful
 * credential-stuffing attempt looks like.
 */
export function clearLoginFailures(email: string): void {
  attempts.delete(accountKey(email));
}

/** Test seam. Without it the counters leak between test cases in one process. */
export function resetThrottleForTests(): void {
  attempts.clear();
}
