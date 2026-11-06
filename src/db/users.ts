/**
 * User administration. Every function takes the acting user and enforces the guards
 * itself - callers are not trusted to have checked, because the UI is not an
 * enforcement layer and a server action is reachable without ever loading a page.
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from './client.ts';
import { users, auditLog, sessions } from './schema.ts';
import { hashPassword, verifyPassword } from './auth.ts';
import { translating } from './errors.ts';
import { CurrentPassword, NewPassword } from '../lib/password.ts';
import { z } from 'zod';
import {
  assertPermission,
  assertNotSelf,
  assertCanAssignRole,
  assertCanActOnRole,
  AuthzError,
  type Actor,
  type Role,
} from '../lib/auth.ts';

/**
 * Same exposure ingredients had: users_tenant_email_uq is reachable from a form, and
 * without translation the operator gets a raw driver error instead of "that email is
 * already in use".
 */
const EMAIL_CONSTRAINT = 'users_tenant_email_uq';

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(
      `A user with the email "${email}" already exists. If they were deactivated, ` +
        `reactivate that account rather than creating a second one.`,
    );
    this.name = 'DuplicateEmailError';
  }
}

export async function listUsers(actor: Actor) {
  assertPermission(actor.role, 'users.manage');
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
    })
    .from(users)
    .where(and(eq(users.tenantId, actor.tenantId), isNull(users.deletedAt)));
}

export async function createUser(
  actor: Actor,
  input: { name: string; email: string; password: string; role: Role },
) {
  assertCanAssignRole(actor, input.role);
  const run = () =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          tenantId: actor.tenantId,
          name: input.name,
          email: input.email,
          passwordHash: await hashPassword(input.password),
          role: input.role,
        })
        .returning({ id: users.id, name: users.name, email: users.email, role: users.role });
      await tx.insert(auditLog).values({
        tenantId: actor.tenantId,
        userId: actor.id,
        action: 'user.create',
        entityType: 'user',
        entityId: row.id,
        afterJson: row,
      });
      return row;
    });

  return translating(run, [
    { constraint: EMAIL_CONSTRAINT, toError: () => new DuplicateEmailError(input.email) },
  ]);
}

export async function deactivateUser(actor: Actor, targetUserId: string) {
  assertPermission(actor.role, 'users.manage');
  assertNotSelf(actor, targetUserId, 'deactivate');

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(users)
      .where(and(eq(users.tenantId, actor.tenantId), eq(users.id, targetUserId)));
    if (!before) throw new Error('user not found');
    assertCanActOnRole(actor, before.role, 'deactivate');

    const [after] = await tx
      .update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(users.tenantId, actor.tenantId), eq(users.id, targetUserId)))
      .returning();

    // Revoke immediately. Leaving live sessions behind makes deactivation advisory.
    await tx.delete(sessions).where(and(eq(sessions.tenantId, actor.tenantId), eq(sessions.userId, targetUserId)));

    await tx.insert(auditLog).values({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'user.deactivate',
      entityType: 'user',
      entityId: targetUserId,
      beforeJson: { isActive: before.isActive },
      afterJson: { isActive: after.isActive },
    });
    return after;
  });
}

export async function setUserRole(actor: Actor, targetUserId: string, role: Role) {
  assertCanAssignRole(actor, role);
  assertNotSelf(actor, targetUserId, 'change the role of');

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(users)
      .where(and(eq(users.tenantId, actor.tenantId), eq(users.id, targetUserId)));
    if (!before) throw new Error('user not found');
    // Guards the TARGET; assertCanAssignRole above guarded the new role.
    assertCanActOnRole(actor, before.role, 'change the role of');

    const [after] = await tx
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(and(eq(users.tenantId, actor.tenantId), eq(users.id, targetUserId)))
      .returning();

    await tx.insert(auditLog).values({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'user.set_role',
      entityType: 'user',
      entityId: targetUserId,
      beforeJson: { role: before.role },
      afterJson: { role: after.role },
    });
    return after;
  });
}

/**
 * Put a deactivated account back. DuplicateEmailError has been telling people to do this
 * since Month 1 — "reactivate that account rather than creating a second one" — with no
 * way to actually do it, so the only route back was a second account with a different
 * email and a split audit trail.
 *
 * No session is restored: they sign in again, which is the point.
 */
