'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { startSession, endSession } from '../../src/auth/server.ts';

const Credentials = z.object({
  email: z.string().trim().min(1, 'Email is required').max(320),
  password: z.string().min(1, 'Password is required').max(1024),
});

export async function loginAction(_prev: string | null, formData: FormData): Promise<string | null> {
  const parsed = Credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return parsed.error.issues[0].message;

  // One message for every failure - a wrong email and a wrong password must not be
  // distinguishable, or the form becomes a way to enumerate who works here.
  const ok = await startSession(parsed.data.email, parsed.data.password);
  if (!ok) return 'Incorrect email or password.';

  redirect('/');
}

export async function logoutAction() {
  await endSession();
  redirect('/login');
}
