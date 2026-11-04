import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { LANGUAGE_COOKIE, resolveLocale, translator } from '../../src/lib/i18n/index.ts';

export const getLocale = cache(async () => resolveLocale((await cookies()).get(LANGUAGE_COOKIE)?.value));
export async function getTranslations() { return translator(await getLocale()); }
