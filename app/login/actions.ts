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
 * Render's public ingress reports the client in the first X-Forwarded-For entry.
 * https://render.com/articles/how-render-handles-ddos-attacks
 * This assumes requests enter through that managed proxy. A different host must
 * establish its own trusted proxy boundary before relying on this header.
 * Netlify applies a platform IP limit before its ephemeral app instances; the app
 * does not trust caller-supplied forwarding headers there. Its per-account counter
 * is an additional per-instance check, not a shared account lockout.
 */
async function clientIp(): Promise<string | null> {
  if (process.env.HOSTING_PROVIDER === 'netlify') return null;
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
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