export async function reactivateUser(actor: Actor, targetUserId: string) {
  assertPermission(actor.role, 'users.manage');

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(users)
      .where(and(eq(users.tenantId, actor.tenantId), eq(users.id, targetUserId)));
    if (!before) throw new Error('user not found');
    assertCanActOnRole(actor, before.role, 'reactivate');

    const [after] = await tx
      .update(users)
      .set({ isActive: true, updatedAt: new Date() })
      .where(and(eq(users.tenantId, actor.tenantId), eq(users.id, targetUserId)))
      .returning();

    await tx.insert(auditLog).values({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'user.reactivate',
      entityType: 'user',
      entityId: targetUserId,
      beforeJson: { isActive: before.isActive },
      afterJson: { isActive: after.isActive },
    });
    return after;
  });
}

export class IncorrectCurrentPasswordError extends Error {
  constructor() {
    super('Your current password is incorrect.');
    this.name = 'IncorrectCurrentPasswordError';
  }
}

/** Administrative recovery changes only another account's password, never its role or activation. */
export async function resetUserPassword(actor: Actor, targetUserId: string, password: string) {
  assertPermission(actor.role, 'users.manage');
  assertNotSelf(actor, targetUserId, 'reset the password of');
  z.string().uuid().parse(targetUserId);
  NewPassword.parse(password);

  return db.transaction(async tx => {
    // Lock actor and target in one deterministic order. A concurrent demotion cannot
    // leave a stale manager claim effective, and two owners resetting one another do
    // not acquire opposite locks through the audit row's user foreign key.
    const locked = await tx.select({ id: users.id, name: users.name, role: users.role, isActive: users.isActive }).from(users)
      .where(and(eq(users.tenantId, actor.tenantId), inArray(users.id, [actor.id, targetUserId]), isNull(users.deletedAt)))
      .orderBy(asc(users.id)).for('update');
    const acting = locked.find(user => user.id === actor.id);
    if (!acting?.isActive) throw new AuthzError('Your account is unavailable. Sign in again.');
    const currentActor: Actor = { ...actor, role: acting.role };
    assertPermission(currentActor.role, 'users.manage');
    const target = locked.find(user => user.id === targetUserId);
    if (!target) throw new RangeError('That staff account is unavailable.');
    assertCanActOnRole(currentActor, target.role, 'reset the password of');

    await tx.update(users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
      .where(and(eq(users.tenantId, actor.tenantId), eq(users.id, targetUserId)));
    await tx.delete(sessions).where(and(eq(sessions.tenantId, actor.tenantId), eq(sessions.userId, targetUserId)));
    await tx.insert(auditLog).values({ tenantId: actor.tenantId, userId: actor.id,
      action: 'user.reset_password', entityType: 'user', entityId: targetUserId,
      // Neither the supplied credential nor any password hash belongs in an audit row.
      afterJson: { sessionsRevoked: true },
    });
    return { id: target.id, name: target.name };
  });
}

/** Everyone may change their own credential, after proving the current one. */
export async function changeOwnPassword(actor: Actor, currentPassword: string, password: string) {
  CurrentPassword.parse(currentPassword);
  NewPassword.parse(password);

  return db.transaction(async tx => {
    const [target] = await tx.select({ passwordHash: users.passwordHash, isActive: users.isActive }).from(users)
      .where(and(eq(users.tenantId, actor.tenantId), eq(users.id, actor.id), isNull(users.deletedAt))).for('update');
    if (!target || !target.isActive) throw new RangeError('Your account is unavailable. Sign in again.');
    if (!(await verifyPassword(target.passwordHash, currentPassword))) throw new IncorrectCurrentPasswordError();

    await tx.update(users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
      .where(and(eq(users.tenantId, actor.tenantId), eq(users.id, actor.id)));
    await tx.delete(sessions).where(and(eq(sessions.tenantId, actor.tenantId), eq(sessions.userId, actor.id)));
    await tx.insert(auditLog).values({ tenantId: actor.tenantId, userId: actor.id,
      action: 'user.change_password', entityType: 'user', entityId: actor.id,
      afterJson: { sessionsRevoked: true },
    });
  });
}
