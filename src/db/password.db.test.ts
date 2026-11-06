import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { and, eq, sql as raw } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db, sql } from './client.ts';
import { dbReachable, closeDb } from './test-db.ts';
import { users, tenants, sessions, auditLog } from './schema.ts';
import { getSessionUser, hashPassword, login } from './auth.ts';
import { changeOwnPassword, IncorrectCurrentPasswordError, resetUserPassword } from './users.ts';
import { AuthzError, type Actor } from '../lib/auth.ts';

const PASSWORD = 'correct horse battery staple';
const REPLACEMENT = 'a different long passphrase';
let reachable = false;
let tenantId: string;
before(async () => {
  reachable = await dbReachable('password administration tests');
  if (!reachable) return;
  const [tenant] = await db.insert(tenants).values({ name: `password test ${crypto.randomUUID()}` }).returning();
  tenantId = tenant.id;
});
after(closeDb);

async function makeUser(role: Actor['role'], scope = tenantId) {
  const [user] = await db.insert(users).values({ tenantId: scope, name: `${role} password user`,
    email: `password-${crypto.randomUUID()}@example.test`, role, passwordHash: await hashPassword(PASSWORD) }).returning();
  return user;
}
const actor = (user: { id: string; tenantId: string; role: string }): Actor => ({
  id: user.id, tenantId: user.tenantId, role: user.role as Actor['role'],
});

test('administrative reset revokes every target session, keeps other accounts and never audits credentials', async t => {
  if (!reachable) return t.skip('no database');
  const owner = await makeUser('owner'), target = await makeUser('counter'), other = await makeUser('kitchen');
  const first = (await login(target.email, PASSWORD))!, second = (await login(target.email, PASSWORD))!;
  const unrelated = (await login(other.email, PASSWORD))!;
  assert.deepEqual(await resetUserPassword(actor(owner), target.id, REPLACEMENT), { id: target.id, name: target.name });
  assert.equal(await getSessionUser(first.token), null);
  assert.equal(await getSessionUser(second.token), null);
  assert.ok(await getSessionUser(unrelated.token));
  assert.equal(await login(target.email, PASSWORD), null);
  assert.ok(await login(target.email, REPLACEMENT));
  const [updated] = await db.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, target.id)));
  assert.equal(updated.role, 'counter'); assert.equal(updated.isActive, true);
  assert.notEqual(updated.passwordHash, REPLACEMENT);
  const rows = await db.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entityId, target.id)));
  assert.equal(rows.length, 1); assert.equal(rows[0].action, 'user.reset_password');
  assert.deepEqual(rows[0].afterJson, { sessionsRevoked: true });
  const audit = JSON.stringify(rows);
  for (const secret of [PASSWORD, REPLACEMENT, target.passwordHash, updated.passwordHash, first.token]) assert.ok(!audit.includes(secret));
});

test('password administration enforces rank and self guards before changing any account', async t => {
  if (!reachable) return t.skip('no database');
  const owner = await makeUser('owner'), manager = await makeUser('manager'), target = await makeUser('counter');
  for (const role of ['counter', 'kitchen'] as const) {
    await assert.rejects(() => resetUserPassword(actor({ ...target, role }), owner.id, REPLACEMENT), AuthzError);
  }
  await assert.rejects(() => resetUserPassword(actor(owner), owner.id, REPLACEMENT), AuthzError);
  await assert.rejects(() => resetUserPassword(actor(manager), owner.id, REPLACEMENT), AuthzError);
  await assert.doesNotReject(() => resetUserPassword(actor(manager), target.id, REPLACEMENT));
  const anotherOwner = await makeUser('owner');
  await assert.doesNotReject(() => resetUserPassword(actor(owner), anotherOwner.id, REPLACEMENT));
  assert.ok(await login(owner.email, PASSWORD), 'refused reset must leave the owner credential intact');
});

test('reset validates password bounds and target tenant before revoking sessions', async t => {
  if (!reachable) return t.skip('no database');
  const owner = await makeUser('owner'), target = await makeUser('counter');
  const live = (await login(target.email, PASSWORD))!;
  for (const password of ['short', 'a'.repeat(1025)]) await assert.rejects(() => resetUserPassword(actor(owner), target.id, password), ZodError);
  const [otherTenant] = await db.insert(tenants).values({ name: `other password tenant ${crypto.randomUUID()}` }).returning();
  const outsider = await makeUser('owner', otherTenant.id);
  await assert.rejects(() => resetUserPassword(actor(owner), outsider.id, REPLACEMENT), /unavailable/);
  assert.ok(await getSessionUser(live.token)); assert.ok(await login(outsider.email, PASSWORD));
});

test('administrative reset rechecks the acting user role and activation under the user locks', async t => {
  if (!reachable) return t.skip('no database');
  const manager = await makeUser('manager'), owner = await makeUser('owner'), target = await makeUser('counter');
  await db.update(users).set({ role: 'counter' }).where(and(eq(users.tenantId, tenantId), eq(users.id, manager.id)));
  await assert.rejects(() => resetUserPassword(actor(manager), target.id, REPLACEMENT), AuthzError);
  await db.update(users).set({ isActive: false }).where(and(eq(users.tenantId, tenantId), eq(users.id, owner.id)));
  await assert.rejects(() => resetUserPassword(actor(owner), target.id, REPLACEMENT), AuthzError);
  assert.ok(await login(target.email, PASSWORD));
});

