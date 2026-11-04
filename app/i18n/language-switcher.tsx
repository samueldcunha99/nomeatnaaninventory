'use client';

import { useRef, useTransition } from 'react';
import { useLocale, useTranslations } from './provider.tsx';
import { setLanguage } from './actions.ts';
import { LANGUAGE_NAMES, LOCALES } from '../../src/lib/i18n/index.ts';

export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations();
  const form = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  return <form ref={form} action={setLanguage} className="language-switcher">
    <label className="sr-only" htmlFor="site-language">{t('Website language')}</label>
    <select id="site-language" name="language" className="select" value={locale} disabled={pending}
      aria-label={t('Website language')} onChange={() => startTransition(async () => {
        if (form.current) await setLanguage(new FormData(form.current));
      })}>
      {LOCALES.map(value => <option value={value} key={value} lang={value}>{LANGUAGE_NAMES[value]}</option>)}
    </select>
    <noscript><button className="btn btn--secondary" type="submit">{t('Apply language')}</button></noscript>
    {pending ? <span className="sr-only" role="status">{t('Changing language…')}</span> : null}
  </form>;
}
