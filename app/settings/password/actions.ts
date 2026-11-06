'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { endSession, requireSession } from '../../../src/auth/server.ts';
import { changeOwnPassword, IncorrectCurrentPasswordError } from '../../../src/db/users.ts';
import { PasswordChange } from '../../../src/lib/password.ts';

export type PasswordState = { error: string | null };

export async function changeOwnPasswordAction(_previous: PasswordState, form: FormData): Promise<PasswordState> {
  const actor = await requireSession();
  const parsed = PasswordChange.safeParse({ currentPassword: form.get('currentPassword'),
    password: form.get('password'), confirmation: form.get('confirmation') });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await changeOwnPassword(actor, parsed.data.currentPassword, parsed.data.password);
  } catch (error) {
    if (error instanceof z.ZodError) return { error: error.issues[0].message };
    if (error instanceof IncorrectCurrentPasswordError || error instanceof RangeError) return { error: error.message };
    return { error: 'The password could not be changed. Please try again.' };
  }
  await endSession();
  redirect('/login');
}
