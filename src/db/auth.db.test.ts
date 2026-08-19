/**
 * Session lifecycle and user administration against a live Postgres. The pure
 * counterparts live in src/lib/auth.test.ts; these cover the half that only exists
 * once there is a real session row - expiry, revocation, and the guards firing
 * through the actual database functions.
 *
 * Skips loudly without a reachable DATABASE_URL.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { db } from './client.ts';
import { dbReachable, closeDb } from './test-db.ts';
import { tenants, users, sessions } from './schema.ts';
import { login, getSessionUser, destroySession, hashPassword, deleteExpiredSessions } from './auth.ts';
import { deactivateUser, setUserRole, createUser, listUsers } from './users.ts';
import { hashToken, generateSessionToken, AuthzError, type Actor } from '../lib/auth.ts';

let reachable = false;
let tenantId: string;

const PASSWORD = 'correct horse battery staple';

before(async () => {
  reachable = await dbReachable('database auth tests');
  if (!reachable) return;
  const [t] = await db.insert(tenants).values({ name: `auth test ${crypto.randomUUID()}` }).returning();
  tenantId = t.id;
});

after(closeDb);

async function makeUser(role: Actor['role']) {
  const [row] = await db
    .insert(users)
    .values({
      tenantId,
      name: `${role} user`,
      email: `${role}-${crypto.randomUUID()}@example.test`,
      passwordHash: await hashPassword(PASSWORD),
      role,
    })
    .returning();
  return row;
}

const asActor = (u: { id: string; tenantId: string; role: string }): Actor => ({
  id: u.id,
  tenantId: u.tenantId,
  role: u.role as Actor['role'],
});

test('login issues a session, and the raw token is never stored', async (t) => {
  if (!reachable) return t.skip('no database');
  const user = await makeUser('owner');

  assert.equal(await login(user.email, 'wrong password'), null);
  assert.equal(await login(`nobody-${crypto.randomUUID()}@example.test`, PASSWORD), null);

  const result = await login(user.email, PASSWORD);
  assert.ok(result, 'correct credentials must succeed');

  const [stored] = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(result.token)));
  assert.ok(stored, 'the session is found by sha256(token)');
  assert.notEqual(stored.tokenHash, result.token, 'the cookie value itself must not be in the table');

  const resolved = await getSessionUser(result.token);
  assert.equal(resolved?.id, user.id);
  assert.equal(resolved?.role, 'owner');
});

test('a tampered token resolves to nobody', async (t) => {
  if (!reachable) return t.skip('no database');
  const user = await makeUser('counter');
  const { token } = (await login(user.email, PASSWORD))!;

  for (const tampered of [token + 'x', token.slice(0, -1), 'A' + token.slice(1), generateSessionToken()]) {
    assert.equal(await getSessionUser(tampered), null, 'a forged token must not resolve');
  }
  assert.equal(await getSessionUser(undefined), null);
  assert.ok(await getSessionUser(token), 'the genuine token still works');
});

test('an expired session is rejected and deleted', async (t) => {
  if (!reachable) return t.skip('no database');
  const user = await makeUser('manager');
  const token = generateSessionToken();
  const tokenHash = hashToken(token);

  await db.insert(sessions).values({
    tokenHash,
    tenantId,
    userId: user.id,
    expiresAt: new Date(Date.now() - 1000), // expired one second ago
  });

  assert.equal(await getSessionUser(token), null, 'expired sessions must not authenticate');

  const rows = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash));
  assert.equal(rows.length, 0, 'and must be cleaned up on the way out, not left to rot');
});

test('the expired-session sweep removes only expired rows', async (t) => {
  if (!reachable) return t.skip('no database');
  const user = await makeUser('kitchen');
  const live = (await login(user.email, PASSWORD))!;
  const staleToken = generateSessionToken();
  await db.insert(sessions).values({
    tokenHash: hashToken(staleToken),
    tenantId,
    userId: user.id,
    expiresAt: new Date(Date.now() - 60_000),
  });

  await deleteExpiredSessions();

  assert.equal((await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(staleToken)))).length, 0);
  assert.ok(await getSessionUser(live.token), 'a live session must survive the sweep');
});

test('logout destroys the session server-side', async (t) => {
  if (!reachable) return t.skip('no database');
  const user = await makeUser('counter');
  const { token } = (await login(user.email, PASSWORD))!;
  await destroySession(token);
  assert.equal(await getSessionUser(token), null, 'the token must be dead even if the cookie survives');
});

test('a counter user is blocked from user management at the database layer', async (t) => {
  if (!reachable) return t.skip('no database');
  const counter = asActor(await makeUser('counter'));
  const victim = await makeUser('kitchen');

  // No route, no button, no middleware involved - straight at the server function.
  await assert.rejects(() => deactivateUser(counter, victim.id), AuthzError);
  await assert.rejects(() => setUserRole(counter, victim.id, 'manager'), AuthzError);
  await assert.rejects(() => createUser(counter, { name: 'x', email: 'x@y.test', password: 'x', role: 'counter' }), AuthzError);
  await assert.rejects(() => listUsers(counter), AuthzError);

  const [unchanged] = await db.select().from(users).where(eq(users.id, victim.id));
  assert.equal(unchanged.isActive, true, 'nothing may have changed');
  assert.equal(unchanged.role, 'kitchen');
});

test('a user cannot deactivate themselves or change their own role', async (t) => {
  if (!reachable) return t.skip('no database');
  const owner = asActor(await makeUser('owner'));

  await assert.rejects(() => deactivateUser(owner, owner.id), AuthzError);
  await assert.rejects(() => setUserRole(owner, owner.id, 'counter'), AuthzError);

  const [unchanged] = await db.select().from(users).where(eq(users.id, owner.id));
  assert.equal(unchanged.isActive, true, 'the last owner must not be able to lock everyone out');
  assert.equal(unchanged.role, 'owner');
});

test('a manager cannot promote anyone to owner', async (t) => {
  if (!reachable) return t.skip('no database');
  const manager = asActor(await makeUser('manager'));
  const target = await makeUser('counter');

  await assert.rejects(() => setUserRole(manager, target.id, 'owner'), AuthzError);
  await assert.doesNotReject(() => setUserRole(manager, target.id, 'kitchen'), 'lesser roles are fine');

  const [row] = await db.select().from(users).where(eq(users.id, target.id));
  assert.equal(row.role, 'kitchen');
});

test('deactivating a user kills their live sessions immediately', async (t) => {
  if (!reachable) return t.skip('no database');
  const owner = asActor(await makeUser('owner'));
  const target = await makeUser('counter');
  const { token } = (await login(target.email, PASSWORD))!;
  assert.ok(await getSessionUser(token), 'session is live before deactivation');

  await deactivateUser(owner, target.id);

  assert.equal(await getSessionUser(token), null, 'deactivation must not be advisory until the session lapses');
  const left = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tenantId, tenantId), eq(sessions.userId, target.id)));
  assert.equal(left.length, 0);
});

test('a deactivated user cannot log back in', async (t) => {
  if (!reachable) return t.skip('no database');
  const owner = asActor(await makeUser('owner'));
  const target = await makeUser('counter');
  await deactivateUser(owner, target.id);
  assert.equal(await login(target.email, PASSWORD), null);
});
