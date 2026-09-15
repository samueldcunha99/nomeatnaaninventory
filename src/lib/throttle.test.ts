import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkLoginAllowed,
  recordLoginFailure,
  clearLoginFailures,
  resetThrottleForTests,
  retryAfterMs,
  withinWindow,
  WINDOW_MS,
  MAX_PER_ACCOUNT,
  MAX_PER_SOURCE,
} from './throttle.ts';

beforeEach(resetThrottleForTests);

test('failures older than the window stop counting', () => {
  const now = 1_000_000;
  const times = [now - WINDOW_MS - 1, now - WINDOW_MS, now - 1000, now];
  assert.deepEqual(withinWindow(times, now), [now - 1000, now]);
});

test('the wait runs from the oldest failure still in the window', () => {
  const now = 1_000_000;
  // Exactly at the limit, oldest five minutes ago: ten minutes of the window are left.
  const times = Array.from({ length: MAX_PER_ACCOUNT }, (_, i) => now - 5 * 60_000 + i);
  assert.equal(retryAfterMs(times, now, MAX_PER_ACCOUNT), WINDOW_MS - 5 * 60_000);
  // One short of the limit is not a block at all.
  assert.equal(retryAfterMs(times.slice(1), now, MAX_PER_ACCOUNT), 0);
});

test('an account is blocked after its allowance, and the message is a wait, not a refusal', () => {
  const now = 1_000_000;
  for (let i = 0; i < MAX_PER_ACCOUNT; i++) {
    assert.equal(checkLoginAllowed('owner@cafe.local', '10.0.0.1', now).allowed, true, `attempt ${i}`);
    recordLoginFailure('owner@cafe.local', '10.0.0.1', now);
  }

  const blocked = checkLoginAllowed('owner@cafe.local', '10.0.0.1', now);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.allowed === false && blocked.retryAfterMs > 0);

  // And it lifts on its own once the window has passed.
  assert.equal(checkLoginAllowed('owner@cafe.local', '10.0.0.1', now + WINDOW_MS).allowed, true);
});

test('the account counter is per address, not global', () => {
  const now = 1_000_000;
  for (let i = 0; i < MAX_PER_ACCOUNT; i++) recordLoginFailure('owner@cafe.local', null, now);

  assert.equal(checkLoginAllowed('owner@cafe.local', null, now).allowed, false);
  assert.equal(checkLoginAllowed('chef@cafe.local', null, now).allowed, true);
});

test('email case and padding do not open a second bucket', () => {
  const now = 1_000_000;
  for (let i = 0; i < MAX_PER_ACCOUNT; i++) recordLoginFailure('Owner@Cafe.local', null, now);
  assert.equal(checkLoginAllowed('  owner@cafe.local ', null, now).allowed, false);
});

test('one source cannot work through a list of accounts', () => {
  const now = 1_000_000;
  // A different account every time, so the per-account counter never trips.
  for (let i = 0; i < MAX_PER_SOURCE; i++) recordLoginFailure(`staff${i}@cafe.local`, '203.0.113.9', now);

  assert.equal(checkLoginAllowed('someone-else@cafe.local', '203.0.113.9', now).allowed, false);
  assert.equal(checkLoginAllowed('someone-else@cafe.local', '198.51.100.4', now).allowed, true);
});

test('signing in successfully clears the account, but not the source', () => {
  const now = 1_000_000;
  for (let i = 0; i < MAX_PER_SOURCE; i++) recordLoginFailure(`staff${i}@cafe.local`, '203.0.113.9', now);
  clearLoginFailures('staff0@cafe.local');

  // The account is forgiven; the address that just guessed thirty times is not. One right
  // password at the end of a long run of wrong ones is what stuffing looks like.
  assert.equal(checkLoginAllowed('staff0@cafe.local', null, now).allowed, true);
  assert.equal(checkLoginAllowed('staff0@cafe.local', '203.0.113.9', now).allowed, false);
});

test('a blocked attempt does not extend its own block', () => {
  const now = 1_000_000;
  for (let i = 0; i < MAX_PER_ACCOUNT; i++) recordLoginFailure('owner@cafe.local', null, now);
  const first = checkLoginAllowed('owner@cafe.local', null, now);

  // Hammering while blocked: the action returns before recordLoginFailure is reached, so
  // nothing is added. A minute later the remaining wait is a minute shorter, not longer.
  const later = checkLoginAllowed('owner@cafe.local', null, now + 60_000);
  assert.ok(first.allowed === false && later.allowed === false);
  assert.equal(later.retryAfterMs, first.retryAfterMs - 60_000);
});
