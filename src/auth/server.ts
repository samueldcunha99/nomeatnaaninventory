import 'server-only';
/**
 * The enforcement point. Every protected page and every server action calls
 * requireSession() or requirePermission() as its first statement.
 *
 * Middleware is not this. Middleware redirects a browser that has no cookie, which
 * is a nicety for the user; it has been bypassable in the past and it cannot see
 * server actions invoked directly. These functions are what actually says no.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionUser, destroySession, login as dbLogin, type SessionUser } from '../db/auth.ts';
import { SESSION_COOKIE, assertPermission, type Permission } from '../lib/auth.ts';

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return getSessionUser(jar.get(SESSION_COOKIE)?.value);
}

export async function requireSession(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireSession();
  assertPermission(user.role, permission); // throws AuthzError, not a redirect
  return user;
}

export async function startSession(email: string, password: string): Promise<boolean> {
  const result = await dbLogin(email, password);
  if (!result) return false;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: result.expiresAt,
  });
  return true;
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  await destroySession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
}
