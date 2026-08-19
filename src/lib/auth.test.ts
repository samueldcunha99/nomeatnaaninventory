import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSessionToken,
  hashToken,
  tokenHashesMatch,
  sessionExpiry,
  isExpired,
  hasPermission,
  assertPermission,
  assertNotSelf,
  assertCanAssignRole,
  AuthzError,
  ROLES,
  type Actor,
} from './auth.ts';

const actor = (role: Actor['role'], id = 'actor-1'): Actor => ({ id, tenantId: 'tenant-1', role });

test('session tokens are long and never repeat', () => {
  const tokens = new Set(Array.from({ length: 200 }, generateSessionToken));
  assert.equal(tokens.size, 200);
  assert.ok(generateSessionToken().length >= 43, '256 bits of entropy, base64url encoded');
});

test('a tampered token cannot hash to the stored value', () => {
  const token = generateSessionToken();
  const stored = hashToken(token);

  assert.equal(hashToken(token), stored, 'hashing is deterministic');
  assert.equal(stored.length, 64, 'sha256, hex');
  assert.notEqual(stored, token, 'the raw token is never what gets stored');

  for (const tampered of [token + 'x', token.slice(0, -1), 'A' + token.slice(1), token.toUpperCase()]) {
    assert.notEqual(hashToken(tampered), stored, `tampered token "${tampered.slice(0, 8)}..." must not match`);
  }
});

test('token hash comparison is length-safe', () => {
  const a = hashToken('one');
  assert.ok(tokenHashesMatch(a, hashToken('one')));
  assert.ok(!tokenHashesMatch(a, hashToken('two')));
  assert.ok(!tokenHashesMatch(a, 'short'), 'mismatched lengths must not throw');
});

test('expiry is enforced on the boundary, not after it', () => {
  const now = new Date('2026-08-19T10:00:00Z');
  assert.ok(!isExpired(new Date('2026-08-19T10:00:01Z'), now));
  assert.ok(isExpired(new Date('2026-08-19T09:59:59Z'), now));
  assert.ok(isExpired(now, now), 'expiring exactly now counts as expired');
  assert.ok(sessionExpiry(now) > now);
});

test('a counter user is blocked from user management', () => {
  assert.ok(hasPermission('owner', 'users.manage'));
  assert.ok(hasPermission('manager', 'users.manage'));
  assert.ok(!hasPermission('counter', 'users.manage'));
  assert.ok(!hasPermission('kitchen', 'users.manage'));

  assert.throws(() => assertPermission('counter', 'users.manage'), AuthzError);
  assert.throws(() => assertPermission('kitchen', 'users.manage'), AuthzError);
  assert.doesNotThrow(() => assertPermission('owner', 'users.manage'));
});

test('a user cannot deactivate themselves or change their own role', () => {
  const owner = actor('owner', 'u1');
  assert.throws(() => assertNotSelf(owner, 'u1', 'deactivate'), AuthzError);
  assert.throws(() => assertNotSelf(owner, 'u1', 'change the role of'), AuthzError);
  assert.doesNotThrow(() => assertNotSelf(owner, 'u2', 'deactivate'));
});

test('only an owner may grant the owner role', () => {
  // Otherwise a manager promotes a second account and inherits owner by proxy.
  assert.throws(() => assertCanAssignRole(actor('manager'), 'owner'), AuthzError);
  assert.doesNotThrow(() => assertCanAssignRole(actor('owner'), 'owner'));
  assert.doesNotThrow(() => assertCanAssignRole(actor('manager'), 'counter'));

  for (const role of ROLES) {
    if (role === 'owner' || role === 'manager') continue;
    assert.throws(() => assertCanAssignRole(actor(role), 'counter'), AuthzError, `${role} may not assign roles`);
  }
});
