/**
 * Session store and password verification. Database, no framework.
 * Cookie handling lives in src/auth/server.ts; this file never touches a request.
 */
import { hash, verify } from '@node-rs/argon2';
import { and, eq, isNull, lte, sql as raw } from 'drizzle-orm';
import { db } from './client.ts';
import { users, sessions } from './schema.ts';
import {
  generateSessionToken,
  hashToken,
  sessionExpiry,
  isExpired,
  type Actor,
  type Role,
} from '../lib/auth.ts';

export type SessionUser = Actor & { name: string; email: string };

/**
 * Verified against even when no user matches, so a wrong email and a wrong password
 * take the same time. Generated once at load from a value nobody can log in with.
 */
const DUMMY_HASH = await hash(generateSessionToken());

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

/**
 * Returns a raw session token to put in the cookie, or null. The token is never
 * stored - only its sha256 is.
 *
 * ponytail: resolves the tenant by matching the email across all tenants and
 * rejecting an ambiguous match. Correct while there is one tenant. Client two needs
 * either a tenant subdomain or a tenant picker on the login form.
 */
export async function login(email: string, password: string) {
  const candidates = await db
    .select()
    .from(users)
    .where(and(raw`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)));

  const user = candidates.length === 1 ? candidates[0] : undefined;
  const ok = await verify(user?.passwordHash ?? DUMMY_HASH, password).catch(() => false);
  if (!user || !ok || !user.isActive) return null;

  const token = generateSessionToken();
  const expiresAt = sessionExpiry();
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    tenantId: user.tenantId,
    userId: user.id,
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * Resolve a raw cookie token to a user, or null.
 *
 * A tampered token simply hashes to something that is not in the table. An expired
 * one is deleted on the way out rather than left to rot - the row is useless and
 * keeping it around only grows the table and the blast radius of a dump.
 */
export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);

  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      id: users.id,
      tenantId: users.tenantId,
      role: users.role,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      deletedAt: users.deletedAt,
    })
    .from(sessions)
    .innerJoin(users, and(eq(sessions.tenantId, users.tenantId), eq(sessions.userId, users.id)))
    .where(eq(sessions.tokenHash, tokenHash));

  if (!row) return null;
  if (isExpired(row.expiresAt)) {
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    return null;
  }
  // Deactivating a user must end their access now, not when their session lapses.
  if (!row.isActive || row.deletedAt) {
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    return null;
  }

  return { id: row.id, tenantId: row.tenantId, role: row.role as Role, name: row.name, email: row.email };
}

export async function destroySession(token: string | undefined) {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Sweep. Nothing schedules this yet; call it from a cron when one exists. */
export async function deleteExpiredSessions(now: Date = new Date()) {
  await db.delete(sessions).where(lte(sessions.expiresAt, now));
}
