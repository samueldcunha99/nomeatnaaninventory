'use server';

import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { LANGUAGE_COOKIE } from '../../src/lib/i18n/index.ts';

const Language = z.enum(['en', 'hi', 'mr']);
/** Public display preference only; this action cannot change an account or business data. */
export async function setLanguage(form: FormData) {
  const locale = Language.parse(form.get('language'));
  const proto = (await headers()).get('x-forwarded-proto')?.split(',')[0].trim();
  (await cookies()).set(LANGUAGE_COOKIE, locale, {
    path: '/', maxAge: 60 * 60 * 24 * 365, httpOnly: true, sameSite: 'lax',
    secure: process.env.HOSTING_PROVIDER === 'netlify' || proto === 'https',
  });
}
