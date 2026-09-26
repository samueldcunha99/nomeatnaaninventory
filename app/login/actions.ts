'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { startSession, endSession } from '../../src/auth/server.ts';
import {
  checkLoginAllowed,
  recordLoginFailure,
  clearLoginFailures,
} from '../../src/lib/throttle.ts';

const Credentials = z.object({
  email: z.string().trim().min(1, 'Email is required').max(320),
  password: z.string().min(1, 'Password is required').max(1024),
});

/**
 * The client address, as Caddy reports it.
 *
 * TWO things have to hold for this to mean anything, and only one of them used to.
 *
 * 1. Nothing but the proxy can reach the app. The app container publishes no port and
 *    compose puts it on an internal network, so the CONNECTION is trustworthy.
 * 2. The proxy must REPLACE X-Forwarded-For rather than append to it. Caddy's default
 *    is to append, so a request arriving with a forged header reached the app as
 *    "<forged>, <real>" - and reading the leftmost entry, as this does, read the
 *    attacker's value. Rotating it defeated the per-source counter entirely.
 *
 * The Caddyfile now pins `header_up X-Forwarded-For {remote_host}`, which makes the
 * header a single address Caddy observed. Point this app at a proxy that does not do
 * that and the per-source counter is worthless again; the per-account one still holds,
 * and that is the one protecting a password.
 *
 * Returns null rather than guessing when there is no proxy, which is the local case.
 */
async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  // One address, because the Caddyfile replaces rather than appends. The split is kept
  // as a belt for any other proxy that might sit in front later.
  return forwarded?.split(',')[0]?.trim() || null;
}

export async function loginAction(_prev: string | null, formData: FormData): Promise<string | null> {
  const parsed = Credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return parsed.error.issues[0].message;

  const ip = await clientIp();

  // Checked before the password is verified, so a blocked attempt costs no Argon2 work.
  const gate = checkLoginAllowed(parsed.data.email, ip);
  if (!gate.allowed) {
    const minutes = Math.ceil(gate.retryAfterMs / 60_000);
    return `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }

  // One message for every failure - a wrong email and a wrong password must not be
  // distinguishable, or the form becomes a way to enumerate who works here. The throttle
  // message above is a deliberate exception: it is the same for an address that exists
  // and one that does not, so it still says nothing about who has an account.
  const ok = await startSession(parsed.data.email, parsed.data.password);
  if (!ok) {
    recordLoginFailure(parsed.data.email, ip);
    return 'Incorrect email or password.';
  }

  clearLoginFailures(parsed.data.email);
  redirect('/');
}

export async function logoutAction() {
  await endSession();
  redirect('/login');
}
