'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '../../../src/auth/server.ts';
import {
  createUser,
  deactivateUser,
  reactivateUser,
  setUserRole,
  DuplicateEmailError,
} from '../../../src/db/users.ts';

export type FormState = { error: string | null; ok: string | null };

/**
 * A refused action is the operator's to understand, not a stack trace. AuthzError covers
 * every guard in src/lib/auth.ts - acting on yourself, acting on an owner, granting a
 * role above your own - and each already carries a sentence worth showing.
 */
function friendly(err: unknown): string {
  if (err instanceof DuplicateEmailError) return err.message;
  if (err instanceof RangeError) return err.message;
  if (err instanceof Error && err.name === 'AuthzError') return err.message;
  throw err;
}

const ROLES = ['owner', 'manager', 'counter', 'kitchen'] as const;

const NewUser = z.object({
  name: z.string().trim().min(1, 'Enter their name.').max(120),
  email: z.string().trim().toLowerCase().email('That does not look like an email address.').max(320),
  // Long rather than complicated: a passphrase staff can remember beats a pattern they
  // write on the till. Argon2 does not care how long it is.
  password: z.string().min(12, 'Use at least 12 characters.').max(1024),
  role: z.enum(ROLES),
});

export async function createUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission('users.manage');

  const parsed = NewUser.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    role: formData.get('role'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message, ok: null };

  try {
    const created = await createUser(actor, parsed.data);
    revalidatePath('/settings/users');
    return { error: null, ok: `${created.name} can now sign in as ${created.role}.` };
  } catch (err) {
    return { error: friendly(err), ok: null };
  }
}

const Change = z.object({
  userId: z.string().uuid(),
  /** Absent means the active flag is being toggled instead. */
  role: z.enum(ROLES).optional(),
  active: z.enum(['on', 'off']).optional(),
});

export async function changeUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePermission('users.manage');

  const parsed = Change.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role') || undefined,
    active: formData.get('active') || undefined,
  });
  if (!parsed.success) return { error: 'That change could not be read.', ok: null };

  try {
    if (parsed.data.active === 'off') {
      const user = await deactivateUser(actor, parsed.data.userId);
      revalidatePath('/settings/users');
      return { error: null, ok: `${user.name} can no longer sign in, and was signed out.` };
    }
    if (parsed.data.active === 'on') {
      const user = await reactivateUser(actor, parsed.data.userId);
      revalidatePath('/settings/users');
      return { error: null, ok: `${user.name} can sign in again.` };
    }
    if (parsed.data.role) {
      const user = await setUserRole(actor, parsed.data.userId, parsed.data.role);
      revalidatePath('/settings/users');
      return { error: null, ok: `${user.name} is now ${user.role}.` };
    }
    return { error: 'Nothing to change.', ok: null };
  } catch (err) {
    return { error: friendly(err), ok: null };
  }
}
