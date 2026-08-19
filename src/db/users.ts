/**
 * User administration. Every function takes the acting user and enforces the guards
 * itself - callers are not trusted to have checked, because the UI is not an
 * enforcement layer and a server action is reachable without ever loading a page.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from './client.ts';
import { users, auditLog, sessions } from './schema.ts';
import { hashPassword } from './auth.ts';
import { translating } from './errors.ts';
import { assertPermission, assertNotSelf, assertCanAssignRole, type Actor, type Role } from '../lib/auth.ts';

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
