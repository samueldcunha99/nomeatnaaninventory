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
 * X-Forwarded-For is only trustworthy because nothing but the proxy can reach the app:
 * the app container publishes no port, and compose puts it on an internal network. If
 * the app is ever exposed directly, this header becomes attacker-controlled and the
 * per-source counter becomes worthless - the per-account one still holds.
 *
 * Returns null rather than guessing when there is no proxy, which is the local case.
 */
async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  // Leftmost is the original client; the rest are proxies that appended themselves.
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
