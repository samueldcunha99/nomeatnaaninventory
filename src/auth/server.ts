import 'server-only';
/**
 * The enforcement point. Every protected page and every server action calls
 * requireSession() or requirePermission() as its first statement.
 *
 * Middleware is not this. Middleware redirects a browser that has no cookie, which
 * is a nicety for the user; it has been bypassable in the past and it cannot see
 * server actions invoked directly. These functions are what actually says no.
 */
import { cookies, headers } from 'next/headers';
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

/**
 * Whether to mark the session cookie `Secure`, from the scheme actually in use.
 *
 * It used to be `NODE_ENV === 'production'`, which is the wrong question and broke the
 * one deployment it most needed to work on. A browser REFUSES a `Secure` cookie sent
 * from an `http://` origin - localhost is the only exemption, which is why no one saw
 * it locally. The demo box runs `NODE_ENV=production` behind Caddy on `SITE_ADDRESS=:80`,
 * so the cookie was set, silently dropped, and every sign-in bounced straight back to
 * /login with no error to read.
 *
 * `x-forwarded-proto` is set by Caddy to the real scheme and OVERWRITTEN on every
 * request (unlike x-forwarded-for, which is appended to - see the Caddyfile), so a
 * client cannot forge it into saying https. With no proxy in front there is no header,
 * and NODE_ENV is the honest fallback.
 *
 * The failure directions are not symmetric, which is why this is worth the paragraph:
 * dropping `Secure` on an HTTPS site exposes the cookie to a downgrade, while setting it
 * on an HTTP site locks everybody out. Reading the scheme is the only answer that is
 * right in both places, and TLS is still what you should be serving - see deploy/README.
 */
async function cookieIsSecure(): Promise<boolean> {
  const proto = (await headers()).get('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim() === 'https';
  return process.env.NODE_ENV === 'production';
}

export async function startSession(email: string, password: string): Promise<boolean> {
  const result = await dbLogin(email, password);
  if (!result) return false;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure: await cookieIsSecure(),
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