test('two owners can reset each other without taking opposite user locks', async t => {
  if (!reachable) return t.skip('no database');
  const first = await makeUser('owner'), second = await makeUser('owner');
  await Promise.all([resetUserPassword(actor(first), second.id, REPLACEMENT), resetUserPassword(actor(second), first.id, REPLACEMENT)]);
  assert.ok(await login(first.email, REPLACEMENT)); assert.ok(await login(second.email, REPLACEMENT));
});

test('all roles can change their own password only after proving the current credential', async t => {
  if (!reachable) return t.skip('no database');
  for (const role of ['owner', 'manager', 'counter', 'kitchen'] as const) {
    const user = await makeUser(role), who = actor(user);
    const first = (await login(user.email, PASSWORD))!, second = (await login(user.email, PASSWORD))!;
    await assert.rejects(() => changeOwnPassword(who, 'wrong current credential', REPLACEMENT), IncorrectCurrentPasswordError);
    assert.ok(await getSessionUser(first.token), 'a refused change must not sign the user out');
    await changeOwnPassword(who, PASSWORD, REPLACEMENT);
    assert.equal(await getSessionUser(first.token), null); assert.equal(await getSessionUser(second.token), null);
    assert.equal(await login(user.email, PASSWORD), null); assert.ok(await login(user.email, REPLACEMENT));
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entityId, user.id)));
    assert.deepEqual(audit.afterJson, { sessionsRevoked: true }); assert.equal(audit.action, 'user.change_password');
  }
});

test('own-password changes reject inactive accounts and mismatched tenant identities', async t => {
  if (!reachable) return t.skip('no database');
  const user = await makeUser('counter');
  await assert.rejects(() => changeOwnPassword({ ...actor(user), tenantId: crypto.randomUUID() }, PASSWORD, REPLACEMENT), /unavailable/);
  await db.update(users).set({ isActive: false }).where(and(eq(users.tenantId, tenantId), eq(users.id, user.id)));
  await assert.rejects(() => changeOwnPassword(actor(user), PASSWORD, REPLACEMENT), /unavailable/);
  const [unchanged] = await db.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, user.id)));
  assert.equal(unchanged.passwordHash, user.passwordHash);
});

/** Force an actual competing transaction to wait on this exact user's row. */
async function whileUserLocked<T>(user: { id: string; tenantId: string }, change: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>, attempt: () => Promise<T>) {
  let release!: () => void;
  let announce!: (pid: number) => void;
  const locked = new Promise<number>(resolve => { announce = resolve; });
  const finish = new Promise<void>(resolve => { release = resolve; });
  const writer = db.transaction(async tx => {
    const [backend] = await tx.execute<{ pid: number }>(raw`select pg_backend_pid() as pid`);
    await tx.select({ id: users.id }).from(users).where(and(eq(users.tenantId, user.tenantId), eq(users.id, user.id))).for('update');
    announce(backend.pid);
    await finish;
    await change(tx);
  });
  const pid = await locked;
  const pending = attempt();
  // Observe the database lock rather than hoping Argon2 finishes within a fixed sleep.
  let waiting = false;
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rows = await sql`select pid from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`;
      if (rows.length) { waiting = true; break; }
      await delay(10);
    }
    assert.ok(waiting, 'the competing operation must be observed waiting on the user lock');
  } finally { release(); }
  await writer;
  return pending;
}

test('login cannot create an old-password session after a concurrent password reset commits', async t => {
  if (!reachable) return t.skip('no database');
  const user = await makeUser('counter'), replacementHash = await hashPassword(REPLACEMENT);
  const result = await whileUserLocked(user, async tx => {
    await tx.update(users).set({ passwordHash: replacementHash }).where(and(eq(users.tenantId, tenantId), eq(users.id, user.id)));
    await tx.delete(sessions).where(and(eq(sessions.tenantId, tenantId), eq(sessions.userId, user.id)));
  }, () => login(user.email, PASSWORD));
  assert.equal(result === null, true, 'an old credential verified before reset cannot create a new live session afterwards');
  assert.ok(await login(user.email, REPLACEMENT));
});

test('manager reset rechecks a target promoted to owner while the operation was waiting', async t => {
  if (!reachable) return t.skip('no database');
  const manager = await makeUser('manager'), target = await makeUser('counter');
  await assert.rejects(() => whileUserLocked(target, async tx => {
    await tx.update(users).set({ role: 'owner' }).where(and(eq(users.tenantId, tenantId), eq(users.id, target.id)));
  }, () => resetUserPassword(actor(manager), target.id, REPLACEMENT)), AuthzError);
  assert.ok(await login(target.email, PASSWORD), 'manager must not reset the now-owner account');
});
